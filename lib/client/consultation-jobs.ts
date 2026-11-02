import type { ConsultationSseEvent, JobView } from "@/lib/api-types";

/** Share one polling run when SSE and the initiating HTTP response report the same job. */
export function createConsultationJobPoller(poll: (job: JobView) => Promise<JobView | null>) {
  const pending = new Map<string, Promise<JobView | null>>();
  let tail: Promise<unknown> | null = null;
  let generation = 0;
  return {
    start(job: JobView): Promise<JobView | null> {
      const existing = pending.get(job.id);
      if (existing) return existing;
      const currentGeneration = generation;
      // pollJob owns a single cancellation token; run distinct jobs serially so
      // recovering one pending job does not cancel another one.
      const run = tail
        ? tail.then(() => currentGeneration === generation ? poll(job) : null)
        : poll(job);
      const result = run.then(
        (value) => { if (pending.get(job.id) === result) pending.delete(job.id); return value; },
        (error: unknown) => { if (pending.get(job.id) === result) pending.delete(job.id); throw error; },
      );
      pending.set(job.id, result);
      const settled = result.then(() => undefined, () => undefined);
      tail = settled;
      void settled.then(() => {
        if (tail === settled) tail = null;
      });
      return result;
    },
    clear() {
      generation += 1;
      pending.clear();
      tail = null;
    },
  };
}

/** Follow a newly current version without undoing a manual historical selection on reconnect. */
export function selectionAfterConsultationSnapshot(
  previousCurrent: string | null,
  nextCurrent: string | null,
  selected: string | null,
): string | null {
  return previousCurrent && nextCurrent && previousCurrent !== nextCurrent ? nextCurrent : selected;
}

/** Handle the job lifecycle regardless of whether speech or a button started it. */
export function handleConsultationJobEvent(
  event: ConsultationSseEvent,
  actions: {
    start: (job: JobView) => void;
    selectVersion: (id: string) => void;
  },
): void {
  if (event.type === "design.generation.started" && event.job.status === "pending") {
    actions.start(event.job);
  } else if (event.type === "design.generation.completed") {
    actions.selectVersion(event.version.id);
  }
}
