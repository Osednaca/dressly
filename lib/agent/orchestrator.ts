import { getProduct } from "@/lib/catalog/products";
import { lookItems } from "@/lib/catalog/query";
import type { BlockedView } from "@/lib/api-types";
import { decide } from "@/services/jev";
import type { DecisionRecord, IntentDelta, Product, AgentAction, StylingSession } from "@/lib/types";
import { newId, nowIso } from "@/lib/util/id";
import {
  actionForCategory,
  actionScores,
  categoryForAction,
  planTurn,
  productScores,
  styleScores,
  type TurnPlan,
} from "@/lib/agent/plan";

/**
 * The agent turn.
 *
 * One call does the whole reasoning loop for a single shopper message: build the
 * explicit alternatives (deterministic), let JEV judge between them (AI), then resolve
 * that judgment into a concrete garment to try on. Nothing here generates chat; the
 * language layer already produced the reply. This is the decision.
 */

export interface AgentTurnResult {
  decision: DecisionRecord;
  /** The garment the action calls for, or null for KEEP / FINISH. */
  selection: { product: Product; action: AgentAction } | null;
  blocked: BlockedView | null;
}

function lookSummary(session: StylingSession): Record<string, unknown> {
  return {
    top: session.currentLook.top?.name ?? null,
    bottom: session.currentLook.bottom?.name ?? null,
    outer: session.currentLook.outer?.name ?? null,
    shoes: session.currentLook.shoes?.name ?? null,
    accessories: session.currentLook.accessories.map((item) => item.name),
  };
}

function bareState(session: StylingSession, intent: IntentDelta): Record<string, unknown> {
  return {
    occasion: session.occasion ?? null,
    status: session.status,
    budget: session.budget ?? null,
    targetStyles: session.targetStyles,
    avoidedStyles: session.avoidedStyles,
    preferredColors: session.preferredColors,
    avoidedColors: session.avoidedColors,
    currentLook: lookSummary(session),
    rejectedProducts: session.rejectedProducts
      .map((id) => getProduct(id)?.name ?? id)
      .slice(-6),
    likedProducts: session.likedProducts.map((id) => getProduct(id)?.name ?? id).slice(-6),
    looksGenerated: session.looks.length,
    latestFeedback: intent.feedbackOnCurrent ?? null,
    latestRequest: {
      understood: intent.interpreted,
      requestedAction: intent.requestedAction ?? null,
      targetCategory: intent.targetCategory ?? null,
    },
  };
}

/** Pick the concrete garment for a resolved action out of the offered candidates. */
function resolveSelection(
  plan: TurnPlan,
  action: AgentAction,
  chosenProductId: string | null,
  session: StylingSession,
): { product: Product } | null {
  if (action === "CHANGE_FULL_OUTFIT") {
    const fresh = plan.candidates.filter((c) => c.product.category === "upper_body");
    return fresh[0] ? { product: fresh[0].product } : null;
  }

  const category = categoryForAction(action) ?? plan.focus;
  if (!category) return null;
  if (action === "SHOW_ALTERNATIVE" && plan.focus) {
    const inFocus = plan.candidates.filter((c) => c.product.category === plan.focus);
    if (inFocus[0]) return { product: inFocus[0].product };
  }

  const matching = plan.candidates.filter((c) => c.product.category === category);
  if (matching.length === 0) return null;

  if (chosenProductId) {
    const exact = matching.find((c) => c.product.id === chosenProductId);
    if (exact) return { product: exact.product };
  }
  return { product: matching[0]!.product };
}

function selectionReason(
  product: Product,
  action: AgentAction,
  session: StylingSession,
  scoreTotal: number,
): string {
  const occasion = session.occasion ? ` for ${session.occasion}` : "";
  const verb: Record<string, string> = {
    CHANGE_TOP: "A fresh top",
    CHANGE_BOTTOM: "These",
    CHANGE_SHOES: "These",
    ADD_OUTER: "An outer layer",
    ADD_ACCESSORY: "This",
    CHANGE_FULL_OUTFIT: "A clean restart with",
    SHOW_ALTERNATIVE: "A different option,",
  };
  const opener = verb[action] ?? "This";
  const fit =
    scoreTotal >= 0.7
      ? "lands closest to the brief"
      : scoreTotal >= 0.5
        ? "keeps the outfit balanced"
        : "is the best remaining match";
  return `${opener} — ${product.name} ${fit}${occasion}.`;
}

function productEvaluation(plan: TurnPlan, distribution: { label: string; probability: number }[]) {
  if (distribution.length > 0) {
    return distribution.map((entry) => ({
      label: getProduct(entry.label)?.name ?? entry.label,
      probability: entry.probability,
    }));
  }
  return plan.candidates.map((candidate) => ({
    label: candidate.product.name,
    probability: candidate.score.total,
  }));
}

function scoreFor(plan: TurnPlan, productId: string): number {
  return plan.candidates.find((c) => c.product.id === productId)?.score.total ?? 0;
}

export async function runAgentTurn(
  session: StylingSession,
  intent: IntentDelta,
): Promise<AgentTurnResult> {
  const plan = planTurn(session, intent);
  const outcome = await decide(
    { state: bareState(session, intent), actions: plan.actions, products: plan.products },
    {
      productScores: productScores(plan),
      actionScores: actionScores(session, plan),
      styleScores: styleScores(session),
    },
  );

  const jevResult = outcome.result;
  const action = jevResult.action.decision;
  const iteration = session.decisions.length + 1;

  const base: DecisionRecord = {
    id: newId("dec"),
    createdAt: nowIso(),
    iteration,
    intent,
    styleDistribution: jevResult.styleDistribution,
    action: {
      decision: action,
      confidence: jevResult.action.confidence,
      distribution: jevResult.action.distribution,
    },
    productEvaluation: productEvaluation(plan, jevResult.product.distribution),
    reason: "",
    provider: outcome.provider,
    model: jevResult.model,
  };

  if (action === "KEEP_LOOK") {
    return {
      decision: { ...base, reason: "Keeping the current look while we refine the details." },
      selection: null,
      blocked: null,
    };
  }

  if (action === "FINISH_LOOK") {
    return {
      decision: {
        ...base,
        reason: "The outfit reads complete, so this is the look to finish with.",
      },
      selection: null,
      blocked: null,
    };
  }

  const resolved = resolveSelection(plan, action, jevResult.product.productId, session);
  if (!resolved) {
    const label = action.replace(/_/g, " ").toLowerCase();
    return {
      decision: {
        ...base,
        reason: `Wanted to ${label} but no suitable garment remained in the catalog.`,
      },
      selection: null,
      blocked: {
        code: "NO_CANDIDATES",
        message:
          "Every matching piece has been tried or rejected. Reset the rejected items or soften a preference to continue.",
        retryable: false,
      },
    };
  }

  const score = scoreFor(plan, resolved.product.id);
  const selected: Product = resolved.product;
  const effectiveAction: AgentAction = action === "SHOW_ALTERNATIVE"
    ? actionForCategory(selected.category)
    : action;

  return {
    decision: {
      ...base,
      selectedProductId: selected.id,
      selectedProductName: selected.name,
      reason: selectionReason(selected, effectiveAction, session, score),
    },
    selection: { product: selected, action: effectiveAction },
    blocked: null,
  };
}

/** Exposed for the tests and the panel: what the agent can do in this state. */
export function planFor(session: StylingSession, intent: IntentDelta): TurnPlan {
  return planTurn(session, intent);
}

export function wornNames(session: StylingSession): string[] {
  return lookItems(session.currentLook).map((item) => item.name);
}
