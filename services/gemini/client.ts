import { env } from "@/lib/env";
import { ProviderError, requestJson } from "@/lib/util/http";
import type { AgentAction, CatalogCategory, IntentDelta, StyleTag } from "@/lib/types";
import { AGENT_ACTIONS, STYLE_TAGS } from "@/lib/types";

/**
 * Gemini as the language and multimodal layer.
 *
 * Gemini's job is narrow and deliberately so: turn a sentence into structure.
 * It is never asked which garment wins — that is JEV's job — and it is never asked
 * to compute anything (totals, filters, category mapping) that plain code does
 * better, cheaper and reproducibly.
 *
 * The user's photograph is intentionally NOT sent here. It contains a person and
 * adds nothing to intent parsing; the only service that needs it is YouCam.
 */

const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  "upper_body",
  "lower_body",
  "outer",
  "shoes",
  "accessory",
];

const SYSTEM_INSTRUCTION = `You are the language layer of Dressly, an AI personal stylist.

Your ONLY job is to convert the shopper's latest message plus the current styling session into a strict JSON object. You do not choose garments, you do not rank products, and you do not write marketing copy.

Rules:
- Interpret feedback relative to the CURRENT LOOK in the session. "Too formal", "I don't like it", "this is closer" are feedback about what is currently worn.
- Only set requestedAction when the shopper is unambiguous about the next step.
- Only set targetCategory when the shopper names a garment category.
- Use lowercase single-word colour names (cream, black, beige, navy, sand, olive, indigo, camel, white, sky, stone, charcoal, khaki, brown, grey, emerald, champagne, ivory, graphite).
- assistantReply is ONE short sentence in the shopper's own language, spoken by the stylist. Never mention models, APIs, JSON or scores.
- interpreted is 2-4 very short chips describing what you understood, in the shopper's language.
- Use "NONE" / "none" / 0 as the empty value for the optional fields.
- Never invent preferences the shopper did not express.`;

interface SessionContext {
  occasion?: string;
  targetStyles: string[];
  avoidedStyles: string[];
  preferredColors: string[];
  avoidedColors: string[];
  budget?: number;
  currentLook: string;
  rejected: string[];
  liked: string[];
  lookCount: number;
}

function buildPrompt(message: string, context: SessionContext): string {
  return `CURRENT SESSION
occasion: ${context.occasion ?? "(none yet)"}
target styles: ${context.targetStyles.join(", ") || "(none yet)"}
avoided styles: ${context.avoidedStyles.join(", ") || "(none)"}
preferred colours: ${context.preferredColors.join(", ") || "(none)"}
avoided colours: ${context.avoidedColors.join(", ") || "(none)"}
budget: ${context.budget ?? "(none)"}
current look: ${context.currentLook || "(nothing worn yet)"}
already rejected: ${context.rejected.join(", ") || "(none)"}
already liked: ${context.liked.join(", ") || "(none)"}
looks generated so far: ${context.lookCount}

SHOPPER MESSAGE
"""${message}"""

Return exactly this JSON shape and nothing else:
{
  "occasion": "short occasion phrase, or empty string",
  "desiredStyles": [${STYLE_TAGS.map((style) => `"${style}"`).join(" | ")}],
  "avoidedStyles": [],
  "preferredColors": ["lowercase colour"],
  "avoidedColors": ["lowercase colour"],
  "budget": 0,
  "requestedAction": "NONE",
  "feedbackOnCurrent": "none",
  "targetCategory": "none",
  "assistantReply": "one short sentence in the shopper's language",
  "interpreted": ["short chip"]
}

requestedAction is one of: NONE, ${AGENT_ACTIONS.join(", ")}
feedbackOnCurrent is one of: none, liked, rejected, closer
targetCategory is one of: none, ${CATALOG_CATEGORIES.join(", ")}`;
}

interface RawIntent {
  occasion?: unknown;
  desiredStyles?: unknown;
  avoidedStyles?: unknown;
  preferredColors?: unknown;
  avoidedColors?: unknown;
  budget?: unknown;
  requestedAction?: unknown;
  feedbackOnCurrent?: unknown;
  targetCategory?: unknown;
  assistantReply?: unknown;
  interpreted?: unknown;
}

function stringArray(value: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && item !== "none");
  const unique = [...new Set(items)];
  return allowed ? unique.filter((item) => allowed.includes(item)) : unique;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || /^(none|n\/a|null)$/i.test(trimmed)) return undefined;
  return trimmed;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const match = allowed.find((item) => item.toLowerCase() === text.toLowerCase());
  return match;
}

/** Normalize whatever the model produced into the contract the rest of the app trusts. */
export function normalizeIntent(raw: RawIntent): IntentDelta {
  const feedback = optionalEnum(raw.feedbackOnCurrent, ["liked", "rejected", "closer"] as const);
  const budgetRaw = typeof raw.budget === "number" ? raw.budget : Number(raw.budget);
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.round(budgetRaw) : undefined;

  return {
    occasion: optionalString(raw.occasion),
    desiredStyles: stringArray(raw.desiredStyles, STYLE_TAGS) as StyleTag[],
    avoidedStyles: stringArray(raw.avoidedStyles, STYLE_TAGS) as StyleTag[],
    preferredColors: stringArray(raw.preferredColors),
    avoidedColors: stringArray(raw.avoidedColors),
    budget,
    requestedAction: optionalEnum(raw.requestedAction, AGENT_ACTIONS) as AgentAction | undefined,
    feedbackOnCurrent: feedback,
    targetCategory: optionalEnum(raw.targetCategory, CATALOG_CATEGORIES),
    assistantReply: optionalString(raw.assistantReply) ?? "",
    interpreted: Array.isArray(raw.interpreted)
      ? raw.interpreted
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 4)
      : [],
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

export function isGeminiConfigured(): boolean {
  return Boolean(env.geminiApiKey);
}

export async function parseIntent(
  message: string,
  context: SessionContext,
): Promise<{ intent: IntentDelta; model: string }> {
  if (!env.geminiApiKey) {
    throw new ProviderError("gemini", 401, "GEMINI_API_KEY is not configured");
  }

  const response = await requestJson<GeminiResponse>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      env.geminiModel,
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(message, context) }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.9,
          responseMimeType: "application/json",
          maxOutputTokens: 900,
        },
      }),
    },
    { provider: "gemini", timeoutMs: env.geminiTimeoutMs, retries: 1 },
  );

  if (!response.ok) {
    throw new ProviderError(
      "gemini",
      response.status,
      response.data?.error?.message ?? `HTTP ${response.status}`,
      { retryable: response.status >= 500 || response.status === 429, body: response.text },
    );
  }

  const text = response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text || text.trim().length === 0) {
    throw new ProviderError("gemini", 502, "Gemini returned no content");
  }

  let parsed: RawIntent;
  try {
    parsed = JSON.parse(stripCodeFence(text)) as RawIntent;
  } catch {
    throw new ProviderError("gemini", 502, "Gemini returned content that was not valid JSON");
  }

  return { intent: normalizeIntent(parsed), model: env.geminiModel };
}

/** Models sometimes wrap JSON in a markdown fence even when asked not to. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export type { SessionContext };
