import type { ProviderStatus } from "@/lib/env";
import type { DecisionRecord, Look, StylingSession } from "@/lib/types";

/**
 * The wire contract between the server routes and the browser.
 *
 * Kept separate from the domain types on purpose: the domain describes what a
 * styling session *is*, this describes what a turn *returns*. The UI imports only
 * from here, so a change to a provider or the orchestrator cannot silently reshape
 * what the browser receives.
 */

export interface Suggestion {
  /** Chip text shown to the shopper. */
  label: string;
  /** The message actually sent when the chip is used. */
  message: string;
  /** Marks the suggested action the agent itself expects next, when known. */
  primary?: boolean;
}

export type JobKind = "tryon" | "runway";
export type JobStatus = "pending" | "success" | "failed";

export interface JobView {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Human-readable, safe failure reason. Present only when failed. */
  message?: string;
  retryable?: boolean;
  /** Provider actually used, so the UI can label mock results honestly. */
  provider: "youcam" | "mock" | "runway";
  /** 1-based position of the look this job produces, for "Look 2/3" copy. */
  lookIndex?: number;
  /** Current step copy for the multi-step loading experience. */
  step?: string;
}

export interface BlockedView {
  code: string;
  message: string;
  retryable: boolean;
}

export interface SessionPayload {
  session: StylingSession;
  suggestions: Suggestion[];
}

export interface ChatResponse extends SessionPayload {
  decision: DecisionRecord | null;
  job: JobView | null;
  understanding: {
    provider: "gemini" | "fallback";
    model: string;
    note: string;
  };
  blocked: BlockedView | null;
}

export interface JobPollResponse {
  job: JobView;
  /** Present once the job has produced a session mutation. */
  session?: StylingSession;
  suggestions?: Suggestion[];
  /** Present when a try-on succeeded and produced a new look. */
  look?: Look;
}

export interface ProvidersResponse {
  statuses: ProviderStatus[];
  degraded: boolean;
  mock: boolean;
  demo: boolean;
}
