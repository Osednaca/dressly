import { describeProduct, candidateProducts, lookItems, targetFormality, type ScoreBreakdown } from "@/lib/catalog/query";
import { FORMALITY_BY_STYLE } from "@/lib/catalog/query";
import { CATEGORY_LABELS } from "@/lib/catalog/products";
import type {
  AgentAction,
  CatalogCategory,
  IntentDelta,
  Product,
  StylingSession,
  StyleTag,
} from "@/lib/types";
import { STYLE_TAGS } from "@/lib/types";
import type { JevActionAlternative, JevProductAlternative } from "@/services/jev/client";

/**
 * Deterministic action planning.
 *
 * JEV judges — but it can only judge the alternatives we put in front of it. This
 * module decides *which* alternatives exist given the current outfit and the shopper's
 * latest message, so the decision engine is always choosing between things that make
 * sense in this exact state.
 */

export const ACTION_TO_CATEGORY: Partial<Record<AgentAction, CatalogCategory>> = {
  CHANGE_TOP: "upper_body",
  CHANGE_BOTTOM: "lower_body",
  CHANGE_SHOES: "shoes",
  ADD_OUTER: "outer",
  ADD_ACCESSORY: "accessory",
};

export function categoryForAction(action: AgentAction | undefined): CatalogCategory | undefined {
  if (!action) return undefined;
  return ACTION_TO_CATEGORY[action];
}

export function actionForCategory(category: CatalogCategory): AgentAction {
  switch (category) {
    case "upper_body":
      return "CHANGE_TOP";
    case "lower_body":
      return "CHANGE_BOTTOM";
    case "shoes":
      return "CHANGE_SHOES";
    case "outer":
      return "ADD_OUTER";
    case "accessory":
      return "ADD_ACCESSORY";
  }
}

/** The slot that most needs filling, in the order a stylist would build an outfit. */
export function gapCategory(session: StylingSession): CatalogCategory | undefined {
  if (!session.currentLook.top) return "upper_body";
  if (!session.currentLook.bottom) return "lower_body";
  if (!session.currentLook.shoes) return "shoes";
  if (!session.currentLook.outer) return "outer";
  return undefined;
}

const ACTION_DESCRIPTION: Record<AgentAction, string> = {
  CHANGE_TOP: "Replace the top with a different top that suits this occasion better.",
  CHANGE_BOTTOM: "Choose or replace the trousers, skirt or shorts.",
  CHANGE_FULL_OUTFIT: "Start the outfit over with a fresh top and build from there.",
  ADD_OUTER: "Add a lightweight outer layer such as a jacket, blazer or overshirt.",
  CHANGE_SHOES: "Choose or replace the shoes.",
  ADD_ACCESSORY: "Add a finishing accessory such as a belt, scarf or bag.",
  KEEP_LOOK: "Keep the current look exactly as it is.",
  SHOW_ALTERNATIVE: "Show a different garment option instead of the current one.",
  FINISH_LOOK: "The outfit feels complete: finish the look and show the summary.",
};

export interface Candidate {
  product: Product;
  score: ScoreBreakdown;
}

export interface TurnPlan {
  /** The slot the turn is primarily about, if any. */
  focus?: CatalogCategory;
  /** The action the shopper explicitly asked for, when they were unambiguous. */
  requestedAction?: AgentAction;
  actions: JevActionAlternative[];
  candidates: Candidate[];
  products: JevProductAlternative[];
  notes: string[];
}

function candidateForCategory(
  category: CatalogCategory,
  session: StylingSession,
  notes: string[],
): Candidate[] {
  const found = candidateProducts(category, session, 5);
  if (found.length === 0) {
    notes.push(`No available ${CATEGORY_LABELS[category].toLowerCase()} options remain.`);
  }
  return found;
}

/**
 * Build the explicit alternatives for this turn.
 *
 * The focus slot is chosen deterministically: what the shopper named, then what they
 * asked for, then the first gap in the outfit. Everything else is filtered in code.
 */
export function planTurn(session: StylingSession, intent: IntentDelta): TurnPlan {
  const notes: string[] = [];
  const requestedAction = intent.requestedAction;
  const explicitCategory = intent.targetCategory ?? categoryForAction(requestedAction);
  const focus = session.status === "COMPLETED" ? undefined : explicitCategory ?? gapCategory(session);

  const candidates: Candidate[] = [];
  if (focus && requestedAction !== "FINISH_LOOK") {
    candidates.push(...candidateForCategory(focus, session, notes));
  }

  // Offer outerwear alongside the focus so "add a jacket" and a JEV ADD_OUTER choice
  // both have real options even when the focus slot is something else.
  const outerWanted = !session.currentLook.outer && focus !== "outer";
  if (outerWanted && requestedAction !== "FINISH_LOOK") {
    candidates.push(...candidateForCategory("outer", session, notes));
  }

  const actions: JevActionAlternative[] = [];
  const add = (action: AgentAction) => {
    if (!actions.some((entry) => entry.id === action)) {
      actions.push({ id: action, description: ACTION_DESCRIPTION[action] });
    }
  };

  if (requestedAction) add(requestedAction);
  if (focus) add(actionForCategory(focus));
  if (outerWanted && candidates.some((c) => c.product.category === "outer")) add("ADD_OUTER");
  const worn = lookItems(session.currentLook);
  if (worn.length > 0) {
    add("FINISH_LOOK");
    add("CHANGE_FULL_OUTFIT");
  }
  add("KEEP_LOOK");
  if (candidates.length > 1) add("SHOW_ALTERNATIVE");

  // A single offered action is not a decision; keep the contract honest.
  if (actions.length < 2) add("KEEP_LOOK");

  const products: JevProductAlternative[] = candidates.map((c) => ({
    id: c.product.id,
    description: describeProduct(c.product),
  }));

  return { focus, requestedAction, actions, candidates, products, notes };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Deterministic style affinity, used by the JEV fallback (and never sent as an answer). */
export function styleScores(session: StylingSession): Record<StyleTag, number> {
  const desired = targetFormality(session);
  const scores = {} as Record<StyleTag, number>;
  for (const style of STYLE_TAGS) {
    const proximity = 1 - Math.abs(FORMALITY_BY_STYLE[style] - desired);
    let score = 0.15 + 0.7 * proximity;
    if (session.targetStyles.includes(style)) score += 0.2;
    if (session.avoidedStyles.includes(style)) score -= 0.55;
    scores[style] = clamp01(score);
  }
  return scores;
}

/** Deterministic usefulness of each offered action, used only by the JEV fallback. */
export function actionScores(
  session: StylingSession,
  plan: TurnPlan,
): Record<string, number> {
  const worn = lookItems(session.currentLook);
  const scores: Record<string, number> = {};
  const rejected = session.rejectedProducts.length > 0;
  for (const action of plan.actions) {
    let score = 0.35;
    if (plan.focus && action.id === actionForCategory(plan.focus)) score = 0.75;
    if (action.id === "FINISH_LOOK") score = worn.length >= 3 ? 0.7 : 0.25;
    if (action.id === "KEEP_LOOK") score = 0.28;
    if (action.id === "SHOW_ALTERNATIVE") score = 0.45;
    if (rejected && (action.id.startsWith("CHANGE") || action.id === "ADD_OUTER")) score += 0.12;
    // An explicit request is the strongest signal and must win over heuristics.
    if (action.id === plan.requestedAction) score = 1;
    scores[action.id] = clamp01(score);
  }
  return scores;
}

export function productScores(plan: TurnPlan): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const candidate of plan.candidates) scores[candidate.product.id] = candidate.score.total;
  return scores;
}
