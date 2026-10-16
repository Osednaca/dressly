import type { ProviderStatus } from "@/lib/env";
import type {
  BagDesignState,
  ConsultationStatus,
  DecisionRecord,
  DesignFieldDiff,
  DesignFieldKey,
  DesignVersion,
  Look,
  MeetingBotStatus,
  ProposedDesignChange,
  StylingSession,
  TranscriptSegment,
} from "@/lib/types";

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

export type JobKind = "tryon" | "runway" | "consultation_design" | "consultation_tryon";
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
  /** Present when a consultation design generation succeeded and produced a new version. */
  version?: DesignVersion;
}

export interface ProvidersResponse {
  statuses: ProviderStatus[];
  degraded: boolean;
  mock: boolean;
  demo: boolean;
  consultationDemo?: boolean;
}

/**
 * Live Design Consultation API request, response, and SSE wire contracts.
 */
export interface StartConsultationRequest {
  meetingUrl: string;
  consentConfirmed: boolean;
  autoApply?: boolean;
  autoTryOn?: boolean;
  initialDesignState?: Partial<BagDesignState>;
  initialImageUrl?: string;
}

export interface UpdateConsultationRequest {
  autoApply?: boolean;
  autoTryOn?: boolean;
  activeViewMode?: "design" | "tryon";
  meetingUrl?: string;
}

export interface ConsultationResponse {
  session: StylingSession;
  bot?: {
    status: MeetingBotStatus;
    workerConnected: boolean;
    message: string;
  };
}

export interface IngestTranscriptRequest {
  id?: string;
  text: string;
  isFinal?: boolean;
  immediate?: boolean;
  timestamp?: string;
}

export interface CandidateConsultationExtraction {
  isRelevantFashionSpeech: boolean;
  speechKind:
    | "design_modification"
    | "try_on_request"
    | "version_revert"
    | "finalize_design"
    | "vague_preference"
    | "small_talk"
    | "other";
  confidence: number;
  changes: Array<{
    field: DesignFieldKey;
    proposedValue: string;
  }>;
  summary: string;
  targetVersionNumber?: number;
  clarificationQuestion?: string;
  provider?: "gemini" | "fallback";
  model?: string;
}

export interface TranscriptTurnResponse {
  session: StylingSession;
  duplicated: boolean;
  queued?: boolean;
  extraction: CandidateConsultationExtraction | null;
  decision: DecisionRecord | null;
  suggestion: ProposedDesignChange | null;
  autoJob: JobView | null;
  blocked: BlockedView | null;
}

export interface SuggestionActionRequest {
  action: "apply" | "edit" | "ignore";
  editedChanges?: DesignFieldDiff[];
}

export interface SuggestionActionResponse {
  session: StylingSession;
  suggestion: ProposedDesignChange | null;
  job: JobView | null;
  blocked: BlockedView | null;
}

export type ConsultationSseEvent =
  | {
      type: "bot.status";
      status: MeetingBotStatus;
      consultationStatus: ConsultationStatus;
      message?: string;
      timestamp: string;
      session?: StylingSession;
    }
  | { type: "transcript.partial"; segment: TranscriptSegment; session?: StylingSession }
  | { type: "transcript.final"; segment: TranscriptSegment; session?: StylingSession }
  | {
      type: "suggestion.created";
      suggestion: ProposedDesignChange;
      decision: DecisionRecord;
      session: StylingSession;
    }
  | {
      type: "suggestion.updated";
      suggestion: ProposedDesignChange;
      session: StylingSession;
    }
  | {
      type: "design.generation.started";
      job: JobView;
      suggestionId?: string;
      session: StylingSession;
    }
  | {
      type: "design.generation.completed";
      version: DesignVersion;
      job: JobView;
      session: StylingSession;
    }
  | {
      type: "design.generation.failed";
      job: JobView;
      message: string;
      session: StylingSession;
    }
  | {
      type: "vto.started";
      job: JobView;
      versionId: string;
      session: StylingSession;
    }
  | {
      type: "vto.completed";
      look: Look;
      versionId: string;
      job: JobView;
      session: StylingSession;
    }
  | {
      type: "vto.failed";
      job?: JobView;
      blocked?: BlockedView;
      message: string;
      session: StylingSession;
    }
  | { type: "consultation.updated"; session: StylingSession }
  | { type: "consultation.ended"; session: StylingSession };
