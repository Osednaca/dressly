import {
  DESIGN_FIELD_KEYS,
  DESIGN_FIELD_LABELS,
  type BagDesignState,
  type DesignFieldDiff,
  type DesignFieldKey,
} from "@/lib/types";

export interface BuildNanoBananaPromptParams {
  nextState: BagDesignState;
  previousState: BagDesignState;
  changes: DesignFieldDiff[];
  includeOriginalReference: boolean;
  highResFinal?: boolean;
}

export interface NanoBananaPromptResult {
  promptText: string;
  versionLabel: string;
  versionSummary: string;
}

const MAX_RUNWAY_PROMPT_LENGTH = 5000;

const OUTPUT_FORMAT_TEXT =
  "Single isolated ecommerce studio product photograph. Neutral studio background (#f3efe9), soft diffused studio lighting, front three-quarter product view, clear silhouette, minimal occlusion, realistic materials, accurate proportions. No hands holding the product, no model wearing it, no text overlays, no watermark.";

function capitalize(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function sanitizeAttributeText(value: string | undefined, fallback = "unspecified"): string {
  if (!value) return fallback;
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 160) : fallback;
}

function formatSingleChangeLabel(diff: DesignFieldDiff): string {
  const raw = sanitizeAttributeText(diff.proposedValue, "");
  const lower = raw.toLowerCase();

  switch (diff.field) {
    case "hardwareColor":
      return lower.includes("hardware") ? capitalize(raw) : `${capitalize(raw)} hardware`;
    case "size":
      if (lower === "small") return "Smaller silhouette";
      if (lower === "large") return "Larger silhouette";
      return lower.includes("silhouette") ? capitalize(raw) : `${capitalize(raw)} silhouette`;
    case "strapType":
    case "strapLength":
      if (lower.includes("crossbody") || lower.includes("cross-body")) {
        return "Crossbody strap";
      }
      return lower.includes("strap") ? capitalize(raw) : `${capitalize(raw)} strap`;
    case "primaryColor":
      return lower.includes("leather") ? capitalize(raw) : `${capitalize(raw)} leather`;
    case "material":
    case "texture":
      return lower.includes("finish") ? capitalize(raw) : `${capitalize(raw)} finish`;
    default:
      return `${capitalize(raw)} ${(diff.label || DESIGN_FIELD_LABELS[diff.field]).toLowerCase()}`;
  }
}

function formatSecondaryChipLabel(diff: DesignFieldDiff): string {
  const raw = sanitizeAttributeText(diff.proposedValue, "");
  const lower = raw.toLowerCase();
  if (diff.field === "size") {
    return capitalize(raw);
  }
  if (diff.field === "strapType" || diff.field === "strapLength") {
    if (lower.includes("crossbody") || lower.includes("cross-body")) {
      return "Crossbody strap";
    }
  }
  return formatSingleChangeLabel(diff);
}

export function buildVersionLabel(changes: DesignFieldDiff[]): string {
  if (changes.length === 0) return "Revision";

  // Collapse paired strapType + strapLength edits into one semantic strap change for labeling
  const hasStrapType = changes.some((c) => c.field === "strapType");
  const distinctChanges = changes.filter(
    (c) => !(hasStrapType && c.field === "strapLength"),
  );

  const effective = distinctChanges.length > 0 ? distinctChanges : changes;
  if (effective.length === 1) {
    return formatSingleChangeLabel(effective[0]!);
  }

  const first = formatSingleChangeLabel(effective[0]!);
  const second = formatSecondaryChipLabel(effective[1]!);
  return `${first} + ${second}`;
}

export function buildVersionSummary(
  changes: DesignFieldDiff[],
  previousState: BagDesignState,
): string {
  if (changes.length === 0) {
    return "Finalized high-resolution studio product render";
  }
  return changes
    .map((diff) => {
      const label = (diff.label || DESIGN_FIELD_LABELS[diff.field]).toLowerCase();
      const prev = diff.previousValue ?? previousState[diff.field] ?? "previous";
      return `${label}: ${prev} → ${diff.proposedValue}`;
    })
    .join(", ");
}

/**
 * Builds a deterministic, drift-controlled prompt for Runway `nano_banana_2.1`.
 *
 * Never passes raw unvalidated meeting transcript text as the image prompt.
 * Partitions every field in `DESIGN_FIELD_KEYS` into either `REQUESTED MODIFICATION`
 * or `STRICT PRESERVATION CONSTRAINTS` while anchoring to `@latest_design` (and
 * `@original_design` when `includeOriginalReference` is true).
 */
export function buildNanoBananaPrompt(
  params: BuildNanoBananaPromptParams,
): NanoBananaPromptResult {
  const {
    nextState,
    previousState,
    changes,
    includeOriginalReference,
    highResFinal = false,
  } = params;

  const referenceDescription = includeOriginalReference
    ? "Reference images: @latest_design (most recent approved version) and @original_design (canonical V1 baseline for proportions and camera framing)."
    : "Reference image: @latest_design (current approved version).";

  const currentProductLines = [
    `${sanitizeAttributeText(nextState.name)}: ${sanitizeAttributeText(nextState.size)} ${sanitizeAttributeText(nextState.primaryColor)} ${sanitizeAttributeText(nextState.material)} ${sanitizeAttributeText(nextState.silhouette)} with ${sanitizeAttributeText(nextState.texture)} surface finish.`,
    `Hardware: ${sanitizeAttributeText(nextState.hardwareColor)}, ${sanitizeAttributeText(nextState.hardwareStyle)}.`,
    `Strap configuration: ${sanitizeAttributeText(nextState.strapType)}, ${sanitizeAttributeText(nextState.strapLength)}.`,
    `Closure and construction: ${sanitizeAttributeText(nextState.closure)}; ${sanitizeAttributeText(nextState.structure)}.`,
    ...(nextState.secondaryColor
      ? [`Secondary / edge detail: ${sanitizeAttributeText(nextState.secondaryColor)}.`]
      : []),
    ...(nextState.pattern ? [`Pattern: ${sanitizeAttributeText(nextState.pattern)}.`] : []),
    ...(nextState.branding ? [`Branding: ${sanitizeAttributeText(nextState.branding)}.`] : []),
    referenceDescription,
  ];

  const modificationIntro =
    "Apply ONLY the following approved modification(s) to @latest_design:";
  const modificationBullets =
    changes.length > 0
      ? changes.map((diff) => {
          const label = diff.label || DESIGN_FIELD_LABELS[diff.field];
          const previousVal = sanitizeAttributeText(
            diff.previousValue ?? previousState[diff.field],
            "previous",
          );
          const proposedVal = sanitizeAttributeText(diff.proposedValue);
          return `- ${label} (${diff.field}): change from "${previousVal}" to "${proposedVal}"`;
        })
      : [
          `- High-resolution master render: preserve all design attributes of @latest_design exactly`,
        ];

  const modifiedFields = new Set<DesignFieldKey>(changes.map((diff) => diff.field));
  const unchangedFields = DESIGN_FIELD_KEYS.filter((field) => !modifiedFields.has(field));

  const preservationIntro = includeOriginalReference
    ? "Do not alter any unrequested attributes. Preserve @latest_design and the canonical proportions, silhouette, and camera framing of @original_design identically for every attribute below:"
    : "Do not alter any unrequested attributes. Preserve @latest_design (including its canonical proportions, silhouette, and camera framing) identically for every attribute below:";

  const preservationTarget = includeOriginalReference
    ? "@latest_design and @original_design"
    : "@latest_design";

  const preservationBullets = unchangedFields.map((field) => {
    const label = DESIGN_FIELD_LABELS[field];
    const currentValue = sanitizeAttributeText(
      nextState[field] ?? previousState[field],
      "unchanged",
    );
    return `- ${label} (${field}): preserve "${currentValue}" identically to ${preservationTarget}`;
  });

  const outputFormatBlock = highResFinal
    ? `${OUTPUT_FORMAT_TEXT} High-resolution 2K master studio product photograph.`
    : OUTPUT_FORMAT_TEXT;

  const sections = [
    `CURRENT PRODUCT\n${currentProductLines.join("\n")}`,
    `REQUESTED MODIFICATION\n${modificationIntro}\n${modificationBullets.join("\n")}`,
    `STRICT PRESERVATION CONSTRAINTS\n${preservationIntro}\n${preservationBullets.join("\n")}`,
    `OUTPUT FORMAT\n${outputFormatBlock}`,
  ];

  const promptText = sections.join("\n\n").slice(0, MAX_RUNWAY_PROMPT_LENGTH);
  const versionLabel = buildVersionLabel(changes);
  const versionSummary = buildVersionSummary(changes, previousState);

  return {
    promptText,
    versionLabel,
    versionSummary,
  };
}
