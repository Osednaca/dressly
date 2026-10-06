import { env } from "@/lib/env";
import { evaluateDeterministic, type DecisionSignals } from "@/services/jev/fallback";
import { evaluateWithJev, isJevConfigured, type JevRequest, type JevResult } from "@/services/jev/client";

/**
 * The single JEV policy decision.
 *
 * Order of preference: a real JEV evaluation, then a deterministic ranking of the
 * same alternatives. A missing key or a provider outage must never freeze the
 * styling session, and the returned `provider` is what the Agent Decisions panel
 * reports, so the fallback is always visible rather than silent.
 */

export interface JevOutcome {
  result: JevResult;
  provider: "jev" | "fallback";
  /** Short, user-safe note explaining why the fallback ran. Empty for real JEV. */
  note: string;
}

export async function decide(request: JevRequest, signals: DecisionSignals): Promise<JevOutcome> {
  if (env.mockExternalApis) {
    return {
      result: evaluateDeterministic(request, signals),
      provider: "fallback",
      note: "Mock mode: decisions computed deterministically, not by JEV.",
    };
  }

  if (!isJevConfigured()) {
    return {
      result: evaluateDeterministic(request, signals),
      provider: "fallback",
      note: "TYPESAFE_API_KEY is not set: ranked deterministically instead.",
    };
  }

  try {
    const result = await evaluateWithJev(request);
    return { result, provider: "jev", note: "" };
  } catch (error) {
    return {
      result: evaluateDeterministic(request, signals),
      provider: "fallback",
      note: `JEV unavailable (${error instanceof Error ? error.message : "unknown error"}): ranked deterministically instead.`,
    };
  }
}

export { evaluateDeterministic, isJevConfigured };
export type { DecisionSignals, JevRequest, JevResult };
