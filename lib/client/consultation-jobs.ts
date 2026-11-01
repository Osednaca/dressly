import type { ConsultationSseEvent, JobView } from "@/lib/api-types";

/** Share one polling run when SSE and the initiating HTTP response report the same job. */
export function createConsultationJobPoller(poll: (job: JobView) => Promise<JobView | null>) {
  let active: { id: string; promise: Promise<JobView | null> } | null = null;
  return {
    start(job: JobView): Promise<JobView | null> {
      if (active?.id === job.id) return active.promise;
      const entry = { id: job.id, promise: poll(job) };
      active = entry;
      void entry.promise.then(
        () => { if (active === entry) active = null; },
        () => { if (active === entry) active = null; },
      );
      return entry.promise;
    },
    clear() { active = null; },
  };
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
