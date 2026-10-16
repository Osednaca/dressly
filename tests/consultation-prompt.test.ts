import assert from "node:assert/strict";
import test from "node:test";
import { buildNanoBananaPrompt } from "@/lib/agent/consultation-prompt";
import {
  pollConsultationDesign,
  startConsultationDesign,
} from "@/lib/agent/consultation-runway";
import {
  applyChangesToBagState,
  createSessionRecord,
  initConsultation,
} from "@/lib/session/reducer";
import { persist } from "@/lib/session/store";
import {
  DEFAULT_BAG_DESIGN_STATE,
  DESIGN_FIELD_KEYS,
  type DesignFieldDiff,
} from "@/lib/types";

function splitPromptSections(promptText: string): {
  currentProduct: string;
  requestedModification: string;
  strictPreservation: string;
  outputFormat: string;
} {
  const reqIdx = promptText.indexOf("REQUESTED MODIFICATION");
  const strictIdx = promptText.indexOf("STRICT PRESERVATION CONSTRAINTS");
  const outIdx = promptText.indexOf("OUTPUT FORMAT");

  assert.ok(promptText.startsWith("CURRENT PRODUCT"), "Missing CURRENT PRODUCT section");
  assert.ok(reqIdx > 0, "Missing REQUESTED MODIFICATION section");
  assert.ok(strictIdx > reqIdx, "Missing STRICT PRESERVATION CONSTRAINTS section");
  assert.ok(outIdx > strictIdx, "Missing OUTPUT FORMAT section");

  return {
    currentProduct: promptText.slice(0, reqIdx).trim(),
    requestedModification: promptText.slice(reqIdx, strictIdx).trim(),
    strictPreservation: promptText.slice(strictIdx, outIdx).trim(),
    outputFormat: promptText.slice(outIdx).trim(),
  };
}

test("buildNanoBananaPrompt builds V1 -> V2 single modification prompt (hardwareColor: silver -> gold, includeOriginalReference: false)", () => {
  const previousState = structuredClone(DEFAULT_BAG_DESIGN_STATE);
  const changes: DesignFieldDiff[] = [
    {
      field: "hardwareColor",
      label: "HARDWARE",
      previousValue: "silver",
      proposedValue: "gold",
    },
  ];
  const nextState = applyChangesToBagState(previousState, changes);

  const result = buildNanoBananaPrompt({
    nextState,
    previousState,
    changes,
    includeOriginalReference: false,
  });

  assert.equal(result.versionLabel, "Gold hardware");
  assert.equal(result.versionSummary, "hardware: silver → gold");
  assert.ok(result.promptText.length <= 5000);

  const sections = splitPromptSections(result.promptText);

  // References @latest_design and does not reference @original_design when includeOriginalReference is false
  assert.ok(sections.currentProduct.includes("@latest_design"));
  assert.ok(!result.promptText.includes("@original_design"));

  // Exact modification line in REQUESTED MODIFICATION
  assert.ok(
    sections.requestedModification.includes(
      '- HARDWARE (hardwareColor): change from "silver" to "gold"',
    ),
  );

  // Modified field appears only in REQUESTED MODIFICATION, never in STRICT PRESERVATION CONSTRAINTS
  assert.ok(sections.requestedModification.includes("(hardwareColor)"));
  assert.ok(!sections.strictPreservation.includes("(hardwareColor)"));

  // All unchanged fields from DESIGN_FIELD_KEYS appear in STRICT PRESERVATION CONSTRAINTS
  for (const field of DESIGN_FIELD_KEYS) {
    if (field === "hardwareColor") continue;
    assert.ok(
      sections.strictPreservation.includes(`(${field})`),
      `Expected unchanged field "${field}" in STRICT PRESERVATION CONSTRAINTS`,
    );
    assert.ok(
      !sections.requestedModification.includes(`(${field})`),
      `Unchanged field "${field}" must not appear in REQUESTED MODIFICATION`,
    );
  }
});

test("buildNanoBananaPrompt builds V2 -> V3 subsequent modification (size: medium -> small, includeOriginalReference: true with @latest_design and @original_design)", () => {
  const v2State = applyChangesToBagState(DEFAULT_BAG_DESIGN_STATE, [
    {
      field: "hardwareColor",
      label: "HARDWARE",
      previousValue: "silver",
      proposedValue: "gold",
    },
  ]);

  const changes: DesignFieldDiff[] = [
    {
      field: "size",
      label: "SIZE",
      previousValue: "medium",
      proposedValue: "small",
    },
  ];
  const v3State = applyChangesToBagState(v2State, changes);

  const result = buildNanoBananaPrompt({
    nextState: v3State,
    previousState: v2State,
    changes,
    includeOriginalReference: true,
  });

  assert.equal(result.versionLabel, "Smaller silhouette");
  assert.equal(result.versionSummary, "size: medium → small");
  assert.ok(result.promptText.length <= 5000);

  const sections = splitPromptSections(result.promptText);

  // Both @latest_design and @original_design must be referenced
  assert.ok(sections.currentProduct.includes("@latest_design"));
  assert.ok(sections.currentProduct.includes("@original_design"));
  assert.ok(sections.strictPreservation.includes("@latest_design"));
  assert.ok(sections.strictPreservation.includes("@original_design"));

  assert.ok(
    sections.requestedModification.includes(
      '- SIZE (size): change from "medium" to "small"',
    ),
  );
  assert.ok(!sections.strictPreservation.includes("(size)"));

  // Previously modified hardwareColor ("gold") is now an unchanged attribute on V2 -> V3 and must be preserved!
  assert.ok(
    sections.strictPreservation.includes(
      '- HARDWARE (hardwareColor): preserve "gold"',
    ),
  );
});

test("buildNanoBananaPrompt handles multi-field strap modification (strapType: shoulder -> crossbody + strapLength) and isolated VTO studio constraints", () => {
  const v3State = applyChangesToBagState(DEFAULT_BAG_DESIGN_STATE, [
    { field: "hardwareColor", label: "HARDWARE", previousValue: "silver", proposedValue: "gold" },
    { field: "size", label: "SIZE", previousValue: "medium", proposedValue: "small" },
  ]);

  const changes: DesignFieldDiff[] = [
    {
      field: "strapType",
      label: "STRAP",
      previousValue: "shoulder",
      proposedValue: "crossbody",
    },
    {
      field: "strapLength",
      label: "STRAP LENGTH",
      previousValue: "standard shoulder drop",
      proposedValue: "longer adjustable crossbody drop",
    },
  ];
  const v4State = applyChangesToBagState(v3State, changes);

  const result = buildNanoBananaPrompt({
    nextState: v4State,
    previousState: v3State,
    changes,
    includeOriginalReference: true,
    highResFinal: true,
  });

  assert.equal(result.versionLabel, "Crossbody strap");
  assert.ok(result.versionSummary.includes("strap: shoulder → crossbody"));
  assert.ok(
    result.versionSummary.includes(
      "strap length: standard shoulder drop → longer adjustable crossbody drop",
    ),
  );

  const sections = splitPromptSections(result.promptText);

  // Both modified fields appear in REQUESTED MODIFICATION and neither appears in STRICT PRESERVATION CONSTRAINTS
  assert.ok(
    sections.requestedModification.includes(
      '- STRAP (strapType): change from "shoulder" to "crossbody"',
    ),
  );
  assert.ok(
    sections.requestedModification.includes(
      '- STRAP LENGTH (strapLength): change from "standard shoulder drop" to "longer adjustable crossbody drop"',
    ),
  );
  assert.ok(!sections.strictPreservation.includes("(strapType)"));
  assert.ok(!sections.strictPreservation.includes("(strapLength)"));

  for (const field of DESIGN_FIELD_KEYS) {
    if (field === "strapType" || field === "strapLength") continue;
    assert.ok(sections.strictPreservation.includes(`(${field})`));
  }

  // Isolated studio VTO constraints must be present in OUTPUT FORMAT
  const lowerOut = sections.outputFormat.toLowerCase();
  assert.ok(lowerOut.includes("no hands"));
  assert.ok(lowerOut.includes("no model"));
  assert.ok(lowerOut.includes("no text"));
  assert.ok(lowerOut.includes("no watermark"));
  assert.ok(sections.outputFormat.includes("#f3efe9"));
});

test("startConsultationDesign and pollConsultationDesign generate V2 and V3 revisions via fallback Runway image engine", async () => {
  let session = createSessionRecord("ses_c21_runway", null);
  session = initConsultation(session, {
    id: "con_c21",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });
  await persist(session);

  const v1State = session.consultation!.designState;
  const v2Changes: DesignFieldDiff[] = [
    {
      field: "hardwareColor",
      label: "HARDWARE",
      previousValue: "silver",
      proposedValue: "gold",
    },
  ];
  const v2State = applyChangesToBagState(v1State, v2Changes);

  const startedV2 = await startConsultationDesign(session, {
    suggestionId: "sug_v2",
    changes: v2Changes,
    nextState: v2State,
    previousState: v1State,
  });

  assert.equal(startedV2.blocked, null);
  assert.ok(startedV2.job);
  assert.equal(startedV2.job.kind, "consultation_design");
  assert.equal(startedV2.job.status, "pending");
  assert.equal(
    startedV2.job.step,
    "Rendering revised design with Runway Nano Banana 2.1",
  );
  assert.equal(startedV2.session.consultation?.status, "GENERATING_DESIGN");

  const polledV2 = await pollConsultationDesign(startedV2.job.id);
  assert.ok(polledV2);
  assert.equal(polledV2.job.status, "success");
  assert.ok(polledV2.version);
  assert.equal(polledV2.version.version, 2);
  assert.equal(polledV2.version.label, "V2 Gold hardware");
  assert.ok(polledV2.version.imageUrl.startsWith("/api/media/results/design_"));
  assert.ok(polledV2.version.promptUsed?.includes("CURRENT PRODUCT"));
  assert.ok(!polledV2.version.promptUsed?.includes("@original_design"));

  // Now generate V3 (currentDesignVersionId !== originalVersionId -> includes @original_design)
  const v3Changes: DesignFieldDiff[] = [
    {
      field: "size",
      label: "SIZE",
      previousValue: "medium",
      proposedValue: "small",
    },
  ];
  const v3State = applyChangesToBagState(v2State, v3Changes);

  const startedV3 = await startConsultationDesign(polledV2.session!, {
    suggestionId: "sug_v3",
    changes: v3Changes,
    nextState: v3State,
    previousState: v2State,
  });
  assert.ok(startedV3.job);

  const polledV3 = await pollConsultationDesign(startedV3.job.id);
  assert.ok(polledV3?.version);
  assert.equal(polledV3.version.version, 3);
  assert.equal(polledV3.version.label, "V3 Smaller silhouette");
  assert.ok(polledV3.version.promptUsed?.includes("@latest_design"));
  assert.ok(polledV3.version.promptUsed?.includes("@original_design"));
});
