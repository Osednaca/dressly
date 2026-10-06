import { CATALOG } from "@/lib/catalog/products";
import { lookItems, lookTotal } from "@/lib/catalog/query";
import type {
  ChatMessage,
  CurrentLook,
  DecisionRecord,
  IntentDelta,
  Look,
  LookFeedback,
  Product,
  SessionMetrics,
  SessionStatus,
  StylingSession,
} from "@/lib/types";
import { newId, nowIso } from "@/lib/util/id";

/**
 * Deterministic session transitions.
 *
 * Every function here is pure: same state in, same state out. The orchestrator owns
 * ordering and persistence; this module owns *what a change means*. Keeping the two
 * apart is what makes the agent's behavior reproducible and testable.
 */

export function emptyLook(): CurrentLook {
  return { accessories: [] };
}

export function emptyMetrics(): SessionMetrics {
  return {
    looksGenerated: 0,
    productsTried: 0,
    productsRejected: 0,
    productsLiked: 0,
    agentIterations: 0,
    compatibleProducts: CATALOG.length,
    cartTotal: 0,
    completed: false,
  };
}

export function createSessionRecord(id: string, userPhotoPath: string | null): StylingSession {
  return {
    id,
    createdAt: nowIso(),
    userPhotoPath,
    targetStyles: [],
    preferredColors: [],
    avoidedStyles: [],
    avoidedColors: [],
    currentLook: emptyLook(),
    triedProducts: [],
    rejectedProducts: [],
    likedProducts: [],
    looks: [],
    activeLookId: null,
    decisions: [],
    messages: [],
    metrics: emptyMetrics(),
    conversationSummary: "",
    status: "DISCOVERY",
  };
}

function union<T>(base: readonly T[], add: readonly T[]): T[] {
  return [...new Set([...base, ...add])];
}

function without<T>(base: readonly T[], remove: readonly T[]): T[] {
  return base.filter((value) => !remove.includes(value));
}

/**
 * Fold a language-layer intent into session state.
 *
 * This is the single place where conversation becomes memory. Rejections and likes
 * are applied here too, because "I don't like this" is a state change, not a reply.
 */
export function applyIntent(session: StylingSession, intent: IntentDelta): StylingSession {
  const next: StylingSession = { ...session };

  if (intent.occasion) next.occasion = intent.occasion;

  // Styles are additive: a later message refines the brief, it does not erase it.
  const avoidedStyles = union(next.avoidedStyles, intent.avoidedStyles);
  const targetStyles = without(union(next.targetStyles, intent.desiredStyles), avoidedStyles);
  next.avoidedStyles = avoidedStyles;
  next.targetStyles = targetStyles;

  const avoidedColors = union(next.avoidedColors, intent.avoidedColors);
  next.avoidedColors = avoidedColors;
  next.preferredColors = without(union(next.preferredColors, intent.preferredColors), avoidedColors);

  if (intent.budget !== undefined) next.budget = intent.budget;

  if (intent.feedbackOnCurrent === "rejected") {
    const active = next.looks.find((look) => look.id === next.activeLookId);
    const rejectedId = active?.addedProductId ?? null;

    // Drop the garment the user just rejected from the body, wherever it sits.
    next.currentLook = removeProduct(next.currentLook, rejectedId);
    next.looks = next.looks.map((look) =>
      look.id === next.activeLookId ? { ...look, feedback: "rejected" as LookFeedback } : look,
    );
    // Restart the chained try-on from the image *before* the rejected garment, so the
    // next result never bakes in the piece the shopper just dismissed.
    next.activeLookId = active?.previousImagePath
      ? (next.looks.find((look) => look.imagePath === active.previousImagePath)?.id ?? null)
      : null;
    if (rejectedId) {
      next.rejectedProducts = union(next.rejectedProducts, [rejectedId]);
      next.likedProducts = without(next.likedProducts, [rejectedId]);
    }
    next.status = "REFINING";
  }

  if (intent.feedbackOnCurrent === "liked" || intent.feedbackOnCurrent === "closer") {
    const active = next.looks.find((look) => look.id === next.activeLookId);
    const likedId = active?.addedProductId ?? null;
    next.looks = next.looks.map((look) =>
      look.id === next.activeLookId ? { ...look, feedback: "liked" as LookFeedback } : look,
    );
    if (likedId) {
      next.likedProducts = union(next.likedProducts, [likedId]);
      next.rejectedProducts = without(next.rejectedProducts, [likedId]);
    }
    next.status = intent.feedbackOnCurrent === "closer" ? "REFINING" : "STYLING";
  }

  return recompute(next);
}

function removeProduct(look: CurrentLook, productId: string | null): CurrentLook {
  if (!productId) return look;
  const next: CurrentLook = { ...look };
  if (next.top?.id === productId) delete next.top;
  if (next.bottom?.id === productId) delete next.bottom;
  if (next.outer?.id === productId) delete next.outer;
  if (next.shoes?.id === productId) delete next.shoes;
  next.accessories = next.accessories.filter((item) => item.id !== productId);
  return next;
}

/** Put a garment into its slot in a plain look object. Shared by placement and snapshots. */
export function placeInLook(look: CurrentLook, product: Product): CurrentLook {
  const currentLook: CurrentLook = { ...look, accessories: [...look.accessories] };
  switch (product.category) {
    case "upper_body":
      currentLook.top = product;
      break;
    case "lower_body":
      currentLook.bottom = product;
      break;
    case "outer":
      currentLook.outer = product;
      break;
    case "shoes":
      currentLook.shoes = product;
      break;
    case "accessory":
      currentLook.accessories = [
        ...currentLook.accessories.filter((item) => item.subcategory !== product.subcategory),
        product,
      ];
      break;
  }
  return currentLook;
}

/** Place a garment into its slot. Replaces whatever occupied that slot before. */
export function placeProduct(session: StylingSession, product: Product): StylingSession {
  return recompute({
    ...session,
    currentLook: placeInLook(session.currentLook, product),
    triedProducts: union(session.triedProducts, [product.id]),
  });
}

/** Remove a slot's garment. Used by CHANGE_* when the user asked for a swap. */
export function clearSlot(session: StylingSession, category: Product["category"]): StylingSession {
  const currentLook: CurrentLook = { ...session.currentLook };
  switch (category) {
    case "upper_body":
      delete currentLook.top;
      break;
    case "lower_body":
      delete currentLook.bottom;
      break;
    case "outer":
      delete currentLook.outer;
      break;
    case "shoes":
      delete currentLook.shoes;
      break;
    case "accessory":
      currentLook.accessories = [];
      break;
  }
  return recompute({ ...session, currentLook });
}

export function recordLook(
  session: StylingSession,
  look: Omit<Look, "index" | "createdAt">,
): StylingSession {
  const full: Look = {
    ...look,
    index: session.looks.length + 1,
    createdAt: nowIso(),
  };
  return recompute({
    ...session,
    looks: [...session.looks, full],
    activeLookId: full.id,
    metrics: { ...session.metrics, looksGenerated: session.metrics.looksGenerated + 1 },
  });
}

export function setLookFeedback(
  session: StylingSession,
  lookId: string,
  feedback: LookFeedback,
): StylingSession {
  const look = session.looks.find((item) => item.id === lookId);
  if (!look) return session;
  const next = recompute({
    ...session,
    looks: session.looks.map((item) => (item.id === lookId ? { ...item, feedback } : item)),
  });
  if (!look.addedProductId) return next;
  if (feedback === "rejected") {
    return recompute({
      ...next,
      rejectedProducts: union(next.rejectedProducts, [look.addedProductId]),
      likedProducts: without(next.likedProducts, [look.addedProductId]),
    });
  }
  if (feedback === "liked") {
    return recompute({
      ...next,
      likedProducts: union(next.likedProducts, [look.addedProductId]),
      rejectedProducts: without(next.rejectedProducts, [look.addedProductId]),
    });
  }
  return next;
}

/**
 * Reopen a previous look. The garment snapshot is restored onto the body so the
 * session can continue from there — history is navigation, not just a gallery.
 */
export function restoreLook(session: StylingSession, lookId: string): StylingSession {
  const look = session.looks.find((item) => item.id === lookId);
  if (!look) return session;
  return recompute({
    ...session,
    currentLook: structuredClone(look.items),
    activeLookId: look.id,
  });
}

export function pushMessage(
  session: StylingSession,
  role: ChatMessage["role"],
  text: string,
): StylingSession {
  const message: ChatMessage = { id: newId("msg"), role, text, createdAt: nowIso() };
  return { ...session, messages: [...session.messages, message] };
}

export function markCompleted(session: StylingSession): StylingSession {
  return recompute({ ...session, status: "COMPLETED" });
}

/** Append one agent iteration to the decisions log the panel renders. */
export function recordDecision(session: StylingSession, decision: DecisionRecord): StylingSession {
  return recompute({
    ...session,
    decisions: [...session.decisions, decision],
    metrics: { ...session.metrics, agentIterations: session.metrics.agentIterations + 1 },
  });
}

/** Attach a generated animation to a look, once Runway returns it. */
export function setLookVideo(
  session: StylingSession,
  lookId: string,
  videoPath: string | null,
): StylingSession {
  return {
    ...session,
    looks: session.looks.map((look) => (look.id === lookId ? { ...look, videoPath } : look)),
  };
}

/** Drop every rejected id so the shopper can reconsider garments they dismissed. */
export function clearRejections(session: StylingSession): StylingSession {
  return recompute({ ...session, rejectedProducts: [] });
}

/** Recompute the derived fields that must never drift from the real state. */
export function recompute(session: StylingSession): StylingSession {
  const worn = lookItems(session.currentLook);
  const metrics: SessionMetrics = {
    ...session.metrics,
    productsTried: session.triedProducts.length,
    productsRejected: session.rejectedProducts.length,
    productsLiked: session.likedProducts.length,
    cartTotal: lookTotal(session.currentLook),
    compatibleProducts: CATALOG.length - session.rejectedProducts.length,
    completed: session.status === "COMPLETED",
  };

  let status: SessionStatus = session.status;
  if (status !== "COMPLETED") {
    if (session.looks.length === 0 && worn.length === 0) status = "DISCOVERY";
    else if (session.rejectedProducts.length > 0 || session.likedProducts.length > 0)
      status = "REFINING";
    else status = "STYLING";
  }

  return { ...session, metrics, status };
}

/** Human-readable one-liner for the conversation summary shown in the panel. */
export function summarize(session: StylingSession): string {
  const parts: string[] = [];
  if (session.occasion) parts.push(`Occasion: ${session.occasion}`);
  if (session.targetStyles.length > 0) parts.push(`Styles: ${session.targetStyles.join(", ")}`);
  if (session.avoidedStyles.length > 0) parts.push(`Avoiding: ${session.avoidedStyles.join(", ")}`);
  if (session.preferredColors.length > 0) parts.push(`Colors: ${session.preferredColors.join(", ")}`);
  if (session.avoidedColors.length > 0) parts.push(`No: ${session.avoidedColors.join(", ")}`);
  if (session.budget !== undefined) parts.push(`Budget: $${session.budget}`);
  const worn = lookItems(session.currentLook);
  if (worn.length > 0) parts.push(`Wearing: ${worn.map((item) => item.name).join(", ")}`);
  return parts.join(" | ");
}
