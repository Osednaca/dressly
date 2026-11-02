import assert from "node:assert/strict";
import test from "node:test";
import { POST as postBotEvent } from "@/app/api/sessions/[id]/consultation/bot-event/route";
import { POST as postDiagnostics } from "@/app/api/sessions/[id]/consultation/diagnostics/route";
import {
  endSessionConsultation,
  handleSuggestionAction,
  ingestConsultationTranscript,
  startSessionConsultation,
} from "@/lib/agent/consultation-orchestrator";
import { pollConsultationTryOn } from "@/lib/agent/consultation-tryon";
import type {
  ConsultationDiagnosticAction,
  ConsultationDiagnosticResponse,
} from "@/lib/api-types";
import { env } from "@/lib/env";
import {
  clearConsultationLogs,
  CONSULTATION_MILESTONES,
  getRecentConsultationLogs,
  logConsultationMilestone,
} from "@/lib/server/consultation-logger";
import { createSession, getSession } from "@/lib/session/store";
import { MEETING_BOT_SECRET_HEADER } from "@/services/meeting-bot/contract";
import { meetingBotClient } from "@/services/meeting-bot/client";

async function invokeDiagnostic(
  sessionId: string,
  action: ConsultationDiagnosticAction,
  extra?: Record<string, unknown>,
): Promise<ConsultationDiagnosticResponse> {
  const req = new Request(
    `http://127.0.0.1:3000/api/sessions/${sessionId}/consultation/diagnostics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    },
  );
  const res = await postDiagnostics(req, {
    params: Promise.resolve({ id: sessionId }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as ConsultationDiagnosticResponse;
}

test("logConsultationMilestone records all 13 milestones and redacts secret keys and raw audio", () => {
  clearConsultationLogs();
  const sessionId = "sess_logger_milestone_test";

  for (const milestone of CONSULTATION_MILESTONES) {
    logConsultationMilestone(milestone, {
      sessionId,
      stepIndex: CONSULTATION_MILESTONES.indexOf(milestone),
      apiKey: "super-secret-gemini-key",
      meetingBotSecret: "top-secret-header",
      authorization: "Bearer sk-live-12345",
      sessionToken: "tok_999",
      rawAudioPcm: Buffer.from([1, 2, 3, 4]),
      nested: {
        privateKey: "hidden",
        pcmChunk: "base64-audio-data",
        safeField: "visible-value",
      },
    });
  }

  const logs = getRecentConsultationLogs(sessionId);
  assert.equal(logs.length, 13);
  assert.deepEqual(
    logs.map((entry) => entry.milestone),
    [...CONSULTATION_MILESTONES],
  );

  for (const entry of logs) {
    assert.equal(entry.details.apiKey, "[REDACTED]");
    assert.equal(entry.details.meetingBotSecret, "[REDACTED]");
    assert.equal(entry.details.authorization, "[REDACTED]");
    assert.equal(entry.details.sessionToken, "[REDACTED]");
    assert.equal(entry.details.rawAudioPcm, "[REDACTED]");
    const nested = entry.details.nested as Record<string, unknown>;
    assert.equal(nested.privateKey, "[REDACTED]");
    assert.equal(nested.pcmChunk, "[REDACTED]");
    assert.equal(nested.safeField, "visible-value");

    const serialized = JSON.stringify(entry);
    assert.ok(!serialized.includes("super-secret-gemini-key"));
    assert.ok(!serialized.includes("top-secret-header"));
    assert.ok(!serialized.includes("sk-live-12345"));
    assert.ok(!serialized.includes("base64-audio-data"));
  }
});

test("Diagnostics endpoint supports all 8 layer-by-layer actions and seeds demo photo for VTO", async (t) => {
  t.mock.method(meetingBotClient, "getHealth", async () => null);
  t.mock.method(meetingBotClient, "startSession", async () => ({ workerConnected: false, status: "FAILED", message: "Worker unavailable" }));
  t.mock.method(meetingBotClient, "reconnectSession", async () => ({ workerConnected: false, status: "FAILED", message: "Worker unavailable" }));
  clearConsultationLogs();
  const created = await createSession(null);
  assert.equal(created.userPhotoPath, null);

  await startSessionConsultation(created.id, {
    meetingUrl: "demo://local-consultation",
    consentConfirmed: true,
  });

  // 1. test_bot_join
  const joinRes = await invokeDiagnostic(created.id, "test_bot_join");
  assert.equal(joinRes.ok, false);
  assert.equal(joinRes.action, "test_bot_join");
  assert.equal(joinRes.session.consultation?.botStatus, "FAILED");
  assert.equal(joinRes.session.consultation?.status, "LIVE");
  assert.equal(typeof joinRes.details?.workerConnected, "boolean");
  assert.equal(typeof joinRes.details?.chromiumFound, "boolean");
  assert.equal(typeof joinRes.details?.ffmpegFound, "boolean");

  // 2. reconnect_bot
  const reconnectRes = await invokeDiagnostic(created.id, "reconnect_bot");
  assert.equal(reconnectRes.ok, false);
  assert.equal(reconnectRes.action, "reconnect_bot");
  assert.equal(reconnectRes.session.consultation?.botStatus, "FAILED");

  // 3. test_audio_capture
  const audioRes = await invokeDiagnostic(created.id, "test_audio_capture");
  assert.equal(audioRes.ok, true);
  assert.equal(audioRes.action, "test_audio_capture");
  assert.equal(audioRes.details?.sampleRate, 16000);
  assert.equal(audioRes.details?.channels, 1);
  assert.ok(Number(audioRes.details?.chunksEmitted ?? 0) >= 2);
  assert.ok(Number(audioRes.details?.bytesTotal ?? 0) >= 6400);

  // 4. test_gemini_stream
  const geminiRes = await invokeDiagnostic(created.id, "test_gemini_stream");
  assert.equal(geminiRes.ok, true);
  assert.equal(geminiRes.action, "test_gemini_stream");
  assert.equal(geminiRes.details?.liveAudioTranscriptionEnabled, true);

  // 5. simulate_transcript
  const transcriptRes = await invokeDiagnostic(created.id, "simulate_transcript", {
    text: "Could we make the strap longer so I can wear it crossbody?",
  });
  assert.equal(transcriptRes.ok, true);
  assert.equal(transcriptRes.action, "simulate_transcript");
  assert.equal(transcriptRes.details?.jevDecision, "PROPOSE_CHANGE");
  assert.ok(transcriptRes.details?.suggestionId);

  // 6. simulate_suggestion
  const sugRes = await invokeDiagnostic(created.id, "simulate_suggestion");
  assert.equal(sugRes.ok, true);
  assert.equal(sugRes.action, "simulate_suggestion");
  assert.ok(sugRes.details?.suggestionId);
  assert.ok((sugRes.session.consultation?.pendingSuggestions.length ?? 0) >= 2);

  // 7. test_runway_revision
  const runwayRes = await invokeDiagnostic(created.id, "test_runway_revision");
  assert.equal(runwayRes.ok, true);
  assert.equal(runwayRes.action, "test_runway_revision");
  assert.ok((runwayRes.session.consultation?.versions.length ?? 0) >= 2);

  // 8. test_youcam_vto (auto-populates demo_customer_portrait.png when userPhotoPath is null)
  const vtoRes = await invokeDiagnostic(created.id, "test_youcam_vto");
  assert.equal(vtoRes.ok, true);
  assert.equal(vtoRes.action, "test_youcam_vto");
  assert.equal(vtoRes.blocked, null);
  assert.ok(vtoRes.job);
  assert.equal(
    vtoRes.session.userPhotoPath,
    "/api/media/uploads/demo_customer_portrait.png",
  );

  const polledVto = await pollConsultationTryOn(vtoRes.job.id);
  assert.ok(polledVto);
  assert.equal(polledVto.job.status, "success");
  assert.ok(polledVto.look);

  await endSessionConsultation(created.id);

  // Verify end-to-end milestones were recorded in the structured logger
  const recordedMilestones = new Set(
    getRecentConsultationLogs(created.id).map((l) => l.milestone),
  );
  for (const expected of CONSULTATION_MILESTONES) {
    if (["suggestion approved", "meet loaded", "bot admitted", "audio capture started", "Gemini connected"].includes(expected)) continue;
    assert.ok(
      recordedMilestones.has(expected),
      `Expected milestone "${expected}" to be logged`,
    );
  }
});

test("Failure isolation: when bot worker fails (botStatus = FAILED), manual transcript, suggestion approval, V2 generation, VTO, and Rejoin continue working", async (t) => {
  t.mock.method(meetingBotClient, "startSession", async () => ({ workerConnected: false, status: "FAILED", message: "Worker unavailable" }));
  t.mock.method(meetingBotClient, "reconnectSession", async () => ({ workerConnected: false, status: "FAILED", message: "Worker unavailable" }));
  const created = await createSession(null);
  await startSessionConsultation(created.id, {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    consentConfirmed: true,
  });

  // Simulate fatal bot worker failure via webhook (recoverable: false -> botStatus = "FAILED")
  const errorWebhookReq = new Request(
    `http://127.0.0.1:3000/api/sessions/${created.id}/consultation/bot-event`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret,
      },
      body: JSON.stringify({
        type: "bot.error",
        consultationSessionId: created.id,
        message: "Dressly left the consultation (simulated browser crash)",
        recoverable: false,
        timestamp: new Date().toISOString(),
      }),
    },
  );
  const webhookRes = await postBotEvent(errorWebhookReq, {
    params: Promise.resolve({ id: created.id }),
  });
  assert.equal(webhookRes.status, 200);

  const afterBotFailure = await getSession(created.id);
  assert.equal(afterBotFailure?.consultation?.botStatus, "FAILED");
  // Consultation session itself remains LIVE so the designer never loses their workspace!
  assert.equal(afterBotFailure?.consultation?.status, "LIVE");

  // Manual transcript & suggestion approval still create V2 while botStatus is FAILED
  const turn = await ingestConsultationTranscript(created.id, {
    text: "I like it, but can we make the hardware silver?",
    isFinal: true,
    immediate: true,
  });
  assert.ok(turn?.suggestion);

  const applied = await handleSuggestionAction(created.id, turn.suggestion.id, {
    action: "apply",
  });
  assert.ok(applied);
  assert.equal(applied.session.consultation?.versions.length, 2);
  assert.equal(applied.session.consultation?.versions[1]?.label, "V2 Silver hardware");

  // VTO diagnostic still works on V2 while bot is failed
  const vtoDiag = await invokeDiagnostic(created.id, "test_youcam_vto");
  assert.equal(vtoDiag.ok, true);
  assert.ok(vtoDiag.job);
  const polledVto = await pollConsultationTryOn(vtoDiag.job.id);
  assert.equal(polledVto?.job.status, "success");

  // Rejoin reports failure honestly while the worker remains unreachable.
  const rejoined = await invokeDiagnostic(created.id, "reconnect_bot");
  assert.equal(rejoined.ok, false);
  assert.equal(rejoined.session.consultation?.botStatus, "FAILED");
  assert.equal(rejoined.session.consultation?.status, "LIVE");
});
