import test from "node:test";
import assert from "node:assert/strict";
import { createConsultationJobPoller, handleConsultationJobEvent } from "@/lib/client/consultation-jobs";
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

test("duplicate events share an in-flight poll, but different or retried jobs can start", async () => {
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
  assert.deepEqual(calls, [pending.id, other.id]);
  resolvers[0]!(null);
  await first;
  assert.equal(poller.start(other), second, "an older completion must not clear the active job");
  resolvers[1]!({ ...other, status: "failed" });
  await second;
  const retry = poller.start(other);
  assert.equal(calls.length, 3);
  resolvers[2]!({ ...other, status: "success" });
  await retry;
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
