import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type { AgentJob } from "@/lib/agent/jobs";

/** PostgREST model: shared fake remote state, with atomic revision and lease checks. */
function fakePostgrest() {
  const rows = new Map<string, { id: string; session_id: string; payload: AgentJob; revision: number; owner: string | null }>();
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.pathname.endsWith("/rpc/dressly_claim_job")) {
      const row = rows.get(body.job_id);
      if (!row || row.owner) return respond(false);
      row.owner = body.owner_id;
      return respond(true);
    }
    if (url.pathname.endsWith("/rpc/dressly_release_job")) {
      const row = rows.get(body.job_id);
      if (row && row.owner === body.owner_id) row.owner = null;
      return respond(null);
    }
    assert.equal(url.pathname, "/rest/v1/dressly_jobs");
    if (method === "POST") {
      rows.set(body.id, { ...body, revision: 0, owner: null });
      return respond(null, 201);
    }
    const id = url.searchParams.get("id")?.slice(3);
    const session = url.searchParams.get("session_id")?.slice(3);
    const row = id ? rows.get(id) : undefined;
    if (method === "PATCH") {
      if (!row || row.revision !== Number(url.searchParams.get("revision")?.slice(3))) return respond([]);
      row.payload = body.payload;
      row.revision = body.revision;
      return respond([{ payload: row.payload }]);
    }
    if (session) return respond([...rows.values()].filter((r) => r.session_id === session && r.payload.status === "pending").map((r) => ({ payload: r.payload })));
    return respond(row ? [structuredClone(row)] : []);
  };
}

test("Supabase jobs survive separate module instances and reject concurrent lease holders", async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  process.env.DRESSLY_STORAGE_BACKEND = "supabase";
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_only";
  globalThis.fetch = fakePostgrest() as typeof fetch;
  try {
    const moduleUrl = pathToFileURL(path.resolve("lib/agent/jobs.ts")).href;
    const first = await import(`${moduleUrl}?isolated=first`);
    const second = await import(`${moduleUrl}?isolated=second`);
    const job: AgentJob = {
      id: "job_test", sessionId: "session_test", kind: "consultation_design", provider: "runway",
      handle: { id: "external", provider: "runway" }, productId: null, productName: "bag", action: null,
      baseImageUrl: "/bag.png", pendingItems: {} as AgentJob["pendingItems"], startedAt: Date.now(), status: "pending", polls: 0,
    };
    await first.createJob(job);
    assert.deepEqual(await second.getJob(job.id), { ...job, externalId: "external" });
    const pending = await second.listPendingJobsForSession(job.sessionId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, job.id);
    assert.equal("handle" in pending[0], false, "provider handle remains server-side");
    await Promise.all([first.recordPoll(job.id), second.recordPoll(job.id)]);
    assert.equal((await second.getJob(job.id))?.polls, 2, "CAS retries preserve both updates");
    const [ownerA, ownerB] = await Promise.all([first.acquireJobLease(job.id), second.acquireJobLease(job.id)]);
    assert.equal(Number(ownerA !== null) + Number(ownerB !== null), 1);
    const owner = ownerA ?? ownerB!;
    await second.releaseJobLease(job.id, "00000000-0000-4000-8000-000000000000");
    assert.equal(await second.acquireJobLease(job.id), null, "a stale owner cannot release another lease");
    await first.releaseJobLease(job.id, owner);
    const next = await second.acquireJobLease(job.id);
    assert.ok(next);
    await second.releaseJobLease(job.id, next);
    await second.updateJob(job.id, { status: "success", versionId: "ver_job_test" });
    assert.equal((await first.getJob(job.id))?.status, "success");
    assert.deepEqual(await first.listPendingJobsForSession(job.sessionId), []);
  } finally {
    globalThis.fetch = savedFetch;
    process.env = savedEnv;
  }
});

