import assert from "node:assert/strict";
import test from "node:test";
import { renderStudioBagSvg } from "@/lib/catalog/bag-svg";
import {
  actOnProposedSuggestion,
  addProposedSuggestion,
  appendConsultationActivity,
  appendTranscriptSegment,
  applyChangesToBagState,
  attachTryOnToVersion,
  computeChangeFingerprint,
  createSessionRecord,
  endConsultation,
  initConsultation,
  recordDesignVersion,
  restoreDesignVersion,
  setConsultationBotStatus,
  setConsultationStatus,
  updateConsultationSettings,
} from "@/lib/session/reducer";
import { DEFAULT_BAG_DESIGN_STATE } from "@/lib/types";

test("createSessionRecord initializes consultation as null", () => {
  const session = createSessionRecord("ses_init", null);
  assert.equal(session.consultation, null);
});

test("initConsultation creates V1 Original, logs activity, and places bespoke bag in currentLook", () => {
  let session = createSessionRecord("ses_c1", "/api/media/uploads/client.png");
  session = initConsultation(session, {
    id: "con_test",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });

  const con = session.consultation!;
  assert.ok(con);
  assert.equal(con.id, "con_test");
  assert.equal(con.meetingUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(con.consentConfirmed, true);
  assert.equal(con.status, "STARTING");
  assert.equal(con.botStatus, "STARTING");
  assert.equal(con.autoApply, false);
  assert.equal(con.autoTryOn, false);
  assert.equal(con.versions.length, 1);

  const v1 = con.versions[0]!;
  assert.equal(v1.version, 1);
  assert.equal(v1.label, "V1 Original");
  assert.equal(v1.imageUrl, "/catalog/consultation-bag-v1.png");
  assert.equal(con.originalVersionId, v1.id);
  assert.equal(con.currentDesignVersionId, v1.id);
  assert.deepEqual(con.designState, DEFAULT_BAG_DESIGN_STATE);
  assert.equal(con.designState.hardwareColor, "gold");
  assert.equal(con.designState.strapType, "top handle");
  assert.equal(con.activity[0]?.text, "Consultation started");

  const bagInLook = session.currentLook.accessories.find((a) => a.subcategory === "bag");
  assert.ok(bagInLook);
  assert.equal(bagInLook.image, "/catalog/consultation-bag-v1.png");
});

test("updateConsultationSettings and setConsultationBotStatus transition status cleanly", () => {
  let session = createSessionRecord("ses_bot", null);
  session = initConsultation(session, {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });

  session = updateConsultationSettings(session, {
    autoApply: true,
    autoTryOn: true,
    activeViewMode: "tryon",
  });
  assert.equal(session.consultation?.autoApply, true);
  assert.equal(session.consultation?.autoTryOn, true);
  assert.equal(session.consultation?.activeViewMode, "tryon");

  session = setConsultationBotStatus(session, "WAITING_FOR_ADMISSION", {
    activityText: "Waiting for host approval in Google Meet lobby",
  });
  assert.equal(session.consultation?.status, "WAITING_FOR_ADMISSION");
  assert.equal(session.consultation?.botStatus, "WAITING_FOR_ADMISSION");

  session = setConsultationBotStatus(session, "LISTENING", {
    activityText: "Dressly AI Assistant admitted and listening",
  });
  assert.equal(session.consultation?.status, "LIVE");
  assert.equal(session.consultation?.botStatus, "LISTENING");
  assert.equal(session.consultation?.botError, null);

  session = setConsultationBotStatus(session, "RECONNECTING");
  assert.equal(session.consultation?.status, "RECONNECTING");

  // Bot failure keeps the consultation session alive in LIVE mode with botError recorded
  session = setConsultationBotStatus(session, "FAILED", {
    error: "Meet call ended remotely",
    activityText: "Dressly left the consultation",
  });
  assert.equal(session.consultation?.status, "LIVE");
  assert.equal(session.consultation?.botStatus, "FAILED");
  assert.equal(session.consultation?.botError, "Meet call ended remotely");
});

test("appendTranscriptSegment updates partial segment in-place and appends final segments as MEETING", () => {
  let session = createSessionRecord("ses_tr", null);
  session = initConsultation(session, {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });

  session = appendTranscriptSegment(session, {
    id: "seg_1",
    text: "I like it, but can we",
    isFinal: false,
  });
  assert.equal(session.consultation?.transcript.length, 1);
  assert.equal(session.consultation?.transcript[0]?.speaker, "MEETING");
  assert.equal(session.consultation?.transcript[0]?.isFinal, false);

  session = appendTranscriptSegment(session, {
    id: "seg_1",
    text: "I like it, but can we make the hardware gold?",
    isFinal: true,
  });
  assert.equal(session.consultation?.transcript.length, 1);
  assert.equal(
    session.consultation?.transcript[0]?.text,
    "I like it, but can we make the hardware gold?",
  );
  assert.equal(session.consultation?.transcript[0]?.isFinal, true);

  session = appendTranscriptSegment(session, {
    id: "seg_2",
    text: "And maybe make it slightly smaller.",
    isFinal: true,
  });
  assert.equal(session.consultation?.transcript.length, 2);
});

test("addProposedSuggestion deduplicates by fingerprint and actOnProposedSuggestion supports ignore, apply, and edit", () => {
  let session = createSessionRecord("ses_sug", null);
  session = initConsultation(session, {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });

  const fpA = computeChangeFingerprint([
    { field: "hardwareColor", proposedValue: "Gold" },
    { field: "size", proposedValue: "Small" },
  ]);
  const fpB = computeChangeFingerprint([
    { field: "size", proposedValue: "small" },
    { field: "hardwareColor", proposedValue: "  gold " },
  ]);
  assert.equal(fpA, fpB);

  session = addProposedSuggestion(session, {
    id: "sug_1",
    transcriptExcerpt: "Can we make the hardware gold?",
    confidence: 0.95,
    jevAction: "PROPOSE_CHANGE",
    jevReason: "Client requested gold hardware.",
    provider: "jev",
    changes: [
      {
        field: "hardwareColor",
        label: "HARDWARE",
        previousValue: "silver",
        proposedValue: "gold",
      },
    ],
  });
  assert.equal(session.consultation?.pendingSuggestions.length, 1);

  // Adding a second suggestion with the exact same change fingerprint is ignored
  session = addProposedSuggestion(session, {
    id: "sug_1_dup",
    transcriptExcerpt: "Yeah make the hardware gold please",
    confidence: 0.92,
    jevAction: "PROPOSE_CHANGE",
    jevReason: "Duplicate hardware request.",
    provider: "jev",
    changes: [
      {
        field: "hardwareColor",
        label: "HARDWARE",
        previousValue: "silver",
        proposedValue: "GOLD",
      },
    ],
  });
  assert.equal(session.consultation?.pendingSuggestions.length, 1);

  // Apply sug_1
  const applied = actOnProposedSuggestion(session, "sug_1", "apply");
  session = applied.session;
  assert.equal(applied.suggestion?.status, "APPROVED");
  assert.equal(session.consultation?.pendingSuggestions.length, 0);
  assert.equal(session.consultation?.approvedSuggestions.length, 1);
  assert.equal(session.consultation?.designState.hardwareColor, "gold");

  // Add suggestion 2 and Edit inline ("dark brown" -> "espresso brown")
  session = addProposedSuggestion(session, {
    id: "sug_2",
    transcriptExcerpt: "Let's try a dark brown leather",
    confidence: 0.89,
    jevAction: "PROPOSE_CHANGE",
    jevReason: "Client asked for dark brown color.",
    provider: "jev",
    changes: [
      {
        field: "primaryColor",
        label: "COLOR",
        previousValue: "burgundy",
        proposedValue: "dark brown",
      },
    ],
  });

  const edited = actOnProposedSuggestion(session, "sug_2", "edit", [
    {
      field: "primaryColor",
      label: "COLOR",
      previousValue: "burgundy",
      proposedValue: "espresso brown",
    },
  ]);
  session = edited.session;
  assert.equal(edited.suggestion?.status, "EDITED");
  assert.equal(session.consultation?.designState.primaryColor, "espresso brown");
  assert.equal(session.consultation?.approvedSuggestions.length, 2);

  // Add suggestion 3 and Ignore
  session = addProposedSuggestion(session, {
    id: "sug_3",
    transcriptExcerpt: "Maybe add fringe?",
    confidence: 0.62,
    jevAction: "PROPOSE_CHANGE",
    jevReason: "Low-confidence decorative idea.",
    provider: "fallback",
    changes: [
      {
        field: "pattern",
        label: "PATTERN",
        previousValue: "solid",
        proposedValue: "fringed",
      },
    ],
  });
  const ignored = actOnProposedSuggestion(session, "sug_3", "ignore");
  session = ignored.session;
  assert.equal(ignored.suggestion?.status, "IGNORED");
  assert.equal(session.consultation?.ignoredSuggestions.length, 1);
  assert.equal(session.consultation?.designState.pattern, "solid");
});

test("recordDesignVersion, restoreDesignVersion, attachTryOnToVersion, and endConsultation manage version history", () => {
  let session = createSessionRecord("ses_ver", null);
  session = initConsultation(session, {
    initialDesignState: { hardwareColor: "silver" },
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });

  const v1Id = session.consultation!.originalVersionId;
  session = setConsultationStatus(session, "GENERATING_DESIGN");

  const v2State = applyChangesToBagState(session.consultation!.designState, [
    { field: "hardwareColor", label: "HARDWARE", previousValue: "silver", proposedValue: "gold" },
  ]);

  const recordedV2 = recordDesignVersion(session, {
    id: "ver_2",
    imageUrl: "/api/media/results/design_v2.png",
    label: "Gold hardware",
    summary: "Changed hardware from silver to gold",
    designState: v2State,
  });
  session = recordedV2.session;
  assert.equal(recordedV2.version.version, 2);
  assert.equal(recordedV2.version.label, "V2 Gold hardware");
  assert.equal(session.consultation?.status, "LIVE");
  assert.equal(session.consultation?.currentDesignVersionId, "ver_2");
  assert.equal(session.consultation?.designState.hardwareColor, "gold");
  assert.equal(
    session.currentLook.accessories.find((a) => a.subcategory === "bag")?.image,
    "/api/media/results/design_v2.png",
  );

  // Attach a virtual try-on look to V2
  session = attachTryOnToVersion(session, "ver_2", "look_vto_2");
  assert.equal(session.consultation?.activeViewMode, "tryon");
  assert.equal(
    session.consultation?.versions.find((v) => v.id === "ver_2")?.tryOnLookId,
    "look_vto_2",
  );

  // Restore V1 Original
  session = restoreDesignVersion(session, v1Id);
  assert.equal(session.consultation?.currentDesignVersionId, v1Id);
  assert.equal(session.consultation?.designState.hardwareColor, "silver");
  assert.equal(session.consultation?.activeViewMode, "design");
  assert.equal(
    session.currentLook.accessories.find((a) => a.subcategory === "bag")?.image,
    "/catalog/consultation-bag-v1.png",
  );

  // Append custom activity and end consultation
  session = appendConsultationActivity(session, "speech", "Client approved final look");
  session = endConsultation(session);
  assert.equal(session.consultation?.status, "ENDED");
  assert.equal(session.consultation?.botStatus, "STOPPED");
  assert.ok(session.consultation?.endedAt);
});

test("renderStudioBagSvg generates clean 896x1200 studio SVG reflecting state variations", () => {
  const v1Svg = renderStudioBagSvg(DEFAULT_BAG_DESIGN_STATE, { versionLabel: "V1 Original" });
  assert.ok(v1Svg.includes('width="896" height="1200"'));
  assert.ok(v1Svg.includes("#5d1b26")); // burgundy leather

  const crossbodyGoldSvg = renderStudioBagSvg({
    ...DEFAULT_BAG_DESIGN_STATE,
    primaryColor: "espresso brown",
    hardwareColor: "gold",
    size: "small",
    strapType: "crossbody",
    strapLength: "longer adjustable crossbody",
  });
  assert.ok(crossbodyGoldSvg.includes("#3c2419")); // espresso leather
  assert.ok(crossbodyGoldSvg.includes("#d7ad59")); // gold hardware
  assert.ok(crossbodyGoldSvg.includes("Crossbody adjustable buckle detail"));
});
