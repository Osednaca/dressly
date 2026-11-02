import type { JobKind, JobStatus, JobView } from "@/lib/api-types";
import type {
  AgentAction,
  BagDesignState,
  CurrentLook,
  DesignFieldDiff,
} from "@/lib/types";
import type { TryOnHandle } from "@/services/contracts";
import type { RunwayHandle } from "@/services/runway/contract";
import { randomUUID } from "node:crypto";
import { isSupabaseStorage, supabaseRequest } from "@/lib/storage/supabase";

/**
 * Provider jobs are shared between serverless instances in Supabase mode.
 * Local development continues to use an in-process map.
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
  tryOnTaskKind?: "cloth-v4" | "bag";
}

const jobs = new Map<string, AgentJob>();
const localLeases = new Map<string, string>();

interface JobRow { id: string; session_id: string; payload: AgentJob; revision: number }
const endpoint = "/rest/v1/dressly_jobs";
const idFilter = (id: string) => `id=eq.${encodeURIComponent(id)}`;

async function readRow(id: string): Promise<JobRow | undefined> {
  const response = await supabaseRequest(`${endpoint}?${idFilter(id)}&select=id,session_id,payload,revision`);
  const rows = await response.json() as JobRow[];
  return rows[0];
}

export async function createJob(job: AgentJob): Promise<AgentJob> {
  const normalized: AgentJob = {
    ...job,
    externalId: job.externalId ?? job.handle.id,
  };
  if (isSupabaseStorage()) {
    await supabaseRequest(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ id: normalized.id, session_id: normalized.sessionId, payload: normalized }),
    });
  } else jobs.set(normalized.id, normalized);
  return normalized;
}

export async function getJob(id: string): Promise<AgentJob | undefined> {
  return isSupabaseStorage() ? (await readRow(id))?.payload : jobs.get(id);
}

async function mutateJob(id: string, apply: (existing: AgentJob) => AgentJob): Promise<AgentJob | undefined> {
  if (!isSupabaseStorage()) {
    const existing = jobs.get(id);
    if (!existing) return undefined;
    const next = apply(existing);
    jobs.set(id, next);
    return next;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await readRow(id);
    if (!row) return undefined;
    const next = apply(row.payload);
    const response = await supabaseRequest(`${endpoint}?${idFilter(id)}&revision=eq.${row.revision}&select=payload`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ payload: next, revision: row.revision + 1 }),
    });
    const updated = await response.json() as Array<{ payload: AgentJob }>;
    if (updated.length) return updated[0]!.payload;
  }
  throw new Error("Concurrent job updates could not be reconciled");
}

export async function updateJob(id: string, patch: Partial<AgentJob>): Promise<AgentJob | undefined> {
  return mutateJob(id, (existing) => ({ ...existing, ...patch }));
}

export async function recordPoll(id: string): Promise<AgentJob | undefined> {
  return mutateJob(id, (existing) => ({ ...existing, polls: existing.polls + 1 }));
}

export async function failJob(id: string, message: string, retryable: boolean): Promise<AgentJob | undefined> {
  return updateJob(id, { status: "failed", message, retryable });
}

/** Recover pending jobs after reconnecting without exposing provider handles. */
export async function listPendingJobsForSession(sessionId: string): Promise<JobView[]> {
  let found: AgentJob[];
  if (isSupabaseStorage()) {
    const response = await supabaseRequest(`${endpoint}?session_id=eq.${encodeURIComponent(sessionId)}&payload->>status=eq.pending&select=payload`);
    found = (await response.json() as Array<{ payload: AgentJob }>).map((row) => row.payload);
  } else found = [...jobs.values()].filter((job) => job.sessionId === sessionId && job.status === "pending");
  return found.map((job) => jobView(job));
}

/** One live poll may commit provider completion per job. Owner tokens prevent stale releases. */
export async function acquireJobLease(id: string): Promise<string | null> {
  const owner = randomUUID();
  if (!isSupabaseStorage()) {
    if (localLeases.has(id)) return null;
    localLeases.set(id, owner);
    return owner;
  }
  const response = await supabaseRequest("/rest/v1/rpc/dressly_claim_job", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: id, owner_id: owner }),
  });
  return await response.json() === true ? owner : null;
}

export async function releaseJobLease(id: string, owner: string): Promise<void> {
  if (!isSupabaseStorage()) {
    if (localLeases.get(id) === owner) localLeases.delete(id);
    return;
  }
  await supabaseRequest("/rest/v1/rpc/dressly_release_job", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: id, owner_id: owner }),
  });
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
