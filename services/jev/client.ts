import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { env } from "@/lib/env";
import type { AgentAction, ScoredAlternative, StyleTag } from "@/lib/types";
import { STYLE_TAGS } from "@/lib/types";

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
