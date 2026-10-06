import { CATALOG } from "@/lib/catalog/products";
import { inferOccasions, occasionFit } from "@/lib/catalog/occasion";
import type {
  CatalogCategory,
  CurrentLook,
  Product,
  StylingSession,
  StyleTag,
} from "@/lib/types";

/**
 * Deterministic catalog reasoning.
 *
 * Everything here is plain code on purpose. The whole point of Dressly is that the
 * AI judges between *explicit alternatives*; producing those alternatives — and
 * never handing the model the entire catalog — is arithmetic, not intelligence.
 */

/** How formal each style tag reads on a 0..1 axis. Used to place a garment. */
export const FORMALITY_BY_STYLE: Record<StyleTag, number> = {
  sport: 0.08,
  casual: 0.2,
  streetwear: 0.25,
  minimal: 0.42,
  smart_casual: 0.5,
  evening: 0.72,
  business: 0.76,
  formal: 0.95,
};

/** Weight of each signal. Exported so the Agent Decisions panel can explain itself. */
export const SCORE_WEIGHTS = {
  occasionFit: 0.28,
  styleFit: 0.26,
  colorCompatibility: 0.16,
  userPreferenceFit: 0.12,
  cohesion: 0.12,
  budgetFit: 0.06,
} as const;

export interface ScoreBreakdown {
  occasionFit: number;
  styleFit: number;
  colorCompatibility: number;
  userPreferenceFit: number;
  cohesion: number;
  budgetFit: number;
  total: number;
}

export function lookItems(look: CurrentLook): Product[] {
  return [look.top, look.bottom, look.outer, look.shoes, ...look.accessories].filter(
    (item): item is Product => item !== undefined,
  );
}

export function lookTotal(look: CurrentLook): number {
  return lookItems(look).reduce((sum, item) => sum + item.price, 0);
}

/** Mean formality the conversation is asking for. Falls back to a neutral middle. */
export function targetFormality(session: StylingSession): number {
  if (session.targetStyles.length === 0) return 0.5;
  const sum = session.targetStyles.reduce((acc, style) => acc + FORMALITY_BY_STYLE[style], 0);
  return sum / session.targetStyles.length;
}

function overlapRatio(values: readonly string[], wanted: readonly string[]): number {
  if (wanted.length === 0) return 0;
  const hits = values.filter((value) => wanted.includes(value)).length;
  return hits / wanted.length;
}

/** Occasion tags we inferred from the session's free-text occasion. */
export function sessionOccasions(session: StylingSession) {
  return inferOccasions(session.occasion);
}

function styleFit(product: Product, session: StylingSession): number {
  const wanted = session.targetStyles;
  const avoided = session.avoidedStyles;
  let base = wanted.length === 0 ? 0.5 : 0.35 + overlapRatio(product.styles, wanted) * 0.65;
  // An explicitly avoided style is a hard signal, not a nudge.
  const avoidedHits = product.styles.filter((style) => avoided.includes(style)).length;
  if (avoidedHits > 0) base *= Math.max(0.1, 1 - 0.6 * avoidedHits);
  return clamp(base);
}

function colorCompatibility(product: Product, session: StylingSession): number {
  if (product.colors.some((color) => session.avoidedColors.includes(color))) return 0.05;
  if (session.preferredColors.length === 0) return 0.6;
  const hits = product.colors.filter((color) => session.preferredColors.includes(color)).length;
  return clamp(hits > 0 ? 0.85 + Math.min(0.15, hits * 0.1) : 0.35);
}

/**
 * Affinity toward what the user already responded to. Liked garments teach the
 * session which styles and colors land; rejected ones only ever remove options.
 */
function userPreferenceFit(product: Product, session: StylingSession): number {
  const liked = session.likedProducts
    .map((id) => CATALOG.find((item) => item.id === id))
    .filter((item): item is Product => item !== undefined);
  if (liked.length === 0) return 0.5;

  const styleAffinity = liked.some((item) =>
    item.styles.some((style) => product.styles.includes(style)),
  )
    ? 0.3
    : 0;
  const colorAffinity = liked.some((item) =>
    item.colors.some((color) => product.colors.includes(color)),
  )
    ? 0.2
    : 0;
  return clamp(0.5 + styleAffinity + colorAffinity);
}

/** How well this garment sits with the pieces already on the body. */
function cohesion(product: Product, session: StylingSession): number {
  const worn = lookItems(session.currentLook).filter((item) => item.category !== product.category);
  if (worn.length === 0) return 0.7;

  const desired = targetFormality(session);
  const formalityDelta =
    worn.reduce((acc, item) => acc + Math.abs(item.formality - desired), 0) / worn.length;
  const formalityScore = clamp(1 - formalityDelta * 1.4);

  const colorScore = worn.some((item) => item.colors.some((c) => product.colors.includes(c)))
    ? 0.95
    : 0.7;

  return clamp(formalityScore * 0.6 + colorScore * 0.4);
}

function budgetFit(product: Product, session: StylingSession): number {
  if (session.budget === undefined) return 1;
  if (product.price <= session.budget) return 1;
  return clamp(session.budget / product.price);
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scoreProduct(product: Product, session: StylingSession): ScoreBreakdown {
  const parts = {
    occasionFit: occasionFit(product.occasions, sessionOccasions(session)),
    styleFit: styleFit(product, session),
    colorCompatibility: colorCompatibility(product, session),
    userPreferenceFit: userPreferenceFit(product, session),
    cohesion: cohesion(product, session),
    budgetFit: budgetFit(product, session),
  };
  const total =
    parts.occasionFit * SCORE_WEIGHTS.occasionFit +
    parts.styleFit * SCORE_WEIGHTS.styleFit +
    parts.colorCompatibility * SCORE_WEIGHTS.colorCompatibility +
    parts.userPreferenceFit * SCORE_WEIGHTS.userPreferenceFit +
    parts.cohesion * SCORE_WEIGHTS.cohesion +
    parts.budgetFit * SCORE_WEIGHTS.budgetFit;

  return {
    occasionFit: round(parts.occasionFit),
    styleFit: round(parts.styleFit),
    colorCompatibility: round(parts.colorCompatibility),
    userPreferenceFit: round(parts.userPreferenceFit),
    cohesion: round(parts.cohesion),
    budgetFit: round(parts.budgetFit),
    total: round(total),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Hard filters. These are not preferences — a product that fails here must never be
 * offered, and no AI call gets to overrule them.
 */
export function eligibleProducts(category: CatalogCategory, session: StylingSession): Product[] {
  return CATALOG.filter((product) => {
    if (product.category !== category) return false;
    // YouCam can only visualize garments it has a category for. Accessories are
    // catalog-only: they are listed in the final look but never sent as a ref image.
    if (category !== "accessory" && product.vtoCategory === null) return false;
    if (session.rejectedProducts.includes(product.id)) return false;
    if (lookItems(session.currentLook).some((item) => item.id === product.id)) return false;
    return true;
  });
}

/** Every catalog product the session has not rejected — used for the value summary. */
export function compatibleProducts(session: StylingSession): Product[] {
  return CATALOG.filter((product) => !session.rejectedProducts.includes(product.id));
}

/**
 * The candidate set handed to JEV: hard filters, then deterministic ranking, then a
 * small shortlist. Never the whole catalog.
 */
export function candidateProducts(
  category: CatalogCategory,
  session: StylingSession,
  limit = 5,
): { product: Product; score: ScoreBreakdown }[] {
  const eligible = eligibleProducts(category, session);
  const budgeted = session.budget
    ? eligible.filter((product) => product.price <= session.budget! * 1.35)
    : eligible;
  const pool = budgeted.length > 0 ? budgeted : eligible;

  return pool
    .map((product) => ({ product, score: scoreProduct(product, session) }))
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      // Deterministic tiebreak so the same state always yields the same shortlist.
      return a.product.id.localeCompare(b.product.id);
    })
    .slice(0, limit);
}

/**
 * Deterministic fallback used when JEV is unreachable: the highest-scoring candidate
 * wins. It is a real decision, just a less nuanced one, and the panel says so.
 */
export function bestByMetadata(
  category: CatalogCategory,
  session: StylingSession,
): { product: Product; score: ScoreBreakdown } | null {
  return candidateProducts(category, session, 1)[0] ?? null;
}

/** One line of catalog facts, used as the description JEV evaluates. */
export function describeProduct(product: Product): string {
  return [
    `${product.name} (${product.id})`,
    `category=${product.category}`,
    `styles=${product.styles.join("/")}`,
    `occasions=${product.occasions.join("/")}`,
    `colors=${product.colors.join("/")}`,
    `formality=${product.formality.toFixed(2)}`,
    `price=$${product.price}`,
  ].join(" ");
}
