import { nowIso } from "@/lib/util/id";

/**
 * Structured observability & milestone logger for Dressly Live Consultation (Section 41).
 *
 * Guarantees:
 * - Supports all 13 required consultation lifecycle milestones.
 * - Redacts any key matching `/key|secret|token|authorization|audio|pcm/i` and any
 *   binary buffers so raw API keys and raw meeting audio are never logged.
 * - Maintains a bounded in-memory ring buffer of the last 100 log entries for
 *   diagnostics and automated verification.
 */

export const CONSULTATION_MILESTONES = [
  "consultation started",
  "bot launch attempted",
  "meet loaded",
  "bot admitted",
  "audio capture started",
  "Gemini connected",
  "suggestion detected",
  "suggestion approved",
  "Runway generation started",
  "Runway completed",
  "YouCam started",
  "YouCam completed",
  "consultation ended",
] as const;

export type ConsultationMilestone = (typeof CONSULTATION_MILESTONES)[number];

export interface ConsultationLogRecord {
  timestamp: string;
  milestone: ConsultationMilestone;
  sessionId: string;
  details: Record<string, unknown>;
}

const MAX_LOG_RECORDS = 100;
const SENSITIVE_KEY_PATTERN = /key|secret|token|authorization|audio|pcm/i;

const logRingBuffer: ConsultationLogRecord[] = [];

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return "[REDACTED_BINARY]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function sanitizeConsultationLogDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeValue(details, 0);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return {};
}

function shouldEmitConsoleLog(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.NODE_TEST_CONTEXT) return false;
  if (process.execArgv.includes("--test")) return false;
  return true;
}

export function logConsultationMilestone(
  milestone: ConsultationMilestone,
  details: { sessionId: string; [key: string]: unknown },
): ConsultationLogRecord {
  const { sessionId, ...rest } = details;
  const sanitizedDetails = sanitizeConsultationLogDetails(rest);
  const record: ConsultationLogRecord = {
    timestamp: nowIso(),
    milestone,
    sessionId,
    details: sanitizedDetails,
  };

  logRingBuffer.push(record);
  if (logRingBuffer.length > MAX_LOG_RECORDS) {
    logRingBuffer.splice(0, logRingBuffer.length - MAX_LOG_RECORDS);
  }

  if (shouldEmitConsoleLog()) {
    console.info(
      JSON.stringify({
        scope: "dressly.consultation",
        ...record,
      }),
    );
  }

  return record;
}

export function getRecentConsultationLogs(sessionId?: string): ConsultationLogRecord[] {
  if (!sessionId) {
    return [...logRingBuffer];
  }
  return logRingBuffer.filter((entry) => entry.sessionId === sessionId);
}

export function clearConsultationLogs(): void {
  logRingBuffer.length = 0;
}
