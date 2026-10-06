import type { AgentAction, ScoredAlternative, StyleTag } from "@/lib/types";
import type { JevResult, JevRequest } from "@/services/jev/client";

/**
 * Deterministic stand-in for JEV.
 *
 * Used in two situations, both of which the UI states plainly:
 *   - development mock mode, where no credential exists yet;
 *   - a real JEV outage, where the brief requires the session to keep moving.
 *
 * It is a genuine decision — it ranks the same explicit alternatives by the same
 * metadata — it is simply less nuanced than the model, and the Agent Decisions panel
 * labels the record `fallback` so it never over-claims.
 */

export interface DecisionSignals {
  /** Deterministic 0..1 score per offered product id. */
  productScores: Record<string, number>;
  /** Heuristic 0..1 usefulness per offered action. */
  actionScores: Record<string, number>;
  /** Deterministic 0..1 affinity per style tag. */
  styleScores: Record<StyleTag, number>;
}

function softmax(scores: Record<string, number>, temperature: number): Record<string, number> {
  const entries = Object.entries(scores);
  if (entries.length === 0) return {};
  const scaled = entries.map(([label, score]) => [label, score / temperature] as const);
  const max = Math.max(...scaled.map(([, value]) => value));
  const exponentials = scaled.map(([label, value]) => [label, Math.exp(value - max)] as const);
  const total = exponentials.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) return Object.fromEntries(entries.map(([label]) => [label, 1 / entries.length]));
  return Object.fromEntries(exponentials.map(([label, value]) => [label, value / total]));
}

function distribution(probabilities: Record<string, number>): ScoredAlternative[] {
  return Object.entries(probabilities)
    .map(([label, probability]) => ({ label, probability: Math.round(probability * 1000) / 1000 }))
    .sort((a, b) => b.probability - a.probability);
}

export function evaluateDeterministic(request: JevRequest, signals: DecisionSignals): JevResult {
  const styleProbabilities = softmax(signals.styleScores, 0.18);
  const styleDistribution = distribution(styleProbabilities);

  const actionProbabilities = softmax(signals.actionScores, 0.12);
  const actionDistribution = distribution(actionProbabilities);
  const actionChoice = (actionDistribution[0]?.label as AgentAction | undefined) ?? "KEEP_LOOK";

  const productDistribution = distribution(softmax(signals.productScores, 0.1));
  const productChoice = productDistribution[0]?.label ?? null;

  return {
    action: {
      decision: actionChoice,
      confidence: actionDistribution[0]?.probability ?? 0,
      distribution:
        actionDistribution.length >= 2
          ? actionDistribution
          : // The contract requires a real distribution; a single action is certain.
            [
              { label: actionChoice, probability: 1 },
              { label: actionChoice === "KEEP_LOOK" ? "FINISH_LOOK" : "KEEP_LOOK", probability: 0 },
            ],
    },
    product: {
      productId: productChoice,
      confidence: productDistribution[0]?.probability ?? 0,
      distribution: productDistribution,
    },
    styleDistribution:
      styleDistribution.length >= 2
        ? styleDistribution
        : [
            { label: "smart_casual", probability: 1 },
            { label: "casual", probability: 0 },
          ],
    model: "deterministic-fallback",
  };
}
