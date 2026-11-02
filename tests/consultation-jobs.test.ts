import test from "node:test";
import assert from "node:assert/strict";
import { createConsultationJobPoller, handleConsultationJobEvent, selectionAfterConsultationSnapshot } from "@/lib/client/consultation-jobs";
import type { ConsultationSseEvent, JobView } from "@/lib/api-types";

const pending: JobView = {
  id: "voice-design-job", kind: "consultation_design", status: "pending", provider: "runway",
};

test("voice-started job is polled and its completed design becomes selected", async () => {
  let calls = 0;
  let selected = "original";
  let finish!: (job: JobView) => void;
  const completion = new Promise<JobView>((resolve) => { finish = resolve; });
  const poller = createConsultationJobPoller(async (job) => {
    calls += 1;
    assert.equal(job.id, pending.id);
    const result = await completion;
    handleConsultationJobEvent({
      type: "design.generation.completed", version: { id: "version-2" }, job: result, session: {},
    } as ConsultationSseEvent, actions);
    return result;
  });
  const actions = {
    start: (job: JobView) => { void poller.start(job); },
    selectVersion: (id: string) => { selected = id; },
  };
  handleConsultationJobEvent({
    type: "design.generation.started", job: pending, session: {},
  } as ConsultationSseEvent, actions);

  // The button-driven HTTP response can arrive after the same SSE event.
  const manualResponsePoll = poller.start(pending);
  assert.equal(calls, 1);
  finish({ ...pending, status: "success" });
  await manualResponsePoll;
  assert.equal(selected, "version-2");
});

test("distinct jobs are polled serially, while duplicate events share the same poll", async () => {
  const calls: string[] = [];
  const resolvers: Array<(result: JobView | null) => void> = [];
  const poller = createConsultationJobPoller((job) => {
    calls.push(job.id);
    return new Promise((resolve) => { resolvers.push(resolve); });
  });
  const first = poller.start(pending);
  assert.equal(poller.start(pending), first);
  const other = { ...pending, id: "other" };
  const second = poller.start(other);
  assert.deepEqual(calls, [pending.id]);
  resolvers[0]!(null);
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [pending.id, other.id]);
  assert.equal(poller.start(other), second, "an older completion must not clear the active job");
  resolvers[1]!({ ...other, status: "failed" });
  await second;
  const retry = poller.start(other);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 3);
  resolvers[2]!({ ...other, status: "success" });
  await retry;
});

test("snapshot follows a changed current design without overriding a manual selection on reconnect", () => {
  assert.equal(selectionAfterConsultationSnapshot("v2", "v2", "v1"), "v1");
  assert.equal(selectionAfterConsultationSnapshot("v2", "v3", "v1"), "v3");
  assert.equal(selectionAfterConsultationSnapshot(null, "v3", "v1"), "v1");
  assert.equal(selectionAfterConsultationSnapshot("v2", null, "v1"), "v1");
});

test("clearing a session skips jobs queued for the old session", async () => {
  let complete!: (value: JobView | null) => void;
  const seen: string[] = [];
  const poller = createConsultationJobPoller((job) => {
    seen.push(job.id);
    return new Promise((resolve) => { complete = resolve; });
  });
  const first = poller.start(pending);
  const queued = poller.start({ ...pending, id: "queued" });
  poller.clear();
  complete(null);
  await first;
  assert.equal(await queued, null);
  assert.deepEqual(seen, [pending.id]);
});

test("ending a session clears deduplication and terminal start events do not start polling", async () => {
  let calls = 0;
  const poller = createConsultationJobPoller(async (job) => { calls += 1; return job; });
  const actions = { start: (job: JobView) => { void poller.start(job); }, selectVersion: () => {} };
  handleConsultationJobEvent({
    type: "design.generation.started", job: { ...pending, status: "success" }, session: {},
  } as ConsultationSseEvent, actions);
  assert.equal(calls, 0);
  const first = poller.start(pending);
  poller.clear();
  await poller.start(pending);
  await first;
  assert.equal(calls, 2);
});
