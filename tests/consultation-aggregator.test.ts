import assert from "node:assert/strict";
import test from "node:test";
import {
  clearConsultationDebounce,
  computeChangeFingerprint,
  enqueueConsultationUtterance,
  isDuplicateProposal,
  isDuplicateTranscript,
  normalizeTranscriptText,
  pruneRedundantChanges,
  transcriptSimilarity,
} from "@/lib/agent/consultation-aggregator";
import {
  endSessionConsultation,
  handleSuggestionAction,
  ingestConsultationTranscript,
  restoreSessionDesignVersion,
  startSessionConsultation,
} from "@/lib/agent/consultation-orchestrator";
import { subscribeConsultationEvents } from "@/lib/server/consultation-events";
import { createSession } from "@/lib/session/store";
import { DEFAULT_BAG_DESIGN_STATE } from "@/lib/types";
import { extractConsultationCandidateDeterministic } from "@/services/gemini/consultation";
import { buildConsultationJevSignals, evaluateConsultationDeterministic } from "@/services/jev";

test("normalizeTranscriptText and transcriptSimilarity deduplicate near-identical utterances", () => {
  const a = "make the strap longer";
  const b = "Yeah, please make that strap longer!";

  assert.equal(normalizeTranscriptText(a), "make the strap longer");
  assert.equal(normalizeTranscriptText(b), "make that strap longer");

  const sim = transcriptSimilarity(a, b);
  assert.ok(sim >= 0.8, `Expected similarity >= 0.80, got ${sim}`);

  const now = Date.now();
  const recent = [
    {
      text: "make the strap longer",
      isFinal: true,
      timestamp: new Date(now - 3_000).toISOString(),
    },
  ];

  assert.equal(isDuplicateTranscript(b, recent, now, 15_000), true);
  assert.equal(
    isDuplicateTranscript("can we change the hardware to gold", recent, now, 15_000),
    false,
  );
  // Outside 15s window is not treated as duplicate
  assert.equal(isDuplicateTranscript(b, recent, now + 25_000, 15_000), false);
});

test("pruneRedundantChanges filters out no-op changes and populates labels", () => {
  const pruned = pruneRedundantChanges(
    [
      { field: "hardwareColor", proposedValue: "silver" }, // already silver in DEFAULT_BAG_DESIGN_STATE
      { field: "primaryColor", proposedValue: "Burgundy" }, // already burgundy
      { field: "size", proposedValue: "small" }, // medium -> small
    ],
    DEFAULT_BAG_DESIGN_STATE,
  );

  assert.equal(pruned.length, 1);
  assert.deepEqual(pruned[0], {
    field: "size",
    label: "SIZE",
    previousValue: "medium",
    proposedValue: "small",
  });
});

test("enqueueConsultationUtterance merges split clauses within debounce window into a single multi-field proposal", async () => {
  const mergedClauses: string[] = [];
  const p1 = enqueueConsultationUtterance(
    "ses_debounce_test",
    "Let's make it smaller...",
    async (merged) => {
      mergedClauses.push(merged);
    },
    40,
  );
  const p2 = enqueueConsultationUtterance(
    "ses_debounce_test",
    "...and perhaps use gold hardware",
    async (merged) => {
      mergedClauses.push(merged);
    },
    40,
  );

  await Promise.all([p1, p2]);
  clearConsultationDebounce("ses_debounce_test");

  assert.equal(mergedClauses.length, 1);
  assert.equal(
    mergedClauses[0],
    "Let's make it smaller and perhaps use gold hardware",
  );

  const extraction = extractConsultationCandidateDeterministic(
    mergedClauses[0]!,
    DEFAULT_BAG_DESIGN_STATE,
  );
  assert.equal(extraction.isRelevantFashionSpeech, true);
  assert.equal(extraction.speechKind, "design_modification");

  const diffs = pruneRedundantChanges(extraction.changes, DEFAULT_BAG_DESIGN_STATE);
  const fields = new Map(diffs.map((d) => [d.field, d.proposedValue]));
  assert.equal(fields.get("size"), "small");
  assert.equal(fields.get("hardwareColor"), "gold");
});

test("irrelevant small talk, audio checks, and retractions resolve to IGNORE with zero suggestions", async () => {
  const session = await createSession(null);
  const started = await startSessionConsultation(session.id, {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });
  assert.ok(started);

  const irrelevantUtterances = [
    "How was your weekend?",
    "Can you hear me?",
    "I like coffee",
    "Actually never mind, leave it as is",
  ];

  for (const text of irrelevantUtterances) {
    const turn = await ingestConsultationTranscript(session.id, {
      text,
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn);
    assert.equal(turn.suggestion, null, `Expected null suggestion for "${text}"`);
    assert.equal(
      turn.decision?.consultationAction?.decision,
      "IGNORE",
      `Expected JEV IGNORE for "${text}"`,
    );
  }

  const finalTurn = await ingestConsultationTranscript(session.id, {
    text: "Give me a second",
    isFinal: true,
    immediate: true,
  });
  assert.equal(finalTurn?.session.consultation?.pendingSuggestions.length, 0);
});

test("deterministic extractor and JEV evaluator handle relative sizes, try-on, revert, and finalize", () => {
  const largeBag = { ...DEFAULT_BAG_DESIGN_STATE, size: "large" };
  const tooBigFromLarge = extractConsultationCandidateDeterministic(
    "This feels too big for an evening bag",
    largeBag,
  );
  assert.equal(
    tooBigFromLarge.changes.find((c) => c.field === "size")?.proposedValue,
    "medium",
  );

  const tooBigFromMedium = extractConsultationCandidateDeterministic(
    "This feels too big",
    DEFAULT_BAG_DESIGN_STATE,
  );
  assert.equal(
    tooBigFromMedium.changes.find((c) => c.field === "size")?.proposedValue,
    "small",
  );

  const tryOnExt = extractConsultationCandidateDeterministic(
    "Can I see how that looks on me?",
    DEFAULT_BAG_DESIGN_STATE,
  );
  assert.equal(tryOnExt.speechKind, "try_on_request");
  const tryOnSignals = buildConsultationJevSignals(
    tryOnExt,
    [],
    {
      id: "con_1",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      consentConfirmed: true,
      status: "LIVE",
      botStatus: "LISTENING",
      designState: DEFAULT_BAG_DESIGN_STATE,
      originalVersionId: "v1",
      currentDesignVersionId: "v1",
      activeViewMode: "design",
      versions: [],
      pendingSuggestions: [],
      approvedSuggestions: [],
      ignoredSuggestions: [],
      transcript: [],
      activity: [],
      autoApply: false,
      autoApplyThreshold: 0.9,
      autoTryOn: false,
      startedAt: new Date().toISOString(),
    },
  );
  const tryOnJev = evaluateConsultationDeterministic(
    tryOnSignals.request,
    tryOnSignals.signals,
  );
  assert.equal(tryOnJev.decision, "TRY_ON_CURRENT_DESIGN");
});

test("full consultation orchestrator lifecycle: start -> ingest -> apply (V2) -> edit (V3) -> restore (V1) -> end", async () => {
  const session = await createSession(null);
  const sseEventTypes: string[] = [];
  const unsubscribe = subscribeConsultationEvents(session.id, (ev) => {
    sseEventTypes.push(ev.type);
  });

  try {
    const started = await startSessionConsultation(session.id, {
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      consentConfirmed: true,
    });
    assert.ok(started);
    const v1Id = started.session.consultation!.originalVersionId;

    // 1. Ingest "I like it, but can we make the hardware gold?"
    const turn1 = await ingestConsultationTranscript(session.id, {
      text: "I like it, but can we make the hardware gold?",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn1?.suggestion);
    assert.equal(turn1.decision?.consultationAction?.decision, "PROPOSE_CHANGE");
    assert.equal(turn1.suggestion.changes[0]?.field, "hardwareColor");
    assert.equal(turn1.suggestion.changes[0]?.proposedValue, "gold");

    // 2. Apply suggestion -> creates V2 with rendered PNG
    const appliedV2 = await handleSuggestionAction(session.id, turn1.suggestion.id, {
      action: "apply",
    });
    assert.ok(appliedV2);
    assert.equal(appliedV2.session.consultation?.versions.length, 2);
    const v2 = appliedV2.session.consultation!.versions[1]!;
    assert.equal(v2.version, 2);
    assert.equal(v2.label, "V2 Gold hardware");
    assert.ok(v2.imageUrl.startsWith("/api/media/results/design_"));
    assert.equal(appliedV2.session.consultation?.designState.hardwareColor, "gold");

    // Duplicate proposal check within 20s window
    const fpGold = computeChangeFingerprint([
      { field: "hardwareColor", proposedValue: "gold" },
    ]);
    assert.equal(
      isDuplicateProposal(fpGold, appliedV2.session.consultation!),
      true,
    );

    // 3. Ingest second modification and Edit inline to "espresso brown" -> creates V3
    const turn2 = await ingestConsultationTranscript(session.id, {
      text: "Could we try a darker leather shade?",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn2?.suggestion);

    const editedV3 = await handleSuggestionAction(session.id, turn2.suggestion.id, {
      action: "edit",
      editedChanges: [
        {
          field: "primaryColor",
          label: "COLOR",
          previousValue: "burgundy",
          proposedValue: "espresso brown",
        },
      ],
    });
    assert.ok(editedV3);
    assert.equal(editedV3.suggestion?.status, "EDITED");
    assert.equal(editedV3.session.consultation?.versions.length, 3);
    const v3 = editedV3.session.consultation!.versions[2]!;
    assert.equal(v3.version, 3);
    assert.equal(v3.label, "V3 Espresso brown leather");
    assert.equal(
      editedV3.session.consultation?.designState.primaryColor,
      "espresso brown",
    );

    // 4. Restore V1 Original
    const restored = await restoreSessionDesignVersion(session.id, v1Id);
    assert.ok(restored);
    assert.equal(restored.consultation?.currentDesignVersionId, v1Id);
    assert.equal(restored.consultation?.designState.hardwareColor, "silver");
    assert.equal(restored.consultation?.designState.primaryColor, "burgundy");

    // 5. End consultation
    const ended = await endSessionConsultation(session.id);
    assert.equal(ended?.consultation?.status, "ENDED");
    assert.ok(sseEventTypes.includes("suggestion.created"));
    assert.ok(sseEventTypes.includes("design.generation.completed"));
    assert.ok(sseEventTypes.includes("consultation.ended"));
  } finally {
    unsubscribe();
  }
});
