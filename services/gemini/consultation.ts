import type { CandidateConsultationExtraction } from "@/lib/api-types";
import { env } from "@/lib/env";
import {
  DESIGN_FIELD_KEYS,
  type BagDesignState,
  type DesignFieldKey,
  type DesignVersion,
} from "@/lib/types";
import { ProviderError, requestJson } from "@/lib/util/http";

const CONSULTATION_SYSTEM_INSTRUCTION = `You are the semantic fashion design extractor for Dressly Live Consultation.
You listen to transcript excerpts from a live Google Meet consultation between a fashion designer and a customer who are collaboratively customizing a handbag.

Your ONLY job is to classify the utterance and extract structured attribute changes relative to the CURRENT BAG DESIGN STATE.
Return strict JSON and nothing else.

Rules:
- Ignore casual small talk, greetings, coffee chat, and meeting audio/video checks ("How was your weekend?", "Can you hear me?", "One second"): set isRelevantFashionSpeech=false, speechKind="small_talk_or_technical", changes=[].
- If the speaker cancels or retracts ("Actually never mind", "Forget it", "Scratch that"): set isRelevantFashionSpeech=false, speechKind="cancel_or_nevermind", changes=[].
- If the speaker asks to see the bag on themselves ("Can I see how that looks on me?", "Try it on me"): set isRelevantFashionSpeech=true, speechKind="try_on_request", changes=[].
- If the speaker asks to go back to an earlier version ("I liked the previous version better", "Go back to V2"): set isRelevantFashionSpeech=true, speechKind="revert_version", targetVersionNumber (if named), changes=[].
- If the speaker confirms the design is finished ("This is the one, let's finalize it", "Lock it in"): set isRelevantFashionSpeech=true, speechKind="finalize_request", changes=[].
- If the speaker states a vague preference with no specific attribute ("Maybe something different", "I'm not sure"): set isRelevantFashionSpeech=true, speechKind="vague_preference", changes=[], clarificationQuestion="Which attribute should we adjust — color, hardware, size, or strap?".
- When the speaker requests one or more concrete design changes (even across combined clauses like "make it smaller and use gold hardware"): set isRelevantFashionSpeech=true, speechKind="design_modification", and include EVERY requested field in changes[].
- Relative adjustments must resolve against CURRENT BAG DESIGN STATE (e.g., if size is "large" and speaker says "this feels too big", propose size="medium"; if size is "medium" and speaker says "smaller" or "too big", propose size="small").`;

const SMALL_TALK_PATTERNS: readonly RegExp[] = [
  /\bhow was your weekend\b/i,
  /\bcan you hear me\b/i,
  /\bhear me okay\b/i,
  /\bgive me a second\b/i,
  /\bone second\b/i,
  /\bhold on a second\b/i,
  /\bconnection is (?:bad|laggy|choppy|freezing)\b/i,
  /\bi like coffee\b/i,
  /\bneed (?:more )?coffee\b/i,
  /\bhow are you(?: doing)?\b/i,
  /\bgood morning\b/i,
  /\bgood afternoon\b/i,
  /\bgood evening\b/i,
  /^(?:hi|hello|hey|testing|test|mic check|check one two)[\s.!?,]*$/i,
  /\bweather is\b/i,
  /\bscreen share\b/i,
];

const RETRACTION_PATTERNS: readonly RegExp[] = [
  /\bnever\s*mind\b/i,
  /\bforget (?:it|that)\b/i,
  /\bscratch that\b/i,
  /\bleave it as (?:it )?is\b/i,
  /\bkeep it as (?:it )?is\b/i,
  /\bdon'?t change anything\b/i,
];

const TRY_ON_PATTERNS: readonly RegExp[] = [
  /\b(?:can i|could i|let'?s|can we) see how (?:that|it|this) looks on me\b/i,
  /\bhow (?:does|would) (?:that|it|this) look on me\b/i,
  /\bsee (?:it|that|this) on (?:me|myself)\b/i,
  /\btry (?:it|this|that) on(?:\s+me)?\b/i,
  /\bvirtual try[\s-]?on\b/i,
  /\bwear it on me\b/i,
  /^(?:yeah\s+)?(?:can i\s+)?wear it[\s?.!]*$/i,
];

const REVERT_PATTERNS: readonly RegExp[] = [
  /\bprevious version\b/i,
  /\bearlier version\b/i,
  /\bgo back to\b/i,
  /\brestore (?:version|v\d+)\b/i,
  /\bliked the (?:previous|earlier|first|last) (?:version|one) better\b/i,
  /\bback to v\s*\d+\b/i,
];

const FINALIZE_PATTERNS: readonly RegExp[] = [
  /\bfinalize (?:the |this )?design\b/i,
  /\blet'?s finalize\b/i,
  /\bthis is the one\b/i,
  /\bwe'?re done\b/i,
  /\block it in\b/i,
];

const VAGUE_PATTERNS: readonly RegExp[] = [
  /\bmaybe something different\b/i,
  /\bsomething else\b/i,
  /\bi don'?t know\b/i,
  /\bnot sure what\b/i,
  /\bchange something\b/i,
];

function extractModificationsFromText(
  text: string,
  designState: BagDesignState,
): Array<{ field: DesignFieldKey; proposedValue: string }> {
  const lower = text.toLowerCase();
  const changes = new Map<DesignFieldKey, string>();

  // 1. Hardware color
  if (/\bbrushed gold\b/i.test(lower)) {
    changes.set("hardwareColor", "brushed gold");
  } else if (/\brose gold\b/i.test(lower)) {
    changes.set("hardwareColor", "rose gold");
  } else if (/\bmatte black\b.*\b(?:hardware|clasp|buckle|metal|rings)\b|\b(?:hardware|clasp|buckle|metal|rings)\b.*\bmatte black\b/i.test(lower)) {
    changes.set("hardwareColor", "matte black");
  } else if (/\bgunmetal\b/i.test(lower)) {
    changes.set("hardwareColor", "gunmetal");
  } else if (/\bbrass\b/i.test(lower)) {
    changes.set("hardwareColor", "brass");
  } else if (/\bgold\b/i.test(lower)) {
    changes.set("hardwareColor", "gold");
  } else if (/\bsilver\b/i.test(lower)) {
    changes.set("hardwareColor", "silver");
  }

  // 2. Hardware style
  if (/\bsculpted buckle\b/i.test(lower)) {
    changes.set("hardwareStyle", "sculpted buckle");
  } else if (/\bminimal(?:ist)? geometric clasp\b/i.test(lower)) {
    changes.set("hardwareStyle", "minimal geometric clasp");
  } else if (/\bchain accent\b/i.test(lower)) {
    changes.set("hardwareStyle", "chain accent");
  } else if (/\bpadlock(?: clasp)?\b/i.test(lower)) {
    changes.set("hardwareStyle", "padlock clasp");
  }

  // 3. Size (including relative size adjustments against designState.size)
  const currentSize = designState.size.toLowerCase();
  if (/\b(?:feels |is |little |bit )?too (?:big|large|bulky)\b/i.test(lower)) {
    const nextSize = currentSize.includes("large") ? "medium" : "small";
    changes.set("size", nextSize);
  } else if (/\b(?:feels |is |little |bit )?too small\b/i.test(lower)) {
    const nextSize = currentSize.includes("small") ? "medium" : "large";
    changes.set("size", nextSize);
  } else if (/\b(?:little |bit |slightly )?smaller\b|\bcompact\b|\bmini\b|\bsmall size\b|\bmake it small\b/i.test(lower)) {
    const nextSize = currentSize.includes("large") && /\bslightly|little|bit\b/i.test(lower) ? "medium" : "small";
    changes.set("size", nextSize);
  } else if (/\b(?:little |bit |slightly )?(?:larger|bigger)\b|\boversized\b|\blarge size\b|\bmake it large\b/i.test(lower)) {
    changes.set("size", "large");
  } else if (/\bmedium(?:\s+size)?\b/i.test(lower)) {
    changes.set("size", "medium");
  }

  // 4. Strap type & strap length
  const mentionsCrossbody = /\bcross[\s-]?body\b|\bacross the body\b/i.test(lower);
  const mentionsLongerStrap =
    /\bstrap\b.*\b(?:longer|extend|extended|lengthen)\b|\b(?:longer|extended|lengthen)\b.*\bstrap\b/i.test(
      lower,
    );
  const mentionsShorterStrap =
    /\bstrap\b.*\b(?:shorter|shorten)\b|\b(?:shorter|shorten)\b.*\bstrap\b/i.test(lower);

  if (mentionsCrossbody && mentionsLongerStrap) {
    changes.set("strapType", "crossbody");
    changes.set("strapLength", "longer adjustable crossbody drop");
  } else if (mentionsCrossbody) {
    changes.set("strapType", "crossbody");
    changes.set("strapLength", "longer adjustable crossbody drop");
  } else if (mentionsLongerStrap) {
    if (designState.strapType.toLowerCase() === "shoulder") {
      changes.set("strapType", "crossbody");
    }
    changes.set("strapLength", "longer adjustable crossbody drop");
  } else if (mentionsShorterStrap) {
    changes.set("strapLength", "short shoulder drop");
    if (designState.strapType.toLowerCase() === "crossbody") {
      changes.set("strapType", "shoulder");
    }
  } else if (/\btop handle\b/i.test(lower)) {
    changes.set("strapType", "top handle");
  } else if (/\bchain strap\b/i.test(lower)) {
    changes.set("strapType", "chain strap");
  } else if (/\bshoulder strap\b/i.test(lower)) {
    changes.set("strapType", "shoulder");
  }

  // 5. Primary leather color
  const colorMatches: Array<[RegExp, string]> = [
    [/\bespresso(?:\s+brown)?\b/i, "espresso brown"],
    [/\bdark brown\b|\bchocolate(?:\s+brown)?\b/i, "espresso brown"],
    [/\bburgundy\b|\bwine\b/i, "burgundy"],
    [/\boxblood\b/i, "oxblood"],
    [/\bivory\b/i, "ivory"],
    [/\bcream\b/i, "cream"],
    [/\bcamel\b/i, "camel"],
    [/\btan\b|\bcognac\b/i, "tan"],
    [/\bolive\b/i, "olive"],
    [/\bnavy\b|\bmidnight blue\b/i, "navy"],
    [/\bemerald\b|\bforest green\b/i, "emerald"],
    [/\bblack(?:\s+leather|\s+color|\s+bag)?\b/i, "black"],
  ];

  for (const [pattern, colorName] of colorMatches) {
    if (colorName === "black" && changes.get("hardwareColor") === "matte black") {
      continue;
    }
    if (pattern.test(lower)) {
      changes.set("primaryColor", colorName);
      break;
    }
  }

  if (
    !changes.has("primaryColor") &&
    /\b(?:slightly |little |bit )?darker(?:\s+leather|\s+shade|\s+color|\s+tone)?\b/i.test(lower)
  ) {
    const currentColor = designState.primaryColor.toLowerCase();
    if (
      currentColor.includes("burgundy") ||
      currentColor.includes("tan") ||
      currentColor.includes("camel") ||
      currentColor.includes("brown")
    ) {
      changes.set("primaryColor", "espresso brown");
    }
  }

  // 6. Material & texture
  if (/\bsuede\b/i.test(lower)) {
    changes.set("material", "suede");
  } else if (/\bpatent leather\b/i.test(lower)) {
    changes.set("material", "patent leather");
  }

  if (/\bpebbled\b/i.test(lower)) {
    changes.set("texture", "pebbled");
  } else if (/\bsmooth\b/i.test(lower)) {
    changes.set("texture", "smooth");
  } else if (/\bcroc(?:[\s-]embossed)?\b/i.test(lower)) {
    changes.set("texture", "croc-embossed");
  } else if (/\bquilted\b/i.test(lower)) {
    changes.set("texture", "quilted");
  } else if (/\bwoven\b|\bintrecciato\b/i.test(lower)) {
    changes.set("texture", "woven");
  }

  // 7. Silhouette
  if (/\beast[\s-]west(?:\s+baguette)?\b|\bbaguette\b/i.test(lower)) {
    changes.set("silhouette", "east-west baguette");
  } else if (/\bcrescent\b|\bhobo\b/i.test(lower)) {
    changes.set("silhouette", "crescent");
  } else if (/\btote\b/i.test(lower)) {
    changes.set("silhouette", "tote");
  } else if (/\bboxy\b/i.test(lower)) {
    changes.set("silhouette", "boxy");
  } else if (/\bslouched\b|\bslouchy\b/i.test(lower)) {
    changes.set("silhouette", "slouched");
    changes.set("structure", "soft slouched construction");
  } else if (/\brectangular\b/i.test(lower)) {
    changes.set("silhouette", "structured rectangular shoulder bag");
  } else if (/\bstructured\b/i.test(lower)) {
    changes.set("silhouette", "structured");
  }

  // 8. Closure
  if (/\btop zip(?:per)?\b|\bzip(?:per)? closure\b/i.test(lower)) {
    changes.set("closure", "top zipper");
  } else if (/\bmagnetic flap(?:\s+clasp)?\b/i.test(lower)) {
    changes.set("closure", "magnetic flap clasp");
  } else if (/\bturn[\s-]?lock\b/i.test(lower)) {
    changes.set("closure", "turnlock");
  } else if (/\bdrawstring\b/i.test(lower)) {
    changes.set("closure", "drawstring");
  }

  return [...changes.entries()].map(([field, proposedValue]) => ({
    field,
    proposedValue,
  }));
}

/**
 * Deterministic keyword & context extractor for Live Consultation utterances.
 */
export function extractConsultationCandidateDeterministic(
  utterance: string,
  designState: BagDesignState,
): CandidateConsultationExtraction {
  const trimmed = utterance.trim();
  if (!trimmed) {
    return {
      isRelevantFashionSpeech: false,
      speechKind: "small_talk_or_technical",
      confidence: 0.98,
      changes: [],
      summary: "Empty utterance.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 1. Retractions / cancellations take precedence ("actually never mind")
  if (RETRACTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      isRelevantFashionSpeech: false,
      speechKind: "cancel_or_nevermind",
      confidence: 0.94,
      changes: [],
      summary: "Speaker retracted or cancelled the modification.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 2. Extract concrete design modifications first so "wear it crossbody" is recognized as a modification
  const extractedChanges = extractModificationsFromText(trimmed, designState);

  // 3. Small talk & audio/technical checks (when no fashion changes were requested)
  if (
    extractedChanges.length === 0 &&
    SMALL_TALK_PATTERNS.some((pattern) => pattern.test(trimmed))
  ) {
    return {
      isRelevantFashionSpeech: false,
      speechKind: "small_talk_or_technical",
      confidence: 0.96,
      changes: [],
      summary: "Irrelevant small talk or meeting audio check.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 4. Virtual try-on request ("Can I see how that looks on me?")
  if (
    extractedChanges.length === 0 &&
    TRY_ON_PATTERNS.some((pattern) => pattern.test(trimmed))
  ) {
    return {
      isRelevantFashionSpeech: true,
      speechKind: "try_on_request",
      confidence: 0.95,
      changes: [],
      summary: "Customer asked to preview the current design on themselves.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 5. Revert to previous version ("I liked the previous version better", "Go back to V2")
  if (REVERT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    const versionMatch = trimmed.match(/\b(?:v|version)\s*(\d+)\b/i);
    const targetVersionNumber = versionMatch?.[1] ? Number(versionMatch[1]) : undefined;
    return {
      isRelevantFashionSpeech: true,
      speechKind: "revert_version",
      confidence: 0.93,
      changes: [],
      targetVersionNumber,
      summary: targetVersionNumber
        ? `Customer requested restoring V${targetVersionNumber}.`
        : "Customer requested returning to the previous design version.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 6. Finalize design ("This is the one, let's finalize it")
  if (FINALIZE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      isRelevantFashionSpeech: true,
      speechKind: "finalize_request",
      confidence: 0.93,
      changes: [],
      summary: "Customer and designer confirmed the design is finalized.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 7. Actionable design modification(s)
  if (extractedChanges.length > 0) {
    const summaryParts = extractedChanges.map(
      (change) => `${change.field} → ${change.proposedValue}`,
    );
    return {
      isRelevantFashionSpeech: true,
      speechKind: "design_modification",
      confidence: extractedChanges.length >= 2 ? 0.94 : 0.95,
      changes: extractedChanges,
      summary: `Proposed modification: ${summaryParts.join(", ")}.`,
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  // 8. Vague preference needing clarification
  if (VAGUE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      isRelevantFashionSpeech: true,
      speechKind: "vague_preference",
      confidence: 0.65,
      changes: [],
      clarificationQuestion:
        "Which detail would you like to adjust next — color, hardware, size, or strap?",
      summary: "Customer expressed a vague preference that requires clarification.",
      provider: "fallback",
      model: "deterministic-consultation-parser",
    };
  }

  return {
    isRelevantFashionSpeech: false,
    speechKind: "small_talk_or_technical",
    confidence: 0.9,
    changes: [],
    summary: "No actionable garment or accessory modification detected.",
    provider: "fallback",
    model: "deterministic-consultation-parser",
  };
}

interface RawGeminiConsultationExtraction {
  isRelevantFashionSpeech?: unknown;
  speechKind?: unknown;
  confidence?: unknown;
  changes?: unknown;
  summary?: unknown;
  targetVersionNumber?: unknown;
  clarificationQuestion?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

const ALLOWED_SPEECH_KINDS: readonly CandidateConsultationExtraction["speechKind"][] = [
  "design_modification",
  "try_on_request",
  "version_revert",
  "revert_version",
  "finalize_design",
  "finalize_request",
  "vague_preference",
  "small_talk",
  "small_talk_or_technical",
  "cancel_or_nevermind",
  "other",
];

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function buildGeminiConsultationPrompt(
  utterance: string,
  designState: BagDesignState,
  versions: DesignVersion[],
): string {
  const versionList =
    versions.map((v) => `V${v.version} (${v.label}): ${v.summary}`).join("\n") ||
    "V1 Original";

  return `CURRENT BAG DESIGN STATE
${JSON.stringify(designState, null, 2)}

VERSION HISTORY
${versionList}

SPOKEN MEETING UTTERANCE
"""${utterance}"""

Return ONLY a JSON object with this exact shape:
{
  "isRelevantFashionSpeech": true,
  "speechKind": "design_modification" | "try_on_request" | "revert_version" | "finalize_request" | "vague_preference" | "small_talk_or_technical" | "cancel_or_nevermind",
  "confidence": 0.95,
  "changes": [
    { "field": "hardwareColor", "proposedValue": "gold" }
  ],
  "summary": "Concise 1-sentence summary of the requested change",
  "targetVersionNumber": null,
  "clarificationQuestion": null
}

Allowed "field" values: ${DESIGN_FIELD_KEYS.join(", ")}`;
}

function normalizeGeminiExtraction(
  raw: RawGeminiConsultationExtraction,
  utterance: string,
  designState: BagDesignState,
): CandidateConsultationExtraction {
  const fallback = extractConsultationCandidateDeterministic(utterance, designState);

  const rawKind = typeof raw.speechKind === "string" ? raw.speechKind.trim() : "";
  const speechKind = ALLOWED_SPEECH_KINDS.includes(
    rawKind as CandidateConsultationExtraction["speechKind"],
  )
    ? (rawKind as CandidateConsultationExtraction["speechKind"])
    : fallback.speechKind;

  const isRelevantFashionSpeech =
    typeof raw.isRelevantFashionSpeech === "boolean"
      ? raw.isRelevantFashionSpeech
      : speechKind !== "small_talk" &&
        speechKind !== "small_talk_or_technical" &&
        speechKind !== "cancel_or_nevermind" &&
        speechKind !== "other";

  const confNum = typeof raw.confidence === "number" ? raw.confidence : Number(raw.confidence);
  const confidence = Number.isFinite(confNum)
    ? Math.min(1, Math.max(0, confNum))
    : fallback.confidence;

  const changes: Array<{ field: DesignFieldKey; proposedValue: string }> = [];
  if (Array.isArray(raw.changes)) {
    for (const item of raw.changes) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { field?: unknown; proposedValue?: unknown };
      const field = typeof rec.field === "string" ? rec.field.trim() : "";
      const proposedValue =
        typeof rec.proposedValue === "string" ? rec.proposedValue.trim() : "";
      if (
        DESIGN_FIELD_KEYS.includes(field as DesignFieldKey) &&
        proposedValue.length > 0
      ) {
        changes.push({ field: field as DesignFieldKey, proposedValue });
      }
    }
  }

  const targetVerRaw =
    typeof raw.targetVersionNumber === "number"
      ? raw.targetVersionNumber
      : Number(raw.targetVersionNumber);
  const targetVersionNumber =
    Number.isFinite(targetVerRaw) && targetVerRaw >= 1
      ? Math.round(targetVerRaw)
      : fallback.targetVersionNumber;

  const clarificationQuestion =
    typeof raw.clarificationQuestion === "string" &&
    raw.clarificationQuestion.trim().length > 0 &&
    raw.clarificationQuestion.trim().toLowerCase() !== "null"
      ? raw.clarificationQuestion.trim()
      : fallback.clarificationQuestion;

  const summary =
    typeof raw.summary === "string" && raw.summary.trim().length > 0
      ? raw.summary.trim()
      : fallback.summary;

  return {
    isRelevantFashionSpeech,
    speechKind,
    confidence,
    changes: changes.length > 0 ? changes : speechKind === "design_modification" ? fallback.changes : [],
    summary,
    targetVersionNumber,
    clarificationQuestion,
    provider: "gemini",
    model: env.geminiModel,
  };
}

export async function extractConsultationCandidateWithGemini(
  utterance: string,
  designState: BagDesignState,
  versions: DesignVersion[],
): Promise<{ extraction: CandidateConsultationExtraction; model: string }> {
  if (!env.geminiApiKey) {
    throw new ProviderError("gemini", 401, "GEMINI_API_KEY is not configured");
  }

  const response = await requestJson<GeminiGenerateContentResponse>(
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
        systemInstruction: { parts: [{ text: CONSULTATION_SYSTEM_INSTRUCTION }] },
        contents: [
          {
            role: "user",
            parts: [{ text: buildGeminiConsultationPrompt(utterance, designState, versions) }],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          topP: 0.9,
          responseMimeType: "application/json",
          maxOutputTokens: 700,
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

  const text = response.data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");
  if (!text || text.trim().length === 0) {
    throw new ProviderError("gemini", 502, "Gemini returned no content");
  }

  let parsed: RawGeminiConsultationExtraction;
  try {
    parsed = JSON.parse(stripCodeFence(text)) as RawGeminiConsultationExtraction;
  } catch {
    throw new ProviderError("gemini", 502, "Gemini returned invalid JSON");
  }

  return {
    extraction: normalizeGeminiExtraction(parsed, utterance, designState),
    model: env.geminiModel,
  };
}

export async function understandConsultationUtterance(
  utterance: string,
  designState: BagDesignState,
  versions: DesignVersion[],
): Promise<{
  extraction: CandidateConsultationExtraction;
  provider: "gemini" | "fallback";
  model: string;
  note: string;
}> {
  if (env.mockExternalApis) {
    const extraction = extractConsultationCandidateDeterministic(utterance, designState);
    return {
      extraction,
      provider: "fallback",
      model: "deterministic-consultation-parser",
      note: "Mock mode: consultation speech parsed deterministically.",
    };
  }

  if (!env.geminiApiKey) {
    const extraction = extractConsultationCandidateDeterministic(utterance, designState);
    return {
      extraction,
      provider: "fallback",
      model: "deterministic-consultation-parser",
      note: "GEMINI_API_KEY is not set: consultation speech parsed deterministically.",
    };
  }

  try {
    const { extraction, model } = await extractConsultationCandidateWithGemini(
      utterance,
      designState,
      versions,
    );
    return {
      extraction: { ...extraction, provider: "gemini", model },
      provider: "gemini",
      model,
      note: "",
    };
  } catch (error) {
    const extraction = extractConsultationCandidateDeterministic(utterance, designState);
    return {
      extraction,
      provider: "fallback",
      model: "deterministic-consultation-parser",
      note: `Gemini unavailable (${error instanceof Error ? error.message : "unknown error"}): parsed deterministically.`,
    };
  }
}

export const extractConsultationCandidate = understandConsultationUtterance;
