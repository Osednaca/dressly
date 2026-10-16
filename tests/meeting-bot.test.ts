import assert from "node:assert/strict";
import test from "node:test";
import { POST as postBotEvent } from "@/app/api/sessions/[id]/consultation/bot-event/route";
import { startSessionConsultation } from "@/lib/agent/consultation-orchestrator";
import { env } from "@/lib/env";
import { createSession, getSession } from "@/lib/session/store";
import {
  ChromeMeetAudioSource,
  resolveFfmpegExecutable,
} from "@/services/meeting-bot/audio-capture";
import {
  generateSinePcm16leFrame,
  PCM_CHANNELS,
  PCM_FRAME_BYTES,
  PCM_SAMPLE_RATE,
  SimulatedMeetAudioSource,
  type AudioChunkPayload,
} from "@/services/meeting-bot/audio-source";
import { meetingBotClient } from "@/services/meeting-bot/client";
import {
  DEFAULT_BOT_DISPLAY_NAME,
  MEETING_BOT_SECRET_HEADER,
} from "@/services/meeting-bot/contract";
import {
  GeminiConsultationLiveStream,
  type MinimalWebSocket,
} from "@/services/meeting-bot/gemini-stream";
import { resolveChromiumExecutable } from "@/services/meeting-bot/playwright-bot";
import { createBotWorkerServer } from "@/services/meeting-bot/worker";

test("resolveChromiumExecutable and resolveFfmpegExecutable locate local binaries", () => {
  const chromiumPath = resolveChromiumExecutable();
  const ffmpegPath = resolveFfmpegExecutable();

  assert.equal(typeof chromiumPath, "string");
  assert.ok(chromiumPath && chromiumPath.length > 0);
  assert.equal(typeof ffmpegPath, "string");
  assert.ok(ffmpegPath && ffmpegPath.length > 0);
});

test("SimulatedMeetAudioSource and ChromeMeetAudioSource emit 3200-byte 16kHz mono s16le frames", async () => {
  const sim = new SimulatedMeetAudioSource({ intervalMs: 40, emitImmediately: true });
  const simChunks: AudioChunkPayload[] = [];
  const offSim = sim.onAudioChunk((chunk) => simChunks.push(chunk));

  await sim.start();
  await new Promise((r) => setTimeout(r, 95));
  await sim.stop();
  offSim();

  assert.ok(simChunks.length >= 2);
  for (const chunk of simChunks) {
    assert.equal(chunk.sampleRate, PCM_SAMPLE_RATE);
    assert.equal(chunk.channels, PCM_CHANNELS);
    assert.equal(chunk.pcm16le.length, PCM_FRAME_BYTES);
  }

  const chromeSource = new ChromeMeetAudioSource({
    consultationSessionId: "test_audio_source",
    backend: "webrtc-tap",
    strictFrameSize: true,
  });
  const capturedChunks: AudioChunkPayload[] = [];
  const offChrome = chromeSource.onAudioChunk((chunk) => capturedChunks.push(chunk));

  await chromeSource.start();
  const rawFrame1 = generateSinePcm16leFrame(440);
  const rawFrame2 = generateSinePcm16leFrame(880);
  // Push 1.5 frames (4800 bytes), then 0.5 frame (1600 bytes) -> should yield 2 exact 3200-byte frames
  const combined = Buffer.concat([rawFrame1, rawFrame2]);
  chromeSource.pushBase64PcmChunk(combined.subarray(0, 4800).toString("base64"));
  assert.equal(capturedChunks.length, 1);
  assert.equal(capturedChunks[0]?.pcm16le.length, PCM_FRAME_BYTES);

  chromeSource.pushBase64PcmChunk(combined.subarray(4800).toString("base64"));
  assert.equal(capturedChunks.length, 2);
  assert.equal(capturedChunks[1]?.pcm16le.length, PCM_FRAME_BYTES);
  assert.equal(chromeSource.chunksCaptured, 2);
  assert.equal(chromeSource.bytesCaptured, PCM_FRAME_BYTES * 2);

  await chromeSource.stop();
  offChrome();
});

test("GeminiConsultationLiveStream sends setup frame, streams 16kHz PCM, and emits partial/final transcripts", async () => {
  const sentMessages: Array<Record<string, unknown>> = [];
  let activeSocket: MinimalWebSocket | null = null;

  const partials: string[] = [];
  const finals: string[] = [];

  const stream = new GeminiConsultationLiveStream({
    apiKey: "test-gemini-key",
    model: "gemini-3.8-live",
    silenceFlushMs: 80,
    onPartialTranscript: (t) => partials.push(t),
    onFinalTranscript: (t) => finals.push(t),
    webSocketFactory: () => {
      const sock: MinimalWebSocket = {
        readyState: 1,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send(data: string) {
          sentMessages.push(JSON.parse(data) as Record<string, unknown>);
        },
        close() {
          this.readyState = 3;
        },
      };
      activeSocket = sock;
      queueMicrotask(() => {
        sock.onopen?.({});
      });
      return sock;
    },
  });

  await stream.start();
  assert.equal(sentMessages.length, 1);
  assert.ok("setup" in sentMessages[0]!);

  // Acknowledge setupComplete from Gemini server
  await stream.handleIncomingRawData(JSON.stringify({ setupComplete: {} }));
  assert.equal(stream.isConnected, true);

  // Send a 3200-byte 16kHz PCM audio chunk
  stream.sendAudioChunk({
    pcm16le: generateSinePcm16leFrame(440),
    sampleRate: 16000,
    channels: 1,
    timestampMs: Date.now(),
  });
  assert.equal(stream.chunksSent, 1);
  assert.equal(sentMessages.length, 2);

  // Simulate incoming inputTranscription fragments + turnComplete
  activeSocket!.onmessage?.({
    data: JSON.stringify({
      serverContent: {
        inputTranscription: { text: "Can we make the hardware" },
      },
    }),
  });
  activeSocket!.onmessage?.({
    data: JSON.stringify({
      serverContent: {
        inputTranscription: { text: "gold?" },
        turnComplete: true,
      },
    }),
  });

  assert.ok(partials.length >= 2);
  assert.deepEqual(finals, ["Can we make the hardware gold?"]);

  await stream.stop();
});

test("Bot worker HTTP server enforces secret, reports health, runs audio diagnostics, and manages session lifecycle", async () => {
  const worker = createBotWorkerServer();
  const port = await worker.start(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Missing or invalid x-meeting-bot-secret returns 401
    const unauthRes = await fetch(`${baseUrl}/bot/health`);
    assert.equal(unauthRes.status, 401);

    const wrongSecretRes = await fetch(`${baseUrl}/bot/health`, {
      headers: { [MEETING_BOT_SECRET_HEADER]: "wrong-secret" },
    });
    assert.equal(wrongSecretRes.status, 401);

    // 2. GET /bot/health with valid secret returns ok: true, chromiumFound: true, ffmpegFound: true
    const health = await meetingBotClient.getHealth(baseUrl);
    assert.ok(health);
    assert.equal(health.ok, true);
    assert.equal(health.activeSessions, 0);
    assert.equal(health.chromiumFound, true);
    assert.equal(health.ffmpegFound, true);

    // 3. POST /bot/diagnostics/audio returns valid 16kHz mono s16le diagnostic metrics
    const diag = await meetingBotClient.runAudioDiagnostic(250, baseUrl);
    assert.ok(diag);
    assert.equal(diag.ok, true);
    assert.equal(diag.sampleRate, 16000);
    assert.equal(diag.channels, 1);
    assert.ok(diag.chunksEmitted >= 2);
    assert.equal(diag.bytesTotal, diag.chunksEmitted * PCM_FRAME_BYTES);

    // 4. POST /bot/sessions with demo://meet-room transitions to LISTENING
    const sessionId = "sess_worker_lifecycle_test";
    const startRes = await meetingBotClient.startSession(
      {
        consultationSessionId: sessionId,
        meetingUrl: "demo://meet-room",
        botDisplayName: DEFAULT_BOT_DISPLAY_NAME,
        callbackUrl: "",
      },
      baseUrl,
    );
    assert.equal(startRes.workerConnected, true);
    assert.equal(startRes.status, "LISTENING");
    assert.equal(startRes.snapshot?.botDisplayName, "Dressly AI Assistant");

    // 5. GET /bot/sessions/:id reports active session
    const fetchedSnapshot = await meetingBotClient.getSession(sessionId, baseUrl);
    assert.ok(fetchedSnapshot);
    assert.equal(fetchedSnapshot.consultationSessionId, sessionId);
    assert.equal(fetchedSnapshot.status, "LISTENING");
    assert.ok(fetchedSnapshot.chunksCaptured >= 1);

    const healthDuring = await meetingBotClient.getHealth(baseUrl);
    assert.equal(healthDuring?.activeSessions, 1);

    // 6. POST /bot/sessions/:id/reconnect re-establishes LISTENING
    const reconnected = await meetingBotClient.reconnectSession(sessionId, baseUrl);
    assert.equal(reconnected.workerConnected, true);
    assert.equal(reconnected.status, "LISTENING");

    // 7. POST /bot/sessions/:id/stop cleans up and leaves activeSessions === 0
    const stopped = await meetingBotClient.stopSession(sessionId, baseUrl);
    assert.equal(stopped, true);

    const healthAfter = await meetingBotClient.getHealth(baseUrl);
    assert.equal(healthAfter?.activeSessions, 0);
  } finally {
    await worker.stopAll();
  }
});

test("bot-event webhook route validates secret and updates consultation bot status and transcripts", async () => {
  const created = await createSession(null);
  await startSessionConsultation(created.id, {
    meetingUrl: "demo://meet-room",
    consentConfirmed: true,
  });

  // 1. Unauthorized webhook request returns 401
  const unauthReq = new Request(
    `http://127.0.0.1:3000/api/sessions/${created.id}/consultation/bot-event`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "bot.status",
        consultationSessionId: created.id,
        status: "WAITING_FOR_ADMISSION",
        timestamp: new Date().toISOString(),
      }),
    },
  );
  const unauthRes = await postBotEvent(unauthReq, {
    params: Promise.resolve({ id: created.id }),
  });
  assert.equal(unauthRes.status, 401);

  // 2. Authorized bot.status webhook updates session.consultation.botStatus
  const statusReq = new Request(
    `http://127.0.0.1:3000/api/sessions/${created.id}/consultation/bot-event`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret,
      },
      body: JSON.stringify({
        type: "bot.status",
        consultationSessionId: created.id,
        status: "WAITING_FOR_ADMISSION",
        detail: "Waiting in lobby",
        timestamp: new Date().toISOString(),
      }),
    },
  );
  const statusRes = await postBotEvent(statusReq, {
    params: Promise.resolve({ id: created.id }),
  });
  assert.equal(statusRes.status, 200);

  const afterLobby = await getSession(created.id);
  assert.equal(afterLobby?.consultation?.botStatus, "WAITING_FOR_ADMISSION");
  assert.equal(afterLobby?.consultation?.status, "WAITING_FOR_ADMISSION");
});
