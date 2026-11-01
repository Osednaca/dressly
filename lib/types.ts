/**
 * Dressly domain types.
 *
 * These types are the contract between the deterministic application code, the AI
 * providers (Gemini for language, JEV for decisions) and the YouCam try-on engine.
 * Anything the UI or the Agent Decisions panel shows comes from here.
 */

/** Catalog naming we own. Independent from the provider's enum on purpose. */
export type CatalogCategory = "upper_body" | "lower_body" | "outer" | "shoes" | "accessory";

/**
 * Official YouCam `garment_category` values for `POST /s2s/v2.0/task/cloth-v4`.
 * Kept separate from `CatalogCategory` so a provider change never leaks into the UI.
 */
export type YouCamGarmentCategory =
  | "full_body"
  | "lower_body"
  | "upper_body"
  | "shoes"
  | "auto"
  | "outer";

export type StyleTag =
  | "casual"
  | "smart_casual"
  | "formal"
  | "streetwear"
  | "sport"
  | "minimal"
  | "business"
  | "evening";

export const STYLE_TAGS: readonly StyleTag[] = [
  "casual",
  "smart_casual",
  "formal",
  "streetwear",
  "sport",
  "minimal",
  "business",
  "evening",
];

export type Occasion =
  | "dinner"
  | "date"
  | "vacation"
  | "work"
  | "party"
  | "wedding"
  | "everyday"
  | "travel"
  | "event";

export interface Product {
  id: string;
  name: string;
  /** Fictitious house, used for the editorial product cards. */
  brand: string;
  category: CatalogCategory;
  subcategory: string;
  styles: StyleTag[];
  occasions: Occasion[];
  /** Normalized lowercase color names, e.g. `["cream"]`. */
  colors: string[];
  price: number;
  currency: "USD";
  /** Store-relative path, e.g. `/catalog/top-001.png`. */
  image: string;
  /** Official provider enum, or null when the item is not try-on capable. */
  vtoCategory: YouCamGarmentCategory | null;
  /** 0 = very relaxed, 1 = black tie. Deterministic metadata for scoring. */
  formality: number;
  /** 0 = featherweight, 1 = heavy winter layer. Deterministic metadata for scoring. */
  warmth: number;
  description: string;
}

/** The live outfit being assembled. */
export interface CurrentLook {
  top?: Product;
  bottom?: Product;
  outer?: Product;
  shoes?: Product;
  accessories: Product[];
}

export type LookFeedback = "pending" | "liked" | "rejected";

/** One generated YouCam result, kept for the history strip. */
export interface Look {
  id: string;
  /** 1-based position in the session, shown as "Look 1". */
  index: number;
  /** Local re-hosted path so signed provider URLs expiring never breaks history. */
  imagePath: string;
  /** The look this one was built from, for before/after comparison. */
  previousImagePath: string;
  /** Snapshot of the outfit at the time this look was generated. */
  items: CurrentLook;
  /** The garment that was just added to reach this look. */
  addedProductId: string | null;
  feedback: LookFeedback;
  label: string;
  /** P2: Runway animation of this look, once generated. Null until then. */
  videoPath?: string | null;
  createdAt: string;
}

/** Actions JEV chooses between. Mirrors the product brief. */
export type AgentAction =
  | "CHANGE_TOP"
  | "CHANGE_BOTTOM"
  | "CHANGE_FULL_OUTFIT"
  | "ADD_OUTER"
  | "CHANGE_SHOES"
  | "ADD_ACCESSORY"
  | "KEEP_LOOK"
  | "SHOW_ALTERNATIVE"
  | "FINISH_LOOK";

export const AGENT_ACTIONS: readonly AgentAction[] = [
  "CHANGE_TOP",
  "CHANGE_BOTTOM",
  "CHANGE_FULL_OUTFIT",
  "ADD_OUTER",
  "CHANGE_SHOES",
  "ADD_ACCESSORY",
  "KEEP_LOOK",
  "SHOW_ALTERNATIVE",
  "FINISH_LOOK",
];

/** Provider-neutral outcome of the language layer. */
export interface IntentDelta {
  occasion?: string;
  desiredStyles: StyleTag[];
  avoidedStyles: StyleTag[];
  preferredColors: string[];
  avoidedColors: string[];
  budget?: number;
  /** Explicit action the user asked for, when they were unambiguous. */
  requestedAction?: AgentAction;
  /** How the user reacted to the current look. */
  feedbackOnCurrent?: "liked" | "rejected" | "closer";
  /** Explicit category the user pointed at, e.g. "add a jacket" -> outer. */
  targetCategory?: CatalogCategory;
  /** One safe, user-facing sentence. */
  assistantReply: string;
  /** Short chips for the Agent Decisions panel, e.g. ["Rooftop dinner", "Not too formal"]. */
  interpreted: string[];
}

export type SessionStatus = "DISCOVERY" | "STYLING" | "REFINING" | "COMPLETED";

/** A scored alternative as rendered in the Agent Decisions panel. */
export interface ScoredAlternative {
  label: string;
  /** 0..1 probability from JEV, or a deterministic score in fallback mode. */
  probability: number;
}

export interface DecisionRecord {
  id: string;
  createdAt: string;
  /** 1-based agent iteration. */
  iteration: number;
  intent?: IntentDelta;
  styleDistribution: ScoredAlternative[];
  action?: {
    decision: AgentAction;
    confidence: number;
    distribution: ScoredAlternative[];
  };
  consultationAction?: {
    decision: ConsultationAction;
    confidence: number;
    distribution: ScoredAlternative[];
  };
  productEvaluation: ScoredAlternative[];
  selectedProductId?: string;
  selectedProductName?: string;
  /** Short, user-safe explanation. Never raw chain-of-thought. */
  reason: string;
  /** Which engine produced this record, so the panel never over-claims. */
  provider: "jev" | "fallback";
  model?: string;
}

export interface SessionMetrics {
  looksGenerated: number;
  productsTried: number;
  productsRejected: number;
  productsLiked: number;
  agentIterations: number;
  compatibleProducts: number;
  cartTotal: number;
  completed: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "dressly";
  text: string;
  createdAt: string;
}

/**
 * Live Design Consultation domain types.
 */
export type ConsultationStatus =
  | "OFFLINE"
  | "STARTING"
  | "WAITING_FOR_ADMISSION"
  | "LIVE"
  | "GENERATING_DESIGN"
  | "GENERATING_TRYON"
  | "RECONNECTING"
  | "ENDED"
  | "FAILED";

export type MeetingBotStatus =
  | "IDLE"
  | "STARTING"
  | "OPENING_MEET"
  | "WAITING_FOR_ADMISSION"
  | "JOINED"
  | "LISTENING"
  | "RECONNECTING"
  | "FAILED"
  | "STOPPED";

export const CONSULTATION_ACTIONS = [
  "IGNORE",
  "PROPOSE_CHANGE",
  "ASK_CLARIFICATION",
  "TRY_ON_CURRENT_DESIGN",
  "RETURN_TO_PREVIOUS_VERSION",
  "FINALIZE_DESIGN",
] as const;

export type ConsultationAction = (typeof CONSULTATION_ACTIONS)[number];

export interface BagDesignState {
  category: "bag";
  name: string;
  silhouette: string;
  size: string;
  primaryColor: string;
  secondaryColor?: string;
  material: string;
  texture: string;
  hardwareColor: string;
  hardwareStyle: string;
  strapType: string;
  strapLength: string;
  closure: string;
  structure: string;
  pattern?: string;
  pockets?: string[];
  decorativeDetails?: string[];
  branding?: string;
  notes?: string[];
}

export const DEFAULT_BAG_DESIGN_STATE: BagDesignState = {
  category: "bag",
  name: "Atelier Structured Top-Handle Bag",
  silhouette: "structured rectangular top-handle bag",
  size: "medium",
  primaryColor: "burgundy",
  secondaryColor: "tonal burgundy edge paint",
  material: "full-grain calfskin leather",
  texture: "smooth",
  hardwareColor: "gold",
  hardwareStyle: "minimal geometric clasp",
  strapType: "top handle",
  strapLength: "short top handle",
  closure: "front flap with magnetic clasp",
  structure: "rigid box-gusset construction",
  pattern: "solid",
  pockets: ["interior zip compartment", "back slip pocket"],
  decorativeDetails: ["tonal saddle stitching"],
  branding: "unbranded clean front",
  notes: [],
};

export const DESIGN_FIELD_KEYS = [
  "name",
  "silhouette",
  "size",
  "primaryColor",
  "secondaryColor",
  "material",
  "texture",
  "hardwareColor",
  "hardwareStyle",
  "strapType",
  "strapLength",
  "closure",
  "structure",
  "pattern",
  "branding",
] as const;

export type DesignFieldKey = (typeof DESIGN_FIELD_KEYS)[number];

export const DESIGN_FIELD_LABELS: Record<DesignFieldKey, string> = {
  name: "NAME",
  silhouette: "SILHOUETTE",
  size: "SIZE",
  primaryColor: "COLOR",
  secondaryColor: "ACCENT COLOR",
  material: "MATERIAL",
  texture: "TEXTURE",
  hardwareColor: "HARDWARE",
  hardwareStyle: "HARDWARE STYLE",
  strapType: "STRAP",
  strapLength: "STRAP LENGTH",
  closure: "CLOSURE",
  structure: "STRUCTURE",
  pattern: "PATTERN",
  branding: "BRANDING",
};

export interface DesignFieldDiff {
  field: DesignFieldKey;
  label: string;
  previousValue?: string;
  proposedValue: string;
}

export interface ProposedDesignChange {
  id: string;
  transcriptExcerpt: string;
  confidence: number;
  jevAction: ConsultationAction;
  jevReason: string;
  provider: "jev" | "fallback";
  changes: DesignFieldDiff[];
  fingerprint: string;
  status: "PENDING" | "APPROVED" | "EDITED" | "IGNORED";
  timestamp: string;
}

export interface DesignVersion {
  id: string;
  version: number;
  label: string;
  summary: string;
  imageUrl: string;
  tryOnLookId?: string | null;
  designState: BagDesignState;
  sourceSuggestionId?: string;
  promptUsed?: string;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: "MEETING";
  text: string;
  isFinal: boolean;
  timestamp: string;
}

export interface ConsultationActivityEntry {
  id: string;
  timestamp: string;
  kind:
    | "session"
    | "bot"
    | "speech"
    | "suggestion"
    | "approval"
    | "generation"
    | "tryon"
    | "error";
  text: string;
}

export interface LiveConsultationSession {
  id: string;
  meetingUrl: string;
  consentConfirmed: boolean;
  status: ConsultationStatus;
  botStatus: MeetingBotStatus;
  botError?: string | null;
  designState: BagDesignState;
  originalVersionId: string;
  currentDesignVersionId: string;
  activeViewMode: "design" | "tryon";
  versions: DesignVersion[];
  pendingSuggestions: ProposedDesignChange[];
  approvedSuggestions: ProposedDesignChange[];
  ignoredSuggestions: ProposedDesignChange[];
  transcript: TranscriptSegment[];
  activity: ConsultationActivityEntry[];
  autoApply: boolean;
  autoApplyThreshold: number;
  autoTryOn: boolean;
  startedAt: string;
  endedAt?: string;
}

export interface StylingSession {
  id: string;
  createdAt: string;
  /** Local path of the user's uploaded photo. Never sent anywhere but YouCam. */
  userPhotoPath: string | null;

  occasion?: string;
  targetStyles: StyleTag[];
  preferredColors: string[];
  avoidedStyles: StyleTag[];
  avoidedColors: string[];
  budget?: number;

  currentLook: CurrentLook;

  triedProducts: string[];
  rejectedProducts: string[];
  likedProducts: string[];

  looks: Look[];
  activeLookId: string | null;

  decisions: DecisionRecord[];
  messages: ChatMessage[];
  metrics: SessionMetrics;

  conversationSummary: string;
  status: SessionStatus;

  /** Active or past Live Design Consultation attached to this session. */
  consultation?: LiveConsultationSession | null;
}

/** What the orchestrator returns to the route handler and the UI. */
export interface AgentTurn {
  session: StylingSession;
  decision: DecisionRecord;
  /** The product to try on next, if the action calls for a garment. */
  selection: { product: Product; action: AgentAction } | null;
  /** Present when the agent could not proceed and the user must decide. */
  blocked: { code: string; message: string; retryable: boolean } | null;
}
