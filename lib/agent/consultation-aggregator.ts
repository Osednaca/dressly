import { computeChangeFingerprint } from "@/lib/session/reducer";
import {
  DESIGN_FIELD_LABELS,
  type BagDesignState,
  type DesignFieldDiff,
  type DesignFieldKey,
  type LiveConsultationSession,
  type TranscriptSegment,
} from "@/lib/types";

const FILLER_WORDS = new Set([
  "yeah",
  "yes",
  "yep",
  "um",
  "uh",
  "erm",
  "hmm",
  "well",
  "so",
  "actually",
  "honestly",
  "please",
]);

const LIGHT_DETERMINER_TOKENS = new Set([
  "the",
  "that",
  "this",
  "a",
  "an",
  "it",
  "to",
]);

/**
 * Normalizes spoken consultation transcript text for comparison and deduplication:
 * lowercases, strips punctuation, removes conversational filler words, and collapses spaces.
 */
export function normalizeTranscriptText(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length > 0 && !FILLER_WORDS.has(token));

  return tokens.join(" ");
}

/**
 * Computes weighted token Jaccard overlap (0..1) between two transcript strings.
 * Light determiners ("the", "that", "this", "a", "an") carry lower weight (0.25)
 * so near-identical utterances like "make the strap longer" and
 * "yeah, make that strap longer" score >= 0.85.
 */
export function transcriptSimilarity(a: string, b: string): number {
  const normA = normalizeTranscriptText(a);
  const normB = normalizeTranscriptText(b);

  if (!normA && !normB) return 1;
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const setA = new Set(normA.split(" ").filter(Boolean));
  const setB = new Set(normB.split(" ").filter(Boolean));
  const allTokens = new Set([...setA, ...setB]);

  let intersectionWeight = 0;
  let unionWeight = 0;

  for (const token of allTokens) {
    const weight = LIGHT_DETERMINER_TOKENS.has(token) ? 0.25 : 1.0;
    unionWeight += weight;
    if (setA.has(token) && setB.has(token)) {
      intersectionWeight += weight;
    }
  }

  if (unionWeight === 0) return 0;
  return intersectionWeight / unionWeight;
}

/**
 * Returns true if `text` is a near-duplicate (similarity >= 0.75 after filler stripping)
 * of any finalized segment in `recentSegments` within `windowMs`.
 */
export function isDuplicateTranscript(
  text: string,
  recentSegments: Pick<TranscriptSegment, "text" | "timestamp" | "isFinal">[],
  nowMs = Date.now(),
  windowMs = 15_000,
): boolean {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return true;

  for (let i = recentSegments.length - 1; i >= 0; i -= 1) {
    const seg = recentSegments[i]!;
    if (!seg.isFinal) continue;

    const segMs = Date.parse(seg.timestamp);
    if (Number.isFinite(segMs) && Math.abs(nowMs - segMs) > windowMs) {
      continue;
    }

    if (transcriptSimilarity(text, seg.text) >= 0.75) {
      return true;
    }
  }

  return false;
}

function normalizeFieldValue(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Populates human-readable field labels and `previousValue` from `currentState`,
 * and removes any proposed change whose value already matches `currentState[field]`.
 */
export function pruneRedundantChanges(
  rawChanges: { field: DesignFieldKey; proposedValue: string }[],
  currentState: BagDesignState,
): DesignFieldDiff[] {
  const byField = new Map<DesignFieldKey, DesignFieldDiff>();

  for (const raw of rawChanges) {
    const proposed = raw.proposedValue.trim();
    if (!proposed) continue;

    const currentVal = currentState[raw.field];
    const currentStr = typeof currentVal === "string" ? currentVal : undefined;

    if (normalizeFieldValue(proposed) === normalizeFieldValue(currentStr)) {
      continue;
    }

    byField.set(raw.field, {
      field: raw.field,
      label: DESIGN_FIELD_LABELS[raw.field] ?? raw.field.toUpperCase(),
      previousValue: currentStr,
      proposedValue: proposed,
    });
  }

  return [...byField.values()];
}

/**
 * Returns true if any `PENDING` suggestion has the same fingerprint, or any
 * `APPROVED`/`EDITED` suggestion within `windowMs` has the same fingerprint.
 */
export function isDuplicateProposal(
  fingerprint: string,
  consultation: LiveConsultationSession,
  nowMs = Date.now(),
  windowMs = 20_000,
): boolean {
  const cleaned = fingerprint.trim();
  if (!cleaned) return true;

  if (consultation.pendingSuggestions.some((item) => item.fingerprint === cleaned)) {
    return true;
  }

  for (const item of consultation.approvedSuggestions) {
    if (item.fingerprint !== cleaned) continue;
    const itemMs = Date.parse(item.timestamp);
    if (!Number.isFinite(itemMs) || Math.abs(nowMs - itemMs) <= windowMs) {
      return true;
    }
  }

  return false;
}

interface DebounceBucket {
  clauses: string[];
  timer: ReturnType<typeof setTimeout>;
  onFlush: (mergedText: string) => Promise<unknown>;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
}

const debounceBuckets = new Map<string, DebounceBucket>();

function cleanClause(text: string): string {
  return text
    .trim()
    .replace(/^(?:\.{2,}|…)\s*/, "")
    .replace(/\s*(?:\.{2,}|…)$/, "")
    .trim();
}

/**
 * Buffers rapid consecutive utterances within `windowMs` per session and merges them
 * with `" "` into a single combined utterance before invoking `onFlush`.
 */
export function enqueueConsultationUtterance(
  sessionId: string,
  text: string,
  onFlush: (mergedText: string) => Promise<unknown>,
  windowMs = 1800,
): Promise<void> {
  const cleaned = cleanClause(text);
  if (!cleaned) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = debounceBuckets.get(sessionId);

    const scheduleFlush = (bucket: DebounceBucket) =>
      setTimeout(async () => {
        debounceBuckets.delete(sessionId);
        const mergedText = bucket.clauses.join(" ").replace(/\s+/g, " ").trim();
        try {
          if (mergedText) {
            await bucket.onFlush(mergedText);
          }
          for (const res of bucket.resolvers) res();
        } catch (error) {
          for (const rej of bucket.rejecters) rej(error);
        }
      }, Math.max(0, windowMs));

    if (existing) {
      clearTimeout(existing.timer);
      existing.clauses.push(cleaned);
      existing.onFlush = onFlush;
      existing.resolvers.push(resolve);
      existing.rejecters.push(reject);
      existing.timer = scheduleFlush(existing);
      return;
    }

    const bucket: DebounceBucket = {
      clauses: [cleaned],
      onFlush,
      resolvers: [resolve],
      rejecters: [reject],
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    bucket.timer = scheduleFlush(bucket);
    debounceBuckets.set(sessionId, bucket);
  });
}

export function clearConsultationDebounce(sessionId: string): void {
  const bucket = debounceBuckets.get(sessionId);
  if (!bucket) return;
  clearTimeout(bucket.timer);
  debounceBuckets.delete(sessionId);
  for (const resolve of bucket.resolvers) {
    resolve();
  }
}

export { computeChangeFingerprint };
