import assert from "node:assert/strict";
import test from "node:test";
import { GET as eventsRoute } from "@/app/api/sessions/[id]/consultation/events/route";
import { currentConsultationEvent, publishConsultationEvent, readConsultationEvents } from "@/lib/server/consultation-events";
import { createSessionRecord } from "@/lib/session/reducer";
import type { ConsultationSseEvent, JobView } from "@/lib/api-types";
import type { StylingSession } from "@/lib/types";
import { meetingBotClient } from "@/services/meeting-bot/client";
import { meetingBotRemoteConfigurationError, meetingBotSecretIsSafe } from "@/services/meeting-bot/security";

test("cloud events persist and SSE resumes across separate requests with pending job recovery", async (t) => {
  const old = { backend: process.env.DRESSLY_STORAGE_BACKEND, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.DRESSLY_STORAGE_BACKEND = "supabase";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  t.after(() => {
    for (const [name, value] of Object.entries({ DRESSLY_STORAGE_BACKEND: old.backend, SUPABASE_URL: old.url, SUPABASE_SECRET_KEY: old.key })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const session = createSessionRecord("ses_cloud", null);
  const event = { type: "consultation.updated" as const, session };
  const rows: Array<{ id: number; session_id: string; event: typeof event }> = [];
  const pending = { id: "job_1", kind: "consultation_design", status: "pending", provider: "runway" };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("dressly_sessions")) return Response.json([{ id: session.id, data: session, revision: 1 }]);
    if (url.pathname.endsWith("dressly_jobs")) return Response.json([{ payload: { ...pending, sessionId: session.id } }]);
    if (url.pathname.endsWith("dressly_consultation_events")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        rows.push({ id: rows.length + 1, ...body });
        return new Response(null, { status: 201 });
      }
      const filter = url.searchParams.get("id");
      const after = filter?.startsWith("gt.") ? Number(filter.slice(3)) : null;
      return Response.json(after === null ? rows.slice(-1).reverse() : rows.filter((row) => row.id > after));
    }
    throw new Error(`unexpected local mock path ${url.pathname}`);
  });

  await publishConsultationEvent(session.id, event);
  assert.equal((await readConsultationEvents(session.id))[0]?.id, 1);
  await publishConsultationEvent(session.id, event);
  const abort = new AbortController();
  const response = await eventsRoute(new Request("http://localhost/events", {
    headers: { "last-event-id": "1" }, signal: abort.signal,
  }), { params: Promise.resolve({ id: session.id }) });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let frames = "";
  while (!frames.includes("id: 2\n")) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    frames += decoder.decode(chunk.value);
  }
  assert.match(frames, /consultation\.updated/);
  assert.match(frames, /design\.generation\.started/);
  assert.match(frames, /job_1/);
  assert.doesNotMatch(frames, /id: 1\n/);
  abort.abort();
  await reader.cancel();
});

test("replayed events never restore an old snapshot or restart a completed job", () => {
  const stale = createSessionRecord("ses_replay", null);
  const current = { ...stale, consultation: { currentDesignVersionId: "v3", status: "LIVE" } } as StylingSession;
  const job = { id: "job_old", kind: "consultation_design", status: "pending", provider: "runway" } as JobView;
  const started = { type: "design.generation.started", job, session: stale } as ConsultationSseEvent;
  const completed = { type: "design.generation.completed", job, version: { id: "v2" }, session: stale } as ConsultationSseEvent;
  assert.deepEqual(currentConsultationEvent(started, current, new Set()), { type: "consultation.updated", session: current });
  assert.deepEqual(currentConsultationEvent(completed, current, new Set()), { type: "consultation.updated", session: current });
  assert.equal(currentConsultationEvent(started, current, new Set([job.id])).type, "design.generation.started");
});

test("an unreachable worker reports failed rather than listening", async () => {
  const response = await meetingBotClient.startSession({
    consultationSessionId: "ses_offline", meetingUrl: "demo://test", callbackUrl: "http://127.0.0.1:3000/callback",
  }, "http://127.0.0.1:1");
  assert.equal(response.workerConnected, false);
  assert.equal(response.status, "FAILED");
  assert.match(response.message, /not being captured/);
});

test("production rejects default secrets and Vercel requires remote HTTPS endpoints", (t) => {
  const environment: Record<string, string | undefined> = process.env;
  const old = { node: environment.NODE_ENV, vercel: environment.VERCEL };
  t.after(() => {
    if (old.node === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = old.node;
    if (old.vercel === undefined) delete environment.VERCEL; else environment.VERCEL = old.vercel;
  });
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";
  assert.equal(meetingBotSecretIsSafe("dressly-local-bot-secret"), false);
  assert.equal(meetingBotSecretIsSafe("short"), false);
  assert.equal(meetingBotSecretIsSafe("a".repeat(32)), true);
  assert.match(meetingBotRemoteConfigurationError("http://127.0.0.1:4100", "https://example.com/callback")!, /MEETING_BOT_URL/);
  assert.match(meetingBotRemoteConfigurationError("https://worker.example.com", "http://127.0.0.1:3000/callback")!, /NEXT_PUBLIC_APP_URL/);
  assert.equal(meetingBotRemoteConfigurationError("https://worker.example.com", "https://example.com/callback"), null);
});
