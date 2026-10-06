import type { Occasion } from "@/lib/types";

/**
 * Deterministic occasion inference.
 *
 * Gemini is allowed to say "rooftop dinner"; the catalog speaks in enum tags. This
 * mapping is plain code on purpose: it is fast, free, debuggable, and it keeps the
 * language model from having to know our taxonomy.
 */
const OCCASION_KEYWORDS: Record<Occasion, readonly string[]> = {
  dinner: ["dinner", "supper", "restaurant", "rooftop", "bistro", "brunch", "lunch"],
  date: ["date", "romantic", "anniversary", "valentine"],
  vacation: ["vacation", "holiday", "beach", "resort", "island", "getaway", "cruise"],
  work: ["work", "office", "meeting", "client", "interview", "presentation", "standup"],
  party: ["party", "club", "birthday", "celebration", "festival", "concert"],
  wedding: ["wedding", "gala", "black tie", "ceremony", "reception"],
  everyday: ["everyday", "daily", "errands", "casual day", "weekend", "coffee"],
  travel: ["travel", "airport", "flight", "train", "road trip", "city break"],
  event: ["event", "opening", "launch", "show", "conference", "networking", "rooftop dinner"],
};

/**
 * Map free text (an occasion phrase plus any extra context) onto catalog tags.
 * Returns `everyday` when nothing matches, which is the honest default rather than
 * pretending we understood something we did not.
 */
export function inferOccasions(text: string | undefined): Occasion[] {
  if (!text) return ["everyday"];
  const haystack = text.toLowerCase();
  const matches: Occasion[] = [];
  for (const [occasion, keywords] of Object.entries(OCCASION_KEYWORDS) as [
    Occasion,
    readonly string[],
  ][]) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      matches.push(occasion);
    }
  }
  if (matches.length === 0) return ["everyday"];
  // "rooftop dinner" matches both `event` and `dinner`; keep the more specific first
  // by preserving declaration order but de-duplicating.
  return [...new Set(matches)];
}

/** How well a product's occasion tags match what we inferred from the conversation. */
export function occasionFit(productOccasions: readonly Occasion[], inferred: readonly Occasion[]): number {
  if (inferred.length === 0) return 0.5;
  const hits = productOccasions.filter((occasion) => inferred.includes(occasion)).length;
  if (hits === 0) return 0.15;
  return Math.min(1, 0.55 + (hits / inferred.length) * 0.45);
}
