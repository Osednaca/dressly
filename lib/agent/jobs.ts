import type { JobKind, JobStatus, JobView } from "@/lib/api-types";
import type {
  AgentAction,
  BagDesignState,
  CurrentLook,
  DesignFieldDiff,
} from "@/lib/types";
import type { TryOnHandle } from "@/services/contracts";
import type { RunwayHandle } from "@/services/runway/contract";

/**
 * In-process job tracking for the asynchronous providers.
 *
 * YouCam generation and Runway image/video jobs are genuinely long-running, so a turn
 * submits and returns immediately; the browser polls here. Jobs are intentionally
 * memory-only: they are short-lived, tied to one process, and a lost job simply means
 * "try again", which is the honest behaviour after a restart.
 */
export type JobHandle = TryOnHandle | RunwayHandle;

export interface AgentJob {
  id: string;
  sessionId: string;
  kind: JobKind;
  provider: JobView["provider"];
  handle: JobHandle;
  externalId?: string;
  productId: string | null;
  productName: string;
  action: AgentAction | null;
  /** Look to build the next one from: the active result, or the original photo. */
  baseImageUrl: string;
  /** The outfit as it will be once this garment lands (snapshot at submit time). */
  pendingItems: CurrentLook;
  startedAt: number;
  status: JobStatus;
  step?: string;
  message?: string;
  retryable?: boolean;
  lookId?: string;
  /** Number of polls the browser has performed, used for step copy. */
  polls: number;

  /** Live Design Consultation job metadata (`consultation_design` / `consultation_tryon`). */
  suggestionId?: string;
  targetDesignState?: BagDesignState;
  previousDesignState?: BagDesignState;
  changes?: DesignFieldDiff[];
  versionLabel?: string;
  versionSummary?: string;
  promptUsed?: string;
  versionId?: string;
  highResFinal?: boolean;
}

const jobs = new Map<string, AgentJob>();

export function createJob(job: AgentJob): AgentJob {
  const normalized: AgentJob = {
    ...job,
    externalId: job.externalId ?? job.handle.id,
  };
  jobs.set(normalized.id, normalized);
  return normalized;
}

export function getJob(id: string): AgentJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<AgentJob>): AgentJob | undefined {
  const existing = jobs.get(id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  jobs.set(id, next);
  return next;
}

export function recordPoll(id: string): AgentJob | undefined {
  const existing = jobs.get(id);
  if (!existing) return undefined;
  return updateJob(id, { polls: existing.polls + 1 });
}

export function failJob(id: string, message: string, retryable: boolean): AgentJob | undefined {
  return updateJob(id, { status: "failed", message, retryable });
}

function tryOnStep(elapsedMs: number): string {
  if (elapsedMs < 3_000) return "Preparing the fitting room";
  if (elapsedMs < 12_000) return "Generating your virtual fit";
  if (elapsedMs < 30_000) return "Layering the look";
  return "Almost there — refining the details";
}

export function jobView(job: AgentJob, lookIndex?: number): JobView {
  const view: JobView = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    provider: job.provider,
    lookIndex,
  };
  if (job.status === "failed") {
    view.message = job.message ?? "The provider could not complete this request.";
    view.retryable = job.retryable ?? true;
  }
  if (job.status === "pending") {
    if (job.step) {
      view.step = job.step;
    } else if (job.kind === "runway") {
      view.step = "Bringing your look to life";
    } else {
      view.step = tryOnStep(Date.now() - job.startedAt);
    }
  } else if (job.step) {
    view.step = job.step;
  }
  return view;
}

/** Drops terminal jobs older than an hour so the map cannot grow without bound. */
export function pruneJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status !== "pending" && job.startedAt < cutoff) jobs.delete(id);
  }
}
