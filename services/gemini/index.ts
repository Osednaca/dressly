import { env } from "@/lib/env";
import type { IntentDelta } from "@/lib/types";
import { parseIntentDeterministic } from "@/services/gemini/fallback";
import {
  isGeminiConfigured,
  parseIntent,
  transcribeAudio,
  type SessionContext,
} from "@/services/gemini/client";

/**
 * The single language-layer policy decision.
 *
 * Preference order: real Gemini, then the deterministic keyword parser. A missing
 * key or an outage degrades understanding, never availability — and the provenance
 * is reported so the UI can be honest about it.
 */

export interface UnderstandingOutcome {
  intent: IntentDelta;
  provider: "gemini" | "fallback";
  model: string;
  note: string;
}

export async function understand(
  message: string,
  context: SessionContext,
): Promise<UnderstandingOutcome> {
  if (env.mockExternalApis) {
    return {
      intent: parseIntentDeterministic(message, context),
      provider: "fallback",
      model: "keyword-parser",
      note: "Mock mode: intent parsed with deterministic keywords.",
    };
  }

  if (!isGeminiConfigured()) {
    return {
      intent: parseIntentDeterministic(message, context),
      provider: "fallback",
      model: "keyword-parser",
      note: "GEMINI_API_KEY is not set: intent parsed with deterministic keywords.",
    };
  }

  try {
    const { intent, model } = await parseIntent(message, context);
    return { intent, provider: "gemini", model, note: "" };
  } catch (error) {
    return {
      intent: parseIntentDeterministic(message, context),
      provider: "fallback",
      model: "keyword-parser",
      note: `Gemini unavailable (${error instanceof Error ? error.message : "unknown error"}): intent parsed with deterministic keywords.`,
    };
  }
}

export { isGeminiConfigured, parseIntentDeterministic, transcribeAudio };
export type { SessionContext };
