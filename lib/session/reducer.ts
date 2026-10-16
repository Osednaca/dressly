import { CATALOG } from "@/lib/catalog/products";
import { lookItems, lookTotal } from "@/lib/catalog/query";
import {
  DEFAULT_BAG_DESIGN_STATE,
  DESIGN_FIELD_LABELS,
  type BagDesignState,
  type ChatMessage,
  type ConsultationActivityEntry,
  type ConsultationStatus,
  type CurrentLook,
  type DecisionRecord,
  type DesignFieldDiff,
  type DesignVersion,
  type IntentDelta,
  type LiveConsultationSession,
  type Look,
  type LookFeedback,
  type MeetingBotStatus,
  type Product,
  type ProposedDesignChange,
  type SessionMetrics,
  type SessionStatus,
  type StylingSession,
  type TranscriptSegment,
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
    consultation: null,
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

/**
 * Live Design Consultation pure state reducers.
 */

export function buildCustomBagProduct(version: DesignVersion): Product {
  const state = version.designState;
  return {
    id: `custom_bag_${version.id}`,
    name: `${state.name} (V${version.version})`,
    brand: "Atelier Dressly Bespoke",
    category: "accessory",
    subcategory: "bag",
    styles: ["minimal", "evening", "smart_casual"],
    occasions: ["dinner", "date", "work", "event"],
    colors: [state.primaryColor.toLowerCase()],
    price: 295,
    currency: "USD",
    image: version.imageUrl,
    vtoCategory: null,
    formality: 0.72,
    warmth: 0.1,
    description: `${state.size} ${state.primaryColor} ${state.material} ${state.silhouette} with ${state.hardwareColor} hardware and ${state.strapType} strap.`,
  };
}

export function initConsultation(
  session: StylingSession,
  options: {
    id?: string;
    meetingUrl: string;
    consentConfirmed: boolean;
    initialDesignState?: Partial<BagDesignState>;
    initialImageUrl?: string;
    autoApply?: boolean;
    autoApplyThreshold?: number;
    autoTryOn?: boolean;
  },
): StylingSession {
  const startedAt = nowIso();
  const designState: BagDesignState = structuredClone({
    ...DEFAULT_BAG_DESIGN_STATE,
    ...options.initialDesignState,
    category: "bag",
  });
  const v1Id = newId("ver");
  const v1: DesignVersion = {
    id: v1Id,
    version: 1,
    label: "V1 Original",
    summary: `Initial ${designState.size} ${designState.primaryColor} ${designState.silhouette} with ${designState.hardwareColor} hardware`,
    imageUrl: options.initialImageUrl ?? "/catalog/consultation-bag-v1.png",
    tryOnLookId: null,
    designState: structuredClone(designState),
    createdAt: startedAt,
  };

  const consultation: LiveConsultationSession = {
    id: options.id ?? newId("con"),
    meetingUrl: options.meetingUrl.trim(),
    consentConfirmed: options.consentConfirmed,
    status: "STARTING",
    botStatus: "STARTING",
    botError: null,
    designState,
    originalVersionId: v1.id,
    currentDesignVersionId: v1.id,
    activeViewMode: "design",
    versions: [v1],
    pendingSuggestions: [],
    approvedSuggestions: [],
    ignoredSuggestions: [],
    transcript: [],
    activity: [
      {
        id: newId("act"),
        timestamp: startedAt,
        kind: "session",
        text: "Consultation started",
      },
    ],
    autoApply: options.autoApply ?? false,
    autoApplyThreshold: options.autoApplyThreshold ?? 0.9,
    autoTryOn: options.autoTryOn ?? false,
    startedAt,
  };

  const bagProduct = buildCustomBagProduct(v1);
  return recompute({
    ...session,
    currentLook: placeInLook(session.currentLook, bagProduct),
    consultation,
  });
}

export function updateConsultationSettings(
  session: StylingSession,
  patch: {
    autoApply?: boolean;
    autoTryOn?: boolean;
    activeViewMode?: "design" | "tryon";
    meetingUrl?: string;
  },
): StylingSession {
  if (!session.consultation) return session;
  return {
    ...session,
    consultation: {
      ...session.consultation,
      autoApply: patch.autoApply ?? session.consultation.autoApply,
      autoTryOn: patch.autoTryOn ?? session.consultation.autoTryOn,
      activeViewMode: patch.activeViewMode ?? session.consultation.activeViewMode,
      meetingUrl: patch.meetingUrl !== undefined ? patch.meetingUrl.trim() : session.consultation.meetingUrl,
    },
  };
}

export function setConsultationStatus(
  session: StylingSession,
  status: ConsultationStatus,
  activityText?: string,
): StylingSession {
  if (!session.consultation) return session;
  const activity = activityText
    ? [
        ...session.consultation.activity,
        {
          id: newId("act"),
          timestamp: nowIso(),
          kind: (status === "FAILED" ? "error" : "session") as ConsultationActivityEntry["kind"],
          text: activityText,
        },
      ]
    : session.consultation.activity;
  return {
    ...session,
    consultation: {
      ...session.consultation,
      status,
      activity,
    },
  };
}

export function setConsultationBotStatus(
  session: StylingSession,
  botStatus: MeetingBotStatus,
  options?: { error?: string | null; activityText?: string },
): StylingSession {
  if (!session.consultation) return session;
  const current = session.consultation;
  let status: ConsultationStatus = current.status;

  if (current.status !== "ENDED") {
    switch (botStatus) {
      case "STARTING":
      case "OPENING_MEET":
        status = "STARTING";
        break;
      case "WAITING_FOR_ADMISSION":
        status = "WAITING_FOR_ADMISSION";
        break;
      case "JOINED":
      case "LISTENING":
        if (current.status !== "GENERATING_DESIGN" && current.status !== "GENERATING_TRYON") {
          status = "LIVE";
        }
        break;
      case "RECONNECTING":
        status = "RECONNECTING";
        break;
      case "FAILED":
        if (
          current.status === "STARTING" ||
          current.status === "WAITING_FOR_ADMISSION" ||
          current.status === "RECONNECTING"
        ) {
          status = "LIVE";
        }
        break;
      case "IDLE":
      case "STOPPED":
        break;
    }
  }

  const botError =
    options?.error !== undefined
      ? options.error
      : botStatus === "FAILED"
        ? (current.botError ?? "Meeting bot disconnected")
        : botStatus === "JOINED" || botStatus === "LISTENING"
          ? null
          : current.botError;

  const activity = options?.activityText
    ? [
        ...current.activity,
        {
          id: newId("act"),
          timestamp: nowIso(),
          kind: (botStatus === "FAILED" ? "error" : "bot") as ConsultationActivityEntry["kind"],
          text: options.activityText,
        },
      ]
    : current.activity;

  return {
    ...session,
    consultation: {
      ...current,
      status,
      botStatus,
      botError,
      activity,
    },
  };
}

export const setMeetingBotStatus = setConsultationBotStatus;

export function appendConsultationActivity(
  session: StylingSession,
  kind: ConsultationActivityEntry["kind"],
  text: string,
): StylingSession {
  if (!session.consultation) return session;
  const entry: ConsultationActivityEntry = {
    id: newId("act"),
    timestamp: nowIso(),
    kind,
    text,
  };
  return {
    ...session,
    consultation: {
      ...session.consultation,
      activity: [...session.consultation.activity, entry],
    },
  };
}

export function appendTranscriptSegment(
  session: StylingSession,
  segment: { id?: string; text: string; isFinal: boolean; timestamp?: string },
): StylingSession {
  if (!session.consultation) return session;
  const trimmed = segment.text.trim();
  if (!trimmed) return session;

  const transcript = [...session.consultation.transcript];
  const timestamp = segment.timestamp ?? nowIso();

  let targetIdx = -1;
  if (segment.id) {
    targetIdx = transcript.findIndex((item) => item.id === segment.id);
  }
  if (targetIdx === -1 && transcript.length > 0) {
    const lastIdx = transcript.length - 1;
    const last = transcript[lastIdx]!;
    if (!last.isFinal && (!segment.id || last.id === segment.id)) {
      targetIdx = lastIdx;
    }
  }

  if (targetIdx !== -1) {
    const existing = transcript[targetIdx]!;
    transcript[targetIdx] = {
      id: segment.id ?? existing.id,
      speaker: "MEETING",
      text: trimmed,
      isFinal: segment.isFinal,
      timestamp: segment.timestamp ?? existing.timestamp,
    };
  } else {
    const entry: TranscriptSegment = {
      id: segment.id ?? newId("tr"),
      speaker: "MEETING",
      text: trimmed,
      isFinal: segment.isFinal,
      timestamp,
    };
    transcript.push(entry);
  }

  return {
    ...session,
    consultation: {
      ...session.consultation,
      transcript,
    },
  };
}

export function applyChangesToBagState(
  state: BagDesignState,
  changes: DesignFieldDiff[],
): BagDesignState {
  const next = structuredClone(state);
  for (const diff of changes) {
    const value = diff.proposedValue.trim();
    if (!value) continue;
    next[diff.field] = value;
  }
  return next;
}

export const applyApprovedChangesToState = applyChangesToBagState;

export function computeChangeFingerprint(
  changes: Pick<DesignFieldDiff, "field" | "proposedValue">[],
): string {
  const byField = new Map<string, string>();
  for (const change of changes) {
    const normalizedVal = change.proposedValue
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    byField.set(change.field, normalizedVal);
  }
  return [...byField.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, val]) => `${field}:${val}`)
    .join("|");
}

export function addProposedSuggestion(
  session: StylingSession,
  suggestion: Omit<ProposedDesignChange, "status" | "fingerprint" | "timestamp"> & {
    timestamp?: string;
    fingerprint?: string;
    status?: ProposedDesignChange["status"];
  },
): StylingSession {
  if (!session.consultation) return session;
  const fingerprint =
    suggestion.fingerprint ?? computeChangeFingerprint(suggestion.changes);

  const duplicatePending = session.consultation.pendingSuggestions.some(
    (item) => item.id === suggestion.id || (fingerprint.length > 0 && item.fingerprint === fingerprint),
  );
  if (duplicatePending) return session;

  const timestamp = suggestion.timestamp ?? nowIso();
  const record: ProposedDesignChange = {
    ...suggestion,
    fingerprint,
    status: suggestion.status ?? "PENDING",
    timestamp,
  };

  const diffSummary = record.changes
    .map((c) => `${c.label}: ${c.previousValue ?? "—"} → ${c.proposedValue}`)
    .join(", ");

  const activityEntry: ConsultationActivityEntry = {
    id: newId("act"),
    timestamp,
    kind: "suggestion",
    text: diffSummary ? `Detected suggestion (${diffSummary})` : "Detected design suggestion",
  };

  return {
    ...session,
    consultation: {
      ...session.consultation,
      pendingSuggestions: [...session.consultation.pendingSuggestions, record],
      activity: [...session.consultation.activity, activityEntry],
    },
  };
}

export function actOnProposedSuggestion(
  session: StylingSession,
  suggestionId: string,
  action: "apply" | "edit" | "ignore",
  editedChanges?: DesignFieldDiff[],
): {
  session: StylingSession;
  suggestion: ProposedDesignChange | null;
  appliedChanges: DesignFieldDiff[];
} {
  if (!session.consultation) {
    return { session, suggestion: null, appliedChanges: [] };
  }

  const current = session.consultation;
  const target = current.pendingSuggestions.find((item) => item.id === suggestionId);
  if (!target) {
    return { session, suggestion: null, appliedChanges: [] };
  }

  const remainingPending = current.pendingSuggestions.filter(
    (item) => item.id !== suggestionId,
  );
  const timestamp = nowIso();

  if (action === "ignore") {
    const ignored: ProposedDesignChange = {
      ...target,
      status: "IGNORED",
    };
    const nextSession: StylingSession = {
      ...session,
      consultation: {
        ...current,
        pendingSuggestions: remainingPending,
        ignoredSuggestions: [...current.ignoredSuggestions, ignored],
        activity: [
          ...current.activity,
          {
            id: newId("act"),
            timestamp,
            kind: "approval",
            text: "Suggestion ignored",
          },
        ],
      },
    };
    return { session: nextSession, suggestion: ignored, appliedChanges: [] };
  }

  const hasEdits = Boolean(editedChanges && editedChanges.length > 0);
  const rawChanges = hasEdits ? editedChanges! : target.changes;
  const effectiveChanges: DesignFieldDiff[] = rawChanges.map((diff) => ({
    field: diff.field,
    label: diff.label || DESIGN_FIELD_LABELS[diff.field],
    previousValue: diff.previousValue ?? current.designState[diff.field],
    proposedValue: diff.proposedValue.trim(),
  }));

  const status: ProposedDesignChange["status"] =
    action === "edit" || hasEdits ? "EDITED" : "APPROVED";

  const approved: ProposedDesignChange = {
    ...target,
    changes: effectiveChanges,
    fingerprint: computeChangeFingerprint(effectiveChanges),
    status,
  };

  const nextDesignState = applyChangesToBagState(current.designState, effectiveChanges);
  const changeDesc = effectiveChanges
    .map((c) => `${c.label.toLowerCase()} → ${c.proposedValue}`)
    .join(", ");

  const nextSession: StylingSession = {
    ...session,
    consultation: {
      ...current,
      designState: nextDesignState,
      pendingSuggestions: remainingPending,
      approvedSuggestions: [...current.approvedSuggestions, approved],
      activity: [
        ...current.activity,
        {
          id: newId("act"),
          timestamp,
          kind: "approval",
          text:
            status === "EDITED"
              ? `Edited & approved change (${changeDesc})`
              : `Approved change (${changeDesc})`,
        },
      ],
    },
  };

  return {
    session: nextSession,
    suggestion: approved,
    appliedChanges: effectiveChanges,
  };
}

export function recordDesignVersion(
  session: StylingSession,
  params: {
    id?: string;
    imageUrl: string;
    label?: string;
    summary?: string;
    sourceSuggestionId?: string;
    promptUsed?: string;
    designState?: BagDesignState;
  },
): { session: StylingSession; version: DesignVersion } {
  const current = session.consultation;
  const nextNumber = (current?.versions.length ?? 0) + 1;
  const state = structuredClone(
    params.designState ?? current?.designState ?? DEFAULT_BAG_DESIGN_STATE,
  );

  const rawLabel = params.label?.trim();
  const label = rawLabel
    ? rawLabel.startsWith(`V${nextNumber}`)
      ? rawLabel
      : `V${nextNumber} ${rawLabel}`
    : `V${nextNumber} Revision`;
  const summary = params.summary?.trim() || label;
  const createdAt = nowIso();

  const version: DesignVersion = {
    id: params.id ?? newId("ver"),
    version: nextNumber,
    label,
    summary,
    imageUrl: params.imageUrl,
    tryOnLookId: null,
    designState: state,
    sourceSuggestionId: params.sourceSuggestionId,
    promptUsed: params.promptUsed,
    createdAt,
  };

  const bagProduct = buildCustomBagProduct(version);
  const updatedLook = placeInLook(session.currentLook, bagProduct);

  if (!current) {
    return {
      session: recompute({
        ...session,
        currentLook: updatedLook,
      }),
      version,
    };
  }

  const nextStatus: ConsultationStatus =
    current.status === "GENERATING_DESIGN" ? "LIVE" : current.status;

  const nextSession = recompute({
    ...session,
    currentLook: updatedLook,
    consultation: {
      ...current,
      status: nextStatus,
      designState: structuredClone(state),
      currentDesignVersionId: version.id,
      activeViewMode: "design",
      versions: [...current.versions, version],
      activity: [
        ...current.activity,
        {
          id: newId("act"),
          timestamp: createdAt,
          kind: "generation",
          text: `${version.label} ready`,
        },
      ],
    },
  });

  return { session: nextSession, version };
}

export function restoreDesignVersion(
  session: StylingSession,
  versionId: string,
): StylingSession {
  if (!session.consultation) return session;
  const current = session.consultation;
  const target = current.versions.find((item) => item.id === versionId);
  if (!target) return session;

  const bagProduct = buildCustomBagProduct(target);
  const updatedLook = placeInLook(session.currentLook, bagProduct);

  return recompute({
    ...session,
    currentLook: updatedLook,
    consultation: {
      ...current,
      currentDesignVersionId: target.id,
      designState: structuredClone(target.designState),
      activeViewMode: "design",
      activity: [
        ...current.activity,
        {
          id: newId("act"),
          timestamp: nowIso(),
          kind: "session",
          text: `Restored V${target.version} (${target.label})`,
        },
      ],
    },
  });
}

export function attachTryOnToVersion(
  session: StylingSession,
  versionId: string,
  lookId: string,
): StylingSession {
  if (!session.consultation) return session;
  const current = session.consultation;
  const nextStatus: ConsultationStatus =
    current.status === "GENERATING_TRYON" ? "LIVE" : current.status;

  return {
    ...session,
    consultation: {
      ...current,
      status: nextStatus,
      activeViewMode: "tryon",
      versions: current.versions.map((ver) =>
        ver.id === versionId ? { ...ver, tryOnLookId: lookId } : ver,
      ),
      activity: [
        ...current.activity,
        {
          id: newId("act"),
          timestamp: nowIso(),
          kind: "tryon",
          text: "Virtual try-on generated",
        },
      ],
    },
  };
}

export function endConsultation(session: StylingSession): StylingSession {
  if (!session.consultation) return session;
  const endedAt = nowIso();
  return {
    ...session,
    consultation: {
      ...session.consultation,
      status: "ENDED",
      botStatus: "STOPPED",
      endedAt,
      activity: [
        ...session.consultation.activity,
        {
          id: newId("act"),
          timestamp: endedAt,
          kind: "session",
          text: "Consultation ended",
        },
      ],
    },
  };
}
