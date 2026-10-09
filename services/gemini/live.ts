import { env } from "@/lib/env";
import { lookItems } from "@/lib/catalog/query";
import type { StylingSession } from "@/lib/types";
import { ProviderError, requestJson } from "@/lib/util/http";

/**
 * Gemini Live — the spoken stylist.
 *
 * The browser talks to the Live API directly (audio must not round-trip through our
 * server), but it does so with a single-use ephemeral token whose setup is locked
 * here: the system instruction, the tools and the model are fixed server-side, so the
 * browser can neither see the API key nor repurpose the session.
 *
 * Live is only the voice. Garment choice still goes through the existing turn
 * (intent -> JEV -> YouCam) via the `style_request` tool.
 */

export const LIVE_TOOL_NAMES = ["style_request", "finish_look"] as const;
export type LiveToolName = (typeof LIVE_TOOL_NAMES)[number];

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "style_request",
        description:
          "Send the shopper's styling request or feedback to Dressly's styling engine. It updates their preferences, chooses the next garment and starts the virtual try-on on their photo. Use it for occasions, preferences, colours, budget, feedback on the current look, or asking to change or add a piece.",
        parameters: {
          type: "OBJECT",
          properties: {
            message: {
              type: "STRING",
              description:
                "The shopper's request as one clear sentence, in their own language, e.g. 'Rooftop dinner tonight, elegant but not too formal' or 'That's too formal, try something lighter'.",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "finish_look",
        description: "Finish the session with the current look when the shopper is happy with it.",
      },
    ],
  },
];

function sessionBrief(session: StylingSession): string {
  const worn = lookItems(session.currentLook).map((item) => `${item.name} (${item.colors.join("/")})`);
  return [
    `occasion: ${session.occasion ?? "(not given yet)"}`,
    `currently wearing: ${worn.join(", ") || "(nothing tried on yet)"}`,
    `looks generated: ${session.looks.length}`,
    `preferred colours: ${session.preferredColors.join(", ") || "(none)"}`,
    `avoided colours: ${session.avoidedColors.join(", ") || "(none)"}`,
    `budget: ${session.budget ?? "(none)"}`,
  ].join("\n");
}

function systemInstruction(session: StylingSession): string {
  return `You are Dressly, a warm, confident personal stylist talking live with a shopper. They see a virtual fitting room where each garment is tried on their own photo.

How you work:
- You never choose garments yourself. Whenever the shopper gives an occasion, a preference, feedback on what they are wearing, or asks to change or add a piece, call style_request with their request.
- After style_request returns, say its reply naturally in one or two short sentences. If tryOn is "started", tell them it is being fitted now and do not describe the result until you are told it is ready. If tryOn is "blocked", explain the reason simply.
- Messages that start with [fitting room] come from the app, not the shopper. React in one short sentence and ask what they think.
- When the shopper is happy and wants to wrap up, call finish_look.
- Speak the shopper's language. Keep every turn short and conversational. Never mention tools, APIs, models or JSON.

Session so far:
${sessionBrief(session)}`;
}

/** The complete, locked Live setup for one shopper session. Pure, so it is unit-testable. */
export function buildLiveSetup(session: StylingSession, model = env.geminiLiveModel) {
  return {
    model: `models/${model}`,
    generationConfig: { responseModalities: ["AUDIO"] },
    systemInstruction: { parts: [{ text: systemInstruction(session) }] },
    tools: TOOLS,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export interface LiveToken {
  token: string;
  model: string;
  expiresAt: string;
}

export async function createLiveToken(session: StylingSession): Promise<LiveToken> {
  if (!env.geminiApiKey) {
    throw new ProviderError("gemini", 401, "GEMINI_API_KEY is not configured");
  }
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 60_000).toISOString();
  const setup = buildLiveSetup(session);

  const response = await requestJson<{ name?: string; error?: { message?: string } }>(
    "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey },
      body: JSON.stringify({
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        bidiGenerateContentSetup: setup,
      }),
    },
    { provider: "gemini", timeoutMs: env.geminiTimeoutMs, retries: 1 },
  );

  if (!response.ok || !response.data?.name) {
    throw new ProviderError(
      "gemini",
      response.status,
      response.data?.error?.message ?? `Could not create a Live token (HTTP ${response.status})`,
      { retryable: response.status >= 500 || response.status === 429, body: response.text },
    );
  }
  return { token: response.data.name, model: setup.model, expiresAt };
}
