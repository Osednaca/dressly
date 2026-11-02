import test from "node:test";
import assert from "node:assert/strict";
import { createBotWorkerServer } from "@/services/meeting-bot/worker";
import { meetingBotClient } from "@/services/meeting-bot/client";
import { MEETING_BOT_SECRET_HEADER, type BotSessionSnapshot, type StartBotSessionRequest } from "@/services/meeting-bot/contract";
import { env } from "@/lib/env";
import { createSession, getSession } from "@/lib/session/store";
import { startSessionConsultation } from "@/lib/agent/consultation-orchestrator";
import { POST as botEvent } from "@/app/api/sessions/[id]/consultation/bot-event/route";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeBot(req: StartBotSessionRequest) {
  const gate = deferred<void>();
  let status: BotSessionSnapshot["status"] = "STARTING";
  let starts = 0;
  let stopped = false;
  let failed = false;
  let attempt: string | undefined;
  let reconnects = 0;
  const snapshot = (): BotSessionSnapshot => ({
    consultationSessionId: req.consultationSessionId, meetingUrl: req.meetingUrl, botDisplayName: "Test bot",
    status, audioBackend: "webrtc-tap", headless: true, chunksCaptured: 0, bytesCaptured: 0,
    geminiConnected: false, reconnectAttempts: 0, startedAt: new Date().toISOString(),
  });
  return {
    gate, snapshot, get starts() { return starts; }, get stopped() { return stopped; }, get failed() { return failed; }, get attempt() { return attempt; }, get reconnects() { return reconnects; },
    isSimulatedMode: () => false,
    getSnapshot: snapshot,
    setAttemptId: (id?: string) => { attempt = id; },
    start: async () => { starts += 1; await gate.promise; if (!stopped) status = "OPENING_MEET"; return snapshot(); },
    reconnect: async () => { reconnects += 1; status = "RECONNECTING"; return snapshot(); },
    stop: async () => { stopped = true; status = "STOPPED"; gate.resolve(); },
    failStartup: async () => { failed = true; status = "FAILED"; },
  };
}

test("worker acknowledges slow launch immediately and safely cancels replaced sessions", async () => {
  const bots: ReturnType<typeof fakeBot>[] = [];
  const worker = createBotWorkerServer({ createSession: (req) => { const bot = fakeBot(req); bots.push(bot); return bot; } });
  const port = await worker.start(0);
  const base = `http://127.0.0.1:${port}`;
  const payload = (id: string) => ({ consultationSessionId: id, meetingUrl: "https://meet.google.com/aaa-bbbb-ccc", callbackUrl: "" });
  const request = async (id: string) => fetch(`${base}/bot/sessions`, {
    method: "POST", headers: { "content-type": "application/json", [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret }, body: JSON.stringify(payload(id)),
  });
  try {
    const first = await request("slow-first");
    assert.equal(first.status, 202);
    assert.equal((await first.json()).status, "STARTING");
    const second = await request("slow-second");
    assert.equal(second.status, 202);
    assert.equal((await second.json()).status, "STARTING");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bots[0]!.stopped, true);
    assert.equal(bots[1]!.starts, 1);
  } finally { await worker.stopAll(); }
  assert.equal(bots[1]!.stopped, true);
});

test("reconnect acknowledges immediately and waits for the preceding startup", async () => {
  let bot!: ReturnType<typeof fakeBot>;
  const worker = createBotWorkerServer({ createSession: (req) => { bot = fakeBot(req); return bot; } });
  const port = await worker.start(0);
  const base = `http://127.0.0.1:${port}`;
  const headers = { "content-type": "application/json", [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret };
  try {
    const start = await fetch(`${base}/bot/sessions`, { method: "POST", headers,
      body: JSON.stringify({ consultationSessionId: "reconnect", meetingUrl: "https://meet.google.com/aaa-bbbb-ccc", callbackUrl: "" }) });
    assert.equal(start.status, 202);
    const reconnect = await fetch(`${base}/bot/sessions/reconnect/reconnect`, { method: "POST", headers,
      body: JSON.stringify({ attemptId: "new-attempt" }) });
    assert.equal(reconnect.status, 202);
    assert.equal((await reconnect.json()).status, "RECONNECTING");
    assert.equal(bot.reconnects, 0);
    assert.equal(bot.attempt, undefined);
    bot.gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bot.reconnects, 1);
    assert.equal(bot.attempt, "new-attempt");
  } finally { await worker.stopAll(); }
});

test("unexpected background startup failure is caught and reported", async () => {
  let bot!: ReturnType<typeof fakeBot>;
  const worker = createBotWorkerServer({ createSession: (req) => { bot = fakeBot(req); return bot; } });
  const port = await worker.start(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/bot/sessions`, {
      method: "POST", headers: { "content-type": "application/json", [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret },
      body: JSON.stringify({ consultationSessionId: "failed", meetingUrl: "https://meet.google.com/aaa-bbbb-ccc", callbackUrl: "" }),
    });
    assert.equal(response.status, 202);
    bot.gate.reject(new Error("sensitive URL and credentials must not be logged"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bot.failed, true);
    assert.equal(bot.getSnapshot().status, "FAILED");
  } finally { await worker.stopAll(); }
});

test("client distinguishes HTTP auth, server, timeout and connection errors without leaking details", async (t) => {
  let result: number | Error = 401;
  t.mock.method(globalThis, "fetch", async () => {
    if (result instanceof Error) throw result;
    return new Response("secret server body", { status: result });
  });
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const request = { consultationSessionId: "safe", meetingUrl: "https://meet.google.com/aaa-bbbb-ccc", callbackUrl: "" };
  for (const [value, expected] of [[401, /authentication/i], [403, /authentication/i], [404, /not found/i], [503, /HTTP 503/]] as const) {
    result = value;
    const outcome = await meetingBotClient.startSession(request, "http://worker.invalid/private-secret");
    assert.equal(outcome.workerConnected, false);
    assert.match(outcome.message, expected);
  }
  result = 401;
  assert.match((await meetingBotClient.reconnectSession("safe", "http://worker.invalid/private-secret")).message, /authentication/i);
  result = Object.assign(new Error("private-secret"), { name: "TimeoutError" });
  assert.match((await meetingBotClient.startSession(request, "http://worker.invalid/private-secret")).message, /timed out/i);
  result = new Error("private-secret");
  assert.match((await meetingBotClient.startSession(request, "http://worker.invalid/private-secret")).message, /cannot reach/i);
  assert.doesNotMatch(JSON.stringify(warnings), /private-secret|secret server body|worker\.invalid/);
});

test("worker failure snapshots do not expose internal error details", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "FAILED", botDisplayName: "Bot", lastError: "private-secret https://internal.invalid" }));
  const result = await meetingBotClient.startSession({ consultationSessionId: "safe", meetingUrl: "demo://test", callbackUrl: "" }, "http://localhost");
  assert.equal(result.status, "FAILED");
  assert.doesNotMatch(result.message, /private-secret|internal\.invalid/);
  assert.doesNotMatch(JSON.stringify(result), /private-secret|internal\.invalid/);
});

test("early callback wins over the initial snapshot and old attempts are ignored", async (t) => {
  const session = await createSession(null);
  let activeAttempt = "";
  const emit = async (attemptId: string, status: string) => botEvent(new Request("http://localhost/bot-event", {
    method: "POST", headers: { "content-type": "application/json", [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret },
    body: JSON.stringify({ type: "bot.status", consultationSessionId: session.id, attemptId, status, timestamp: new Date().toISOString() }),
  }), { params: Promise.resolve({ id: session.id }) });
  t.mock.method(meetingBotClient, "startSession", async (req: StartBotSessionRequest) => {
    activeAttempt = req.attemptId!;
    assert.equal((await emit(activeAttempt, "LISTENING")).status, 200);
    return { workerConnected: true, status: "STARTING", message: "starting" };
  });
  const started = await startSessionConsultation(session.id, { meetingUrl: "demo://meet-room", consentConfirmed: true });
  assert.equal(started?.session.consultation?.botStatus, "LISTENING");
  assert.ok(started?.bot);
  assert.match(started.bot.message, /LISTENING/);
  assert.deepEqual(await (await emit("older-attempt", "FAILED")).json(), { ok: true, ignored: true });
  assert.equal((await getSession(session.id))?.consultation?.botStatus, "LISTENING");
  const staleTranscript = await botEvent(new Request("http://localhost/bot-event", {
    method: "POST", headers: { "content-type": "application/json", [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret },
    body: JSON.stringify({ type: "transcript.partial", consultationSessionId: session.id, attemptId: "older-attempt", text: "stale utterance", timestamp: new Date().toISOString() }),
  }), { params: Promise.resolve({ id: session.id }) });
  assert.deepEqual(await staleTranscript.json(), { ok: true, ignored: true });
  assert.equal((await getSession(session.id))?.consultation?.transcript.length, 0);
});
