import assert from "node:assert/strict";
import test from "node:test";
import {
  handleSuggestionAction,
  ingestConsultationTranscript,
  restoreSessionDesignVersion,
  startSessionConsultation,
} from "@/lib/agent/consultation-orchestrator";
import {
  pollConsultationTryOn,
  startConsultationTryOn,
} from "@/lib/agent/consultation-tryon";
import { subscribeConsultationEvents } from "@/lib/server/consultation-events";
import { createSession, getSession, mutateSession } from "@/lib/session/store";
import { ProviderError } from "@/lib/util/http";
import type { TryOnEngine } from "@/services/contracts";

test("Flagship 4-step handbag consultation scenario (V1 -> V2 -> V3 -> V4 -> YouCam VTO -> Restore V2)", async () => {
  const created = await createSession(null);
  const sseEventTypes: string[] = [];
  const unsubscribe = subscribeConsultationEvents(created.id, (ev) => {
    sseEventTypes.push(ev.type);
  });

  try {
    // 1. Start consultation: V1 Original (medium burgundy leather shoulder bag, silver hardware, shoulder strap)
    const started = await startSessionConsultation(created.id, {
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      consentConfirmed: true,
    });
    assert.ok(started);
    const v1 = started.session.consultation!.versions[0]!;
    assert.equal(v1.version, 1);
    assert.equal(v1.label, "V1 Original");
    assert.equal(started.session.consultation?.designState.primaryColor, "burgundy");
    assert.equal(started.session.consultation?.designState.size, "medium");
    assert.equal(started.session.consultation?.designState.hardwareColor, "silver");
    assert.equal(started.session.consultation?.designState.strapType, "shoulder");

    // 2. Turn 1: "I like it, but can we make the hardware gold?" -> PROPOSE_CHANGE -> Apply -> V2
    const turn1 = await ingestConsultationTranscript(created.id, {
      text: "I like it, but can we make the hardware gold?",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn1?.suggestion);
    assert.equal(turn1.decision?.consultationAction?.decision, "PROPOSE_CHANGE");
    assert.equal(turn1.suggestion.changes[0]?.field, "hardwareColor");
    assert.equal(turn1.suggestion.changes[0]?.previousValue, "silver");
    assert.equal(turn1.suggestion.changes[0]?.proposedValue, "gold");

    const appliedV2 = await handleSuggestionAction(created.id, turn1.suggestion.id, {
      action: "apply",
    });
    assert.ok(appliedV2);
    assert.equal(appliedV2.session.consultation?.versions.length, 2);
    const v2 = appliedV2.session.consultation!.versions[1]!;
    assert.equal(v2.version, 2);
    assert.equal(v2.label, "V2 Gold hardware");
    assert.equal(v2.designState.hardwareColor, "gold");
    assert.ok(v2.promptUsed?.includes("@latest_design"));
    assert.ok(v2.promptUsed?.includes('"gold"'));
    assert.ok(!v2.promptUsed?.includes("@original_design"));

    // 3. Turn 2: "That's better. Maybe make it a little smaller." -> PROPOSE_CHANGE -> Apply -> V3
    const turn2 = await ingestConsultationTranscript(created.id, {
      text: "That's better. Maybe make it a little smaller.",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn2?.suggestion);
    assert.equal(turn2.decision?.consultationAction?.decision, "PROPOSE_CHANGE");
    assert.equal(turn2.suggestion.changes[0]?.field, "size");
    assert.equal(turn2.suggestion.changes[0]?.previousValue, "medium");
    assert.equal(turn2.suggestion.changes[0]?.proposedValue, "small");

    const appliedV3 = await handleSuggestionAction(created.id, turn2.suggestion.id, {
      action: "apply",
    });
    assert.ok(appliedV3);
    assert.equal(appliedV3.session.consultation?.versions.length, 3);
    const v3 = appliedV3.session.consultation!.versions[2]!;
    assert.equal(v3.version, 3);
    assert.equal(v3.label, "V3 Smaller silhouette");
    assert.equal(v3.designState.size, "small");
    assert.equal(v3.designState.hardwareColor, "gold");
    // V3 must include BOTH @latest_design and @original_design to prevent multi-turn drift
    assert.ok(v3.promptUsed?.includes("@latest_design"));
    assert.ok(v3.promptUsed?.includes("@original_design"));

    // 4. Turn 3: "Could we make the strap longer so I can wear it crossbody?" -> PROPOSE_CHANGE -> Apply -> V4
    const turn3 = await ingestConsultationTranscript(created.id, {
      text: "Could we make the strap longer so I can wear it crossbody?",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn3?.suggestion);
    assert.equal(turn3.decision?.consultationAction?.decision, "PROPOSE_CHANGE");
    assert.ok(
      turn3.suggestion.changes.some(
        (c) => c.field === "strapType" && c.proposedValue === "crossbody",
      ),
    );

    const appliedV4 = await handleSuggestionAction(created.id, turn3.suggestion.id, {
      action: "apply",
    });
    assert.ok(appliedV4);
    assert.equal(appliedV4.session.consultation?.versions.length, 4);
    const v4 = appliedV4.session.consultation!.versions[3]!;
    assert.equal(v4.version, 4);
    assert.equal(v4.label, "V4 Crossbody strap");
    assert.equal(v4.designState.strapType, "crossbody");
    assert.equal(v4.designState.size, "small");
    assert.equal(v4.designState.hardwareColor, "gold");
    assert.ok(v4.promptUsed?.includes("@latest_design"));
    assert.ok(v4.promptUsed?.includes("@original_design"));

    // 5. Turn 4: Set userPhotoPath on the session, then customer says "Can I see how that looks on me?"
    await mutateSession(created.id, (s) => ({
      ...s,
      userPhotoPath: "/catalog/consultation-bag-v1.png",
    }));

    const turn4 = await ingestConsultationTranscript(created.id, {
      text: "Can I see how that looks on me?",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn4);
    assert.equal(turn4.decision?.consultationAction?.decision, "TRY_ON_CURRENT_DESIGN");
    assert.equal(turn4.blocked, null);
    assert.ok(turn4.autoJob);
    assert.equal(turn4.autoJob.kind, "consultation_tryon");
    assert.equal(turn4.autoJob.status, "pending");

    const polledVto = await pollConsultationTryOn(turn4.autoJob.id);
    assert.ok(polledVto);
    assert.equal(polledVto.job.status, "success");
    assert.ok(polledVto.look);
    assert.ok(polledVto.look.imagePath.startsWith("/api/media/results/look_"));
    assert.equal(polledVto.session?.consultation?.activeViewMode, "tryon");

    const updatedV4 = polledVto.session?.consultation?.versions.find((v) => v.id === v4.id);
    assert.equal(updatedV4?.tryOnLookId, polledVto.look.id);

    // 6. Restore back to V2 and verify subsequent modification uses V2 as @latest_design
    const restoredToV2 = await restoreSessionDesignVersion(created.id, v2.id);
    assert.ok(restoredToV2);
    assert.equal(restoredToV2.consultation?.currentDesignVersionId, v2.id);
    assert.equal(restoredToV2.consultation?.designState.size, "medium");
    assert.equal(restoredToV2.consultation?.designState.strapType, "shoulder");
    assert.equal(restoredToV2.consultation?.designState.hardwareColor, "gold");

    const turn5 = await ingestConsultationTranscript(created.id, {
      text: "Let's try espresso brown leather from this version.",
      isFinal: true,
      immediate: true,
    });
    assert.ok(turn5?.suggestion);
    const appliedV5 = await handleSuggestionAction(created.id, turn5.suggestion.id, {
      action: "apply",
    });
    assert.ok(appliedV5);
    const v5 = appliedV5.session.consultation!.versions.at(-1)!;
    assert.equal(v5.version, 5);
    assert.equal(v5.designState.primaryColor, "espresso brown");
    // Because we restored V2 (size: medium, strapType: shoulder), V5 preserves V2's medium size and shoulder strap!
    assert.equal(v5.designState.size, "medium");
    assert.equal(v5.designState.strapType, "shoulder");
    assert.ok(
      v5.promptUsed?.includes('- SIZE (size): preserve "medium" identically to @latest_design and @original_design'),
    );
    assert.ok(
      v5.promptUsed?.includes('- STRAP (strapType): preserve "shoulder" identically to @latest_design and @original_design'),
    );

    assert.ok(sseEventTypes.includes("vto.started"));
    assert.ok(sseEventTypes.includes("vto.completed"));
  } finally {
    unsubscribe();
  }
});

test("startConsultationTryOn handles missing photo and upstream YouCam ProviderError honestly", async () => {
  const created = await createSession(null);
  const started = await startSessionConsultation(created.id, {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });
  assert.ok(started);

  // Without userPhotoPath -> PHOTO_REQUIRED
  const noPhotoRes = await startConsultationTryOn(started.session);
  assert.equal(noPhotoRes.job, null);
  assert.equal(noPhotoRes.blocked?.code, "PHOTO_REQUIRED");

  // With userPhotoPath but YouCam /s2s/v2.0/task/bag throws ProviderError -> BAG_VTO_UNAVAILABLE
  const withPhoto = await mutateSession(created.id, (s) => ({
    ...s,
    userPhotoPath: "/catalog/consultation-bag-v1.png",
  }));
  assert.ok(withPhoto);

  const failingEngine: TryOnEngine = {
    provider: "youcam",
    async submit() {
      throw new ProviderError("youcam", 403, "bag task endpoint not enabled for key", {
        retryable: false,
      });
    },
    async poll() {
      throw new Error("unreachable");
    },
  };

  const capErrorRes = await startConsultationTryOn(withPhoto, undefined, {
    engine: failingEngine,
  });
  assert.equal(capErrorRes.job, null);
  assert.equal(capErrorRes.blocked?.code, "BAG_VTO_UNAVAILABLE");
  assert.equal(capErrorRes.blocked?.retryable, false);
  assert.equal(capErrorRes.session.consultation?.status, "LIVE");

  const latest = await getSession(created.id);
  assert.ok(
    latest?.consultation?.activity.some((a) =>
      a.text.includes("Virtual try-on unavailable"),
    ),
  );
});
