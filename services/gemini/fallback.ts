import type { AgentAction, CatalogCategory, IntentDelta, StyleTag } from "@/lib/types";
import type { SessionContext } from "@/services/gemini/client";

/**
 * Deterministic language fallback.
 *
 * The brief requires that a Gemini outage must not stop the demo. This is a real
 * keyword parser: it recognises the commands the demo actually uses and returns the
 * same `IntentDelta` contract, so the rest of the pipeline cannot tell the
 * difference except by the provenance the UI reports.
 *
 * It is intentionally shallow. Anything it cannot recognise is left unset rather
 * than guessed.
 */

interface Rule<T> {
  pattern: RegExp;
  value: T;
}

const FEEDBACK_RULES: Rule<NonNullable<IntentDelta["feedbackOnCurrent"]>>[] = [
  { pattern: /\b(too formal|demasiado formal|muy formal|too dressy)\b/i, value: "rejected" },
  { pattern: /\b(too casual|demasiado casual|too plain|too boring)\b/i, value: "rejected" },
  {
    pattern:
      /\b(i (?:don'?t|do not) like|don'?t like (?:this|it)|no me gusta|not (?:a fan|for me)|hate (?:this|it))\b/i,
    value: "rejected",
  },
  { pattern: /\b(closer|that'?s better|much better|mejor|m[aá]s cerca|getting there)\b/i, value: "closer" },
  { pattern: /\b(perfect|love (?:it|this)|i like (?:it|this)|keep (?:it|this)|me encanta|perfecto)\b/i, value: "liked" },
];

const ACTION_RULES: Rule<{ action: AgentAction; category?: CatalogCategory }>[] = [
  { pattern: /\b(jacket|coat|blazer|overshirt|outerwear|chaqueta|abrigo|saco)\b/i, value: { action: "ADD_OUTER", category: "outer" } },
  { pattern: /\b(sneakers?|trainers?|shoes?|boots?|loafers?|zapatillas?|zapatos?|botas?|calzado)\b/i, value: { action: "CHANGE_SHOES", category: "shoes" } },
  { pattern: /\b(pants?|trousers?|jeans|shorts|skirt|chinos|pantal[oó]n|pantalones|falda)\b/i, value: { action: "CHANGE_BOTTOM", category: "lower_body" } },
  { pattern: /\b(shirts?|t-?shirts?|top|blouse|sweater|knit|polo|camis[ao]|blusa|su[eé]ter)\b/i, value: { action: "CHANGE_TOP", category: "upper_body" } },
  { pattern: /\b(another outfit|new outfit|start over|from scratch|otro outfit|otro conjunto|empezar de nuevo)\b/i, value: { action: "CHANGE_FULL_OUTFIT" } },
  { pattern: /\b(alternative|something else|other options?|another option|otra opci[oó]n|alternativa|algo m[aá]s)\b/i, value: { action: "SHOW_ALTERNATIVE" } },
  { pattern: /\b(finish|i'?m done|that'?s all|checkout|listo|terminar|finalizar)\b/i, value: { action: "FINISH_LOOK" } },
];

const STYLE_RULES: Rule<{ want?: StyleTag[]; avoid?: StyleTag[] }>[] = [
  { pattern: /\b(less formal|more casual|relaxed|informal|m[aá]s casual|menos formal|relajado)\b/i, value: { want: ["casual", "smart_casual"], avoid: ["formal"] } },
  { pattern: /\b(more formal|dressy|elegant|elegante|m[aá]s formal|arreglado)\b/i, value: { want: ["evening", "smart_casual"] } },
  { pattern: /\b(streetwear|urbano|hype)\b/i, value: { want: ["streetwear"] } },
  { pattern: /\b(minimal(?:ist)?|minimalista|clean lines|sencillo)\b/i, value: { want: ["minimal"] } },
  { pattern: /\b(business|office|work|profesional|trabajo|oficina)\b/i, value: { want: ["business", "smart_casual"] } },
  { pattern: /\b(sport|gym|athleisure|deporte|running)\b/i, value: { want: ["sport"] } },
  { pattern: /\b(evening|night out|fiesta|noche)\b/i, value: { want: ["evening"] } },
];

const COLOR_RULES: Rule<{ want?: string[]; avoid?: string[] }>[] = [
  { pattern: /\b(darker|black|negro|oscuro)\b/i, value: { want: ["black"] } },
  { pattern: /\b(lighter|white|blanco|claro)\b/i, value: { want: ["white", "cream"] } },
  { pattern: /\b(navy|azul marino)\b/i, value: { want: ["navy"] } },
  { pattern: /\b(beige|cream|crema)\b/i, value: { want: ["cream"] } },
  {
    pattern: /\b(?:no|not|don'?t like|avoid|sin|nada de)\s+(beige|cream|white|black|navy|olive|khaki|indigo|brown|grey|gray)\b/i,
    value: { avoid: [] },
  },
];

const SPANISH_HINTS =
  /\b(el|la|los|las|un|una|que|para|con|sin|muy|pero|esta|este|quiero|necesito|hola|gracias|c[oó]mo|d[oó]nde|noche|cena|trabajo|playa|boda|fiesta)\b|[áéíóúñ¿¡]/i;

/** Free-text occasion hints. Mirrors the catalog's occasion tags in plain code. */
const OCCASION_HINTS: [RegExp, string][] = [
  [/\b(dinner|supper|rooftop|restaurant|brunch|lunch|cena)\b/i, "dinner"],
  [/\b(date|romantic|anniversary|valentine)\b/i, "date"],
  [/\b(wedding|gala|black tie|ceremony|reception|boda)\b/i, "wedding"],
  [/\b(office|work|meeting|interview|client|presentation|trabajo|oficina)\b/i, "work"],
  [/\b(party|club|birthday|celebration|festival|concert|fiesta)\b/i, "party"],
  [/\b(vacation|holiday|beach|resort|island|getaway|playa|vacaciones)\b/i, "vacation"],
  [/\b(travel|airport|flight|train|road trip|viaje)\b/i, "travel"],
  [/\b(event|opening|launch|conference|networking)\b/i, "event"],
  [/\b(everyday|daily|errands|weekend|coffee)\b/i, "everyday"],
];

function extractOccasion(message: string): string | undefined {
  for (const [pattern, occasion] of OCCASION_HINTS) {
    if (pattern.test(message)) return occasion;
  }
  return undefined;
}

function looksSpanish(text: string): boolean {
  return SPANISH_HINTS.test(text);
}

function firstMatch<T>(text: string, rules: Rule<T>[]): T | undefined {
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.value;
  }
  return undefined;
}

function extractBudget(text: string): number | undefined {
  const match =
    text.match(/(?:under|below|max|up to|menos de|hasta|m[aá]ximo de)\s*\$?\s*(\d{2,5})/i) ??
    text.match(/\$\s*(\d{2,5})/);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Explicit colour avoidance needs the captured colour, so it is handled separately. */
function avoidColor(text: string): string | undefined {
  const match = text.match(
    /\b(?:no|not|don'?t like|avoid|sin|nada de)\s+(beige|cream|white|black|navy|olive|khaki|indigo|brown|grey|gray)\b/i,
  );
  const color = match?.[1];
  if (!color) return undefined;
  return color === "gray" ? "grey" : color.toLowerCase();
}

export function parseIntentDeterministic(message: string, context: SessionContext): IntentDelta {
  const spanish = looksSpanish(message);
  // "not too formal" is a preference, not a rejection. Guard before the feedback rules
  // so the demo's opening line is never misread as the shopper disliking something.
  const negatedFormal = /\b(not|isn'?t|no|sin)\s+(too\s+|tan\s+)?formal\b/i.test(message);
  let feedback = firstMatch(message, FEEDBACK_RULES);
  if (negatedFormal && feedback === "rejected" && !/too (casual|plain|boring)/i.test(message)) {
    feedback = undefined;
  }
  const action = firstMatch(message, ACTION_RULES);
  const style = firstMatch(message, STYLE_RULES);
  const color = firstMatch(message, COLOR_RULES);
  const budget = extractBudget(message);
  const avoidedColor = avoidColor(message);

  const desiredStyles: StyleTag[] = [...(style?.want ?? [])];
  const avoidedStyles: StyleTag[] = [...(style?.avoid ?? [])];

  // "Too formal" is a style instruction as well as a rejection: the next proposal
  // must actually move away from the thing the shopper disliked.
  if (/\b(too formal|demasiado formal|muy formal|too dressy)\b/i.test(message) && !negatedFormal) {
    avoidedStyles.push("formal", "business");
    desiredStyles.push("casual", "smart_casual");
  }
  if (negatedFormal) {
    desiredStyles.push("smart_casual", "evening");
    avoidedStyles.push("formal", "business");
  }
  if (/\b(too casual|demasiado casual)\b/i.test(message)) {
    avoidedStyles.push("casual", "sport");
    desiredStyles.push("smart_casual");
  }

  const interpreted: string[] = [];
  const occasion = context.occasion ?? extractOccasion(message);
  if (occasion) interpreted.push(occasion);
  if (feedback) {
    interpreted.push(
      spanish
        ? { rejected: "Rechaza el look actual", liked: "Le gusta el look", closer: "Va por buen camino" }[feedback]
        : { rejected: "Rejects current look", liked: "Likes current look", closer: "Closer" }[feedback],
    );
  }
  if (action) interpreted.push(action.action.replace(/_/g, " ").toLowerCase());
  for (const style of desiredStyles.slice(0, 2)) interpreted.push(style.replace(/_/g, " "));
  if (avoidedColor) interpreted.push(spanish ? `Sin ${avoidedColor}` : `No ${avoidedColor}`);

  const assistantReply = buildReply({ spanish, feedback, action, desiredStyles, avoidedStyles, avoidedColor });

  return {
    occasion,
    desiredStyles: [...new Set(desiredStyles)],
    avoidedStyles: [...new Set(avoidedStyles)],
    preferredColors: color?.want ?? [],
    avoidedColors: avoidedColor ? [avoidedColor] : [],
    budget,
    requestedAction: action?.action,
    feedbackOnCurrent: feedback,
    targetCategory: action?.category,
    assistantReply,
    interpreted: interpreted.slice(0, 4),
  };
}

function buildReply(input: {
  spanish: boolean;
  feedback?: IntentDelta["feedbackOnCurrent"];
  action?: { action: AgentAction };
  desiredStyles: StyleTag[];
  avoidedStyles: StyleTag[];
  avoidedColor?: string;
}): string {
  const { spanish, feedback, action, avoidedStyles, avoidedColor } = input;

  if (avoidedColor) {
    return spanish
      ? `Entendido, descarto el ${avoidedColor} y busco otra opción.`
      : `Understood, I'll avoid ${avoidedColor} and look for something else.`;
  }
  if (feedback === "rejected") {
    return spanish
      ? "Entendido, ajusto el look en esa dirección y te propongo otra cosa."
      : "Got it, I'll adjust the look in that direction and propose something else.";
  }
  if (feedback === "closer") {
    return spanish
      ? "Voy por buen camino entonces: refino desde aquí."
      : "Good, I'll refine from here.";
  }
  if (feedback === "liked") {
    return spanish
      ? "Me alegra. Mantengo esta línea y sigo construyendo."
      : "Glad you like it. I'll keep this direction and keep building.";
  }
  if (action) {
    return spanish
      ? `Voy a trabajar en ${action.action.replace(/_/g, " ").toLowerCase()}.`
      : `I'll work on ${action.action.replace(/_/g, " ").toLowerCase()}.`;
  }
  if (avoidedStyles.length > 0) {
    return spanish
      ? "Anotado. Ajusto la dirección y busco una alternativa."
      : "Noted. I'll adjust the direction and find an alternative.";
  }
  return spanish
    ? "Voy a revisar el catálogo con eso en mente."
    : "Let me look through the catalog with that in mind.";
}
