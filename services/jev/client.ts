import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { CandidateConsultationExtraction } from "@/lib/api-types";
import { env } from "@/lib/env";
import type {
  AgentAction,
  BagDesignState,
  ConsultationAction,
  DesignFieldDiff,
  LiveConsultationSession,
  ScoredAlternative,
  StyleTag,
} from "@/lib/types";
import { CONSULTATION_ACTIONS, STYLE_TAGS } from "@/lib/types";

/**
 * JEV (TypeSafe System One) as the decision engine.
 *
 * One `systemOne` request carries three named `choice` questions, which is what makes
 * this a real evaluation rather than a classifier call:
 *
 *   `style_profile`   -> probability distribution over the eight style alternatives
 *   `next_action`     -> which agent action to take, with its own distribution
 *   `product_choice`  -> which of the filtered catalog candidates to put on the body
 *
 * The alternatives are explicit and enumerated by our code. JEV judges between them.
 * Nothing here decides what the candidate set is; that already happened in
 * `lib/catalog/query.ts` with hard filters and deterministic scoring.
 */

export interface JevActionAlternative {
  id: AgentAction;
  description: string;
}

export interface JevProductAlternative {
  id: string;
  description: string;
}

export interface JevRequest {
  /** Structured, JSON-safe description of the shopping state and the ask. */
  state: Record<string, unknown>;
  actions: JevActionAlternative[];
  products: JevProductAlternative[];
}

export interface JevActionDecision {
  decision: AgentAction;
  confidence: number;
  distribution: ScoredAlternative[];
}

export interface JevProductDecision {
  /** `null` when JEV chose something outside the offered candidates. */
  productId: string | null;
  confidence: number;
  distribution: ScoredAlternative[];
}

export interface JevResult {
  action: JevActionDecision;
  product: JevProductDecision;
  styleDistribution: ScoredAlternative[];
  model: string;
}

/** Shape we accept from the SDK, validated defensively before use. */
interface RawAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface RawResult {
  model?: string;
  answers?: Record<string, RawAnswer>;
}

let cached: { client: TypeSafeClient; key: string } | null = null;

function client(): TypeSafeClient {
  const apiKey = env.typesafeApiKey;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured");
  if (!cached || cached.key !== apiKey) {
    cached = {
      key: apiKey,
      client: new TypeSafeClient({
        apiKey,
        baseURL: env.typesafeBaseUrl,
        defaultModel: env.jevModel,
        timeout: env.jevTimeoutMs,
        retry: { maxRetries: 1 },
        logLevel: "off",
      }),
    };
  }
  return cached.client;
}

function toDistribution(probabilities: Record<string, number> | undefined, labelOf?: (key: string) => string): ScoredAlternative[] {
  if (!probabilities) return [];
  return Object.entries(probabilities)
    .map(([label, probability]) => ({
      label: labelOf ? labelOf(label) : label,
      probability: clamp01(probability),
    }))
    .sort((a, b) => b.probability - a.probability);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function requireDistribution(distribution: ScoredAlternative[]): ScoredAlternative[] {
  if (distribution.length < 2) throw new Error("JEV returned an empty alternative distribution");
  return distribution;
}

export function isJevConfigured(): boolean {
  return Boolean(env.typesafeApiKey);
}

/**
 * Ask JEV to evaluate the explicit alternatives. Throws on any contract violation;
 * the caller owns the fallback, so a malformed answer can never be mistaken for a
 * decision.
 */
export async function evaluateWithJev(request: JevRequest): Promise<JevResult> {
  const questions: Record<string, unknown> = {
    style_profile: choice(
      "Which style direction does this shopper's request actually describe? Judge only the conversation and the stated preferences.",
      Object.fromEntries(
        STYLE_TAGS.map((style) => [
          style,
          { style, formality: STYLE_FORMALITY[style] } as const,
        ]),
      ),
    ),
  };

  if (request.actions.length >= 2) {
    questions.next_action = choice(
      "Given the current outfit, the conversation and the latest feedback, what should the stylist do next? Choose the single most useful next step.",
      Object.fromEntries(request.actions.map((action) => [action.id, action.description])),
    );
  }

  if (request.products.length >= 2) {
    questions.product_choice = choice(
      "Which candidate garment best serves this shopper right now? Judge occasion fit, style fit, colour compatibility with the pieces already worn, and what the shopper has liked or rejected.",
      Object.fromEntries(request.products.map((product) => [product.id, product.description])),
    );
  }

  const result = (await client().systemOne({
    state: request.state,
    questions,
  } as never)) as unknown as RawResult;

  const answers = result.answers ?? {};
  const styleAnswer = answers.style_profile;
  const actionAnswer = answers.next_action;
  const productAnswer = answers.product_choice;

  const styleDistribution = requireDistribution(toDistribution(styleAnswer?.probabilities));

  const fallbackAction = request.actions[0]?.id ?? "KEEP_LOOK";
  const actionDecision = (actionAnswer?.choice as AgentAction | undefined) ?? fallbackAction;
  if (!request.actions.some((action) => action.id === actionDecision)) {
    throw new Error(`JEV chose an action outside the offered set: ${String(actionAnswer?.choice)}`);
  }

  const productDistribution = toDistribution(productAnswer?.probabilities);
  const chosenProduct = productAnswer?.choice ?? null;
  if (chosenProduct !== null && !request.products.some((product) => product.id === chosenProduct)) {
    throw new Error(`JEV chose a product outside the offered set: ${chosenProduct}`);
  }

  return {
    action: {
      decision: actionDecision,
      confidence: clamp01(actionAnswer?.confidence ?? 0),
      distribution: requireDistribution(
        toDistribution(actionAnswer?.probabilities, (label) => label),
      ),
    },
    product: {
      productId: chosenProduct,
      confidence: clamp01(productAnswer?.confidence ?? 0),
      distribution: productDistribution,
    },
    styleDistribution,
    model: result.model ?? env.jevModel,
  };
}

/**
 * Local mirror of the style axis so JEV's criteria carry real numbers instead of
 * bare labels. Duplicated from `lib/catalog/query.ts` on purpose: this module must
 * not import catalog code, or the decision service would start depending on the
 * thing it is supposed to judge.
 */
const STYLE_FORMALITY: Record<StyleTag, number> = {
  sport: 0.08,
  casual: 0.2,
  streetwear: 0.25,
  minimal: 0.42,
  smart_casual: 0.5,
  evening: 0.72,
  business: 0.76,
  formal: 0.95,
};

/**
 * Live Consultation JEV evaluation contracts and SystemOne evaluator.
 */

export interface JevConsultationAlternative {
  action: ConsultationAction;
  description: string;
  priorScore: number;
}

export interface JevConsultationRequest {
  transcriptExcerpt: string;
  extraction: CandidateConsultationExtraction;
  diffs: DesignFieldDiff[];
  designState: BagDesignState;
  versionCount: number;
  hasUserPhoto: boolean;
  alternatives: JevConsultationAlternative[];
}

export interface JevConsultationSignals {
  actionScores: Record<ConsultationAction, number>;
}

export interface JevConsultationResult {
  decision: ConsultationAction;
  confidence: number;
  distribution: ScoredAlternative[];
  reason: string;
  model: string;
}

const CONSULTATION_ACTION_DESCRIPTIONS: Record<ConsultationAction, string> = {
  IGNORE:
    "Ignore casual small talk, meeting audio/video checks, retracted thoughts, or redundant edits already reflected in the active BagDesignState.",
  PROPOSE_CHANGE:
    "Propose a structured human-in-the-loop modification card for one or more BagDesignState attributes.",
  ASK_CLARIFICATION:
    "Ask the designer and customer to clarify a vague preference before proposing a modification.",
  TRY_ON_CURRENT_DESIGN:
    "Trigger YouCam Virtual Try-On so the customer can see the active handbag design on themselves.",
  RETURN_TO_PREVIOUS_VERSION:
    "Restore an earlier DesignVersion as the active canonical state and Runway reference.",
  FINALIZE_DESIGN:
    "Mark the current DesignVersion as finalized by the designer and customer.",
};

export function buildConsultationJevSignals(
  extraction: CandidateConsultationExtraction,
  diffs: DesignFieldDiff[],
  consultation: LiveConsultationSession,
  options?: { utterance?: string; hasUserPhoto?: boolean },
): { request: JevConsultationRequest; signals: JevConsultationSignals } {
  const actionScores: Record<ConsultationAction, number> = {
    IGNORE: 0.08,
    PROPOSE_CHANGE: 0.08,
    ASK_CLARIFICATION: 0.08,
    TRY_ON_CURRENT_DESIGN: 0.08,
    RETURN_TO_PREVIOUS_VERSION: 0.08,
    FINALIZE_DESIGN: 0.08,
  };

  if (
    !extraction.isRelevantFashionSpeech ||
    extraction.speechKind === "small_talk" ||
    extraction.speechKind === "small_talk_or_technical" ||
    extraction.speechKind === "cancel_or_nevermind" ||
    extraction.speechKind === "other"
  ) {
    actionScores.IGNORE = 0.96;
  } else if (extraction.speechKind === "try_on_request") {
    actionScores.TRY_ON_CURRENT_DESIGN = 0.95;
  } else if (
    extraction.speechKind === "revert_version" ||
    extraction.speechKind === "version_revert"
  ) {
    actionScores.RETURN_TO_PREVIOUS_VERSION = 0.94;
  } else if (
    extraction.speechKind === "finalize_request" ||
    extraction.speechKind === "finalize_design"
  ) {
    actionScores.FINALIZE_DESIGN = 0.94;
  } else if (extraction.speechKind === "vague_preference") {
    actionScores.ASK_CLARIFICATION = 0.9;
  } else if (extraction.speechKind === "design_modification") {
    if (diffs.length > 0) {
      actionScores.PROPOSE_CHANGE = Math.max(0.88, extraction.confidence);
    } else {
      actionScores.IGNORE = 0.92;
    }
  }

  const alternatives: JevConsultationAlternative[] = CONSULTATION_ACTIONS.map((action) => ({
    action,
    description: CONSULTATION_ACTION_DESCRIPTIONS[action],
    priorScore: actionScores[action],
  }));

  const request: JevConsultationRequest = {
    transcriptExcerpt: options?.utterance ?? extraction.summary,
    extraction,
    diffs,
    designState: consultation.designState,
    versionCount: consultation.versions.length,
    hasUserPhoto: options?.hasUserPhoto ?? false,
    alternatives,
  };

  return {
    request,
    signals: { actionScores },
  };
}

export function buildConsultationReason(
  decision: ConsultationAction,
  request: JevConsultationRequest,
): string {
  switch (decision) {
    case "PROPOSE_CHANGE": {
      const summary = request.diffs
        .map((d) => `${d.label}: ${d.previousValue ?? "—"} → ${d.proposedValue}`)
        .join(", ");
      return summary
        ? `Proposing handbag modification (${summary}).`
        : request.extraction.summary || "Proposing handbag design modification.";
    }
    case "TRY_ON_CURRENT_DESIGN":
      return "Customer asked to visualize the current handbag design via Virtual Try-On.";
    case "RETURN_TO_PREVIOUS_VERSION":
      return request.extraction.targetVersionNumber
        ? `Restoring requested design version V${request.extraction.targetVersionNumber}.`
        : "Restoring previous handbag design version.";
    case "FINALIZE_DESIGN":
      return "Customer and designer confirmed the bespoke handbag design is finalized.";
    case "ASK_CLARIFICATION":
      return (
        request.extraction.clarificationQuestion ??
        "Requesting clarification on which attribute to adjust next."
      );
    case "IGNORE":
    default:
      return "Ignored non-actionable meeting speech or redundant attribute values.";
  }
}

export async function evaluateConsultationWithJev(
  request: JevConsultationRequest,
): Promise<JevConsultationResult> {
  const criteria = Object.fromEntries(
    request.alternatives.map((alt) => [
      alt.action,
      {
        description: alt.description,
        priorScore: alt.priorScore,
      },
    ]),
  );

  const result = (await client().systemOne({
    state: {
      mode: "live_consultation",
      transcriptExcerpt: request.transcriptExcerpt,
      speechKind: request.extraction.speechKind,
      isRelevantFashionSpeech: request.extraction.isRelevantFashionSpeech,
      extractionConfidence: request.extraction.confidence,
      proposedDiffs: request.diffs.map((d) => ({
        field: d.field,
        previousValue: d.previousValue ?? null,
        proposedValue: d.proposedValue,
      })),
      currentDesignState: {
        name: request.designState.name,
        silhouette: request.designState.silhouette,
        size: request.designState.size,
        primaryColor: request.designState.primaryColor,
        material: request.designState.material,
        texture: request.designState.texture,
        hardwareColor: request.designState.hardwareColor,
        hardwareStyle: request.designState.hardwareStyle,
        strapType: request.designState.strapType,
        strapLength: request.designState.strapLength,
        closure: request.designState.closure,
      },
      versionCount: request.versionCount,
      hasUserPhoto: request.hasUserPhoto,
    },
    questions: {
      consultation_action: choice(
        "Given the live fashion consultation utterance and extracted design attributes, which action should Dressly take right now?",
        criteria,
      ),
    },
  } as never)) as unknown as RawResult;

  const answer = result.answers?.consultation_action;
  const chosen = answer?.choice as ConsultationAction | undefined;
  if (!chosen || !CONSULTATION_ACTIONS.includes(chosen)) {
    throw new Error(
      `JEV chose a consultation action outside CONSULTATION_ACTIONS: ${String(answer?.choice)}`,
    );
  }

  const distribution = requireDistribution(toDistribution(answer?.probabilities));

  return {
    decision: chosen,
    confidence: clamp01(answer?.confidence ?? distribution[0]?.probability ?? 0),
    distribution,
    reason: buildConsultationReason(chosen, request),
    model: result.model ?? env.jevModel,
  };
}
