import assert from "node:assert/strict";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";
import { POST as postBotEvent } from "@/app/api/sessions/[id]/consultation/bot-event/route";
import { startSessionConsultation } from "@/lib/agent/consultation-orchestrator";
import { env, loadDotEnvFiles } from "@/lib/env";
import { createSession, getSession } from "@/lib/session/store";
import {
  buildBrowserAudioCaptureInitScript,
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
  type BotWebhookEvent,
} from "@/services/meeting-bot/contract";
import {
  GeminiConsultationLiveStream,
  type MinimalWebSocket,
} from "@/services/meeting-bot/gemini-stream";
import {
  PlaywrightMeetBotSession,
  resolveBotProfileDir,
  resolveChromiumExecutable,
} from "@/services/meeting-bot/playwright-bot";
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
  assert.ok(chromeSource.lastRms > 0.1, `Expected lastRms > 0.1, got ${chromeSource.lastRms}`);
  assert.ok(chromeSource.lastPeak > 0.2, `Expected lastPeak > 0.2, got ${chromeSource.lastPeak}`);

  await chromeSource.stop();
  offChrome();
});

test("loadDotEnvFiles loads .env.local and .env without overwriting existing process.env vars", () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), "data", "tmp-env-test-"));
  const keyA = "DRESSLY_TEST_DOTENV_A";
  const keyB = "DRESSLY_TEST_DOTENV_B";
  try {
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      `# comment\n${keyA}="from_env_local"\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, ".env"),
      `${keyA}=from_env\n${keyB}=from_env_fallback # inline comment\n`,
      "utf8",
    );
    delete process.env[keyA];
    delete process.env[keyB];

    loadDotEnvFiles(tmpDir);
    assert.equal(process.env[keyA], "from_env_local");
    assert.equal(process.env[keyB], "from_env_fallback");
  } finally {
    delete process.env[keyA];
    delete process.env[keyB];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("GeminiConsultationLiveStream sends setup frame, streams 16kHz PCM, and emits partial/final transcripts", async () => {
  const sentMessages: Array<Record<string, unknown>> = [];
  let activeSocket: MinimalWebSocket | null = null;

  const partials: string[] = [];
  const finals: string[] = [];
  const vadEvents: Array<{ type: string; offset?: string }> = [];

  const stream = new GeminiConsultationLiveStream({
    apiKey: "test-gemini-key",
    model: "gemini-3.8-live",
    silenceFlushMs: 1400,
    onPartialTranscript: (t) => partials.push(t),
    onFinalTranscript: (t) => finals.push(t),
    onVoiceActivity: (type, offset) => vadEvents.push({ type, offset }),
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

  // Simulate ACTIVITY_START -> partial inputTranscription -> ACTIVITY_END fast 350ms flush
  activeSocket!.onmessage?.({
    data: JSON.stringify({
      voiceActivity: { type: "ACTIVITY_START", audioOffset: "1.20s" },
    }),
  });
  activeSocket!.onmessage?.({
    data: JSON.stringify({
      serverContent: {
        inputTranscription: { text: "What about a burgundy lining?" },
      },
    }),
  });
  activeSocket!.onmessage?.({
    data: JSON.stringify({
      voiceActivity: { type: "ACTIVITY_END", audioOffset: "3.40s" },
    }),
  });

  await new Promise((r) => setTimeout(r, 420));
  assert.deepEqual(vadEvents, [
    { type: "ACTIVITY_START", offset: "1.20s" },
    { type: "ACTIVITY_END", offset: "3.40s" },
  ]);
  assert.deepEqual(finals, [
    "Can we make the hardware gold?",
    "What about a burgundy lining?",
  ]);

  const script = buildBrowserAudioCaptureInitScript();
  assert.ok(script.includes("trackSampleQueues"));
  assert.ok(script.includes("__dresslyGetAudioDiagnostics"));
  assert.ok(script.includes("__dresslyDrainPcmChunks"));
  assert.ok(script.includes("createMediaStreamSource"));

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

test("resolveBotProfileDir reuses shared data/bot-profile unless SingletonLock exists", () => {
  const sharedRoot = path.resolve(process.cwd(), env.meetingBotProfileDir);
  fs.mkdirSync(sharedRoot, { recursive: true });
  const lockFile = path.join(sharedRoot, "SingletonLock");
  const hadLock = fs.existsSync(lockFile);

  try {
    if (hadLock) {
      fs.unlinkSync(lockFile);
    }
    const resolvedDefault = resolveBotProfileDir("sess_shared_profile_check");
    assert.equal(resolvedDefault, sharedRoot);

    fs.writeFileSync(lockFile, "locked", "utf8");
    const resolvedFallback = resolveBotProfileDir("sess_shared_profile_check");
    assert.equal(resolvedFallback, path.resolve(sharedRoot, "sess_shared_profile_check"));
  } finally {
    if (!hadLock && fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  }
});

test(
  "Real Chromium integration: PlaywrightMeetBotSession joins pre-join/lobby/in-call harness and captures live 16kHz PCM audio",
  { skip: process.env.RUN_CHROMIUM_E2E !== "1" },
  async () => {
  const webhookEvents: BotWebhookEvent[] = [];
  let submittedGuestName = "";
  let joinButtonClicked = false;

  const meetHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Google Meet Test Harness</title></head>
  <body>
    <div id="prejoin">
      <button id="mic-btn" aria-label="Turn off microphone" data-is-muted="false">Mic</button>
      <button id="cam-btn" aria-label="Turn off camera" data-is-muted="false">Cam</button>
      <input id="guest-name" placeholder="Your name" value="" />
      <button id="ask-to-join">Ask to join</button>
    </div>
    <div id="status-banner">Ready to join</div>
    <script>
      const micBtn = document.getElementById("mic-btn");
      const camBtn = document.getElementById("cam-btn");
      micBtn.addEventListener("click", () => {
        micBtn.setAttribute("data-is-muted", "true");
        micBtn.setAttribute("aria-label", "Turn on microphone");
      });
      camBtn.addEventListener("click", () => {
        camBtn.setAttribute("data-is-muted", "true");
        camBtn.setAttribute("aria-label", "Turn on camera");
      });

      document.getElementById("ask-to-join").addEventListener("click", () => {
        const nameVal = document.getElementById("guest-name").value;
        fetch("/join-clicked?name=" + encodeURIComponent(nameVal)).catch(() => {});
        document.getElementById("prejoin").style.display = "none";
        document.getElementById("status-banner").textContent =
          "Asking to be let in... Someone in the call will let you in soon";

        setTimeout(() => {
          document.getElementById("status-banner").textContent = "In call";
          const leaveBtn = document.createElement("button");
          leaveBtn.id = "leave-call-btn";
          leaveBtn.setAttribute("aria-label", "Leave call");
          leaveBtn.textContent = "Leave call";
          document.body.appendChild(leaveBtn);

          // Generate real continuous WebAudio stream into an <audio> element via srcObject
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = 440;
          const gain = ctx.createGain();
          gain.gain.value = 0.5;
          const dest = ctx.createMediaStreamDestination();
          osc.connect(gain);
          gain.connect(dest);
          osc.start();
          if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
          }

          const audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          audioEl.srcObject = dest.stream;
          document.body.appendChild(audioEl);
          audioEl.play().catch(() => {});
        }, 300);
      });
    </script>
  </body>
</html>`;

  const harnessServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && parsedUrl.pathname === "/meet-test") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(meetHtml);
      return;
    }
    if (req.method === "GET" && parsedUrl.pathname === "/join-clicked") {
      joinButtonClicked = true;
      submittedGuestName = parsedUrl.searchParams.get("name") ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && parsedUrl.pathname === "/webhook") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => {
        try {
          const evt = JSON.parse(Buffer.concat(chunks).toString("utf8")) as BotWebhookEvent;
          webhookEvents.push(evt);
        } catch {
          // Ignore malformed JSON
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = await new Promise<number>((resolve, reject) => {
    harnessServer.once("error", reject);
    harnessServer.listen(0, "127.0.0.1", () => {
      const addr = harnessServer.address() as AddressInfo;
      resolve(addr.port);
    });
  });

  const testSessionId = `real_chromium_test_${Date.now()}`;
  const botSession = new PlaywrightMeetBotSession({
    consultationSessionId: testSessionId,
    meetingUrl: `http://127.0.0.1:${port}/meet-test`,
    botDisplayName: DEFAULT_BOT_DISPLAY_NAME,
    callbackUrl: `http://127.0.0.1:${port}/webhook`,
    audioBackend: "webrtc-tap",
    headless: true,
  });

  try {
    await botSession.start();

    // Poll until real Chromium transitions through WAITING_FOR_ADMISSION -> JOINED -> LISTENING
    // and captures at least 1 full 3200-byte 16 kHz mono s16le PCM frame from WebAudio
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const snap = botSession.getSnapshot();
      if (
        joinButtonClicked &&
        snap.status === "LISTENING" &&
        snap.chunksCaptured > 0 &&
        snap.bytesCaptured >= 3200
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const finalSnap = botSession.getSnapshot();
    assert.equal(joinButtonClicked, true, "Expected bot to click 'Ask to join'");
    assert.equal(
      submittedGuestName,
      "Dressly AI Assistant",
      "Expected bot to fill 'Dressly AI Assistant' into guest name input",
    );
    assert.equal(finalSnap.headless, true);
    assert.equal(finalSnap.status, "LISTENING");
    assert.ok(
      finalSnap.chunksCaptured > 0,
      `Expected chunksCaptured > 0, got ${finalSnap.chunksCaptured}`,
    );
    assert.ok(
      finalSnap.bytesCaptured >= 3200,
      `Expected bytesCaptured >= 3200, got ${finalSnap.bytesCaptured}`,
    );

    const observedStatuses = webhookEvents
      .filter((e): e is Extract<BotWebhookEvent, { type: "bot.status" }> => e.type === "bot.status")
      .map((e) => e.status);

    assert.ok(
      observedStatuses.includes("OPENING_MEET"),
      `Expected OPENING_MEET in [${observedStatuses.join(", ")}]`,
    );
    assert.ok(
      observedStatuses.includes("WAITING_FOR_ADMISSION"),
      `Expected WAITING_FOR_ADMISSION in [${observedStatuses.join(", ")}]`,
    );
    assert.ok(
      observedStatuses.includes("JOINED"),
      `Expected JOINED in [${observedStatuses.join(", ")}]`,
    );
    assert.ok(
      observedStatuses.includes("LISTENING"),
      `Expected LISTENING in [${observedStatuses.join(", ")}]`,
    );
  } finally {
    await botSession.stop();
    await new Promise<void>((resolve) => harnessServer.close(() => resolve()));
    const fallbackSubdir = path.resolve(process.cwd(), env.meetingBotProfileDir, testSessionId);
    if (fs.existsSync(fallbackSubdir)) {
      fs.rmSync(fallbackSubdir, { recursive: true, force: true });
    }
  }

  assert.equal(botSession.getSnapshot().status, "STOPPED");
});
