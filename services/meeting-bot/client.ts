import { env } from "@/lib/env";
import type { MeetingBotStatus } from "@/lib/types";
import { meetingBotRemoteConfigurationError, meetingBotSecretIsSafe } from "@/services/meeting-bot/security";
import {
  DEFAULT_BOT_DISPLAY_NAME,
  MEETING_BOT_SECRET_HEADER,
  type AudioDiagnosticResult,
  type BotHealthResponse,
  type BotSessionSnapshot,
  type StartBotSessionRequest,
} from "@/services/meeting-bot/contract";

/**
 * Next.js Server-to-Worker HTTP Client (`services/meeting-bot/client.ts`).
 *
 * Communicates with the isolated Playwright Meeting Bot Worker on `env.meetingBotUrl`.
 * When the standalone worker is unavailable, report failure rather than implying
 * that audio is being captured. Manual consultation can still continue.
 */

const WORKER_OFFLINE_MESSAGE =
  "Bot worker unavailable — audio is not being captured; manual consultation remains available.";

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? env.meetingBotUrl).replace(/\/+$/, "");
}

function workerHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret,
  };
}

export const meetingBotClient = {
  async getHealth(baseUrl?: string): Promise<BotHealthResponse | null> {
    try {
      if (!meetingBotSecretIsSafe(env.meetingBotSecret) || meetingBotRemoteConfigurationError(normalizeBaseUrl(baseUrl))) return null;
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/bot/health`, {
        method: "GET",
        headers: workerHeaders(),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;
      return (await res.json()) as BotHealthResponse;
    } catch {
      return null;
    }
  },

  async startSession(
    req: StartBotSessionRequest,
    baseUrl?: string,
  ): Promise<{
    workerConnected: boolean;
    status: MeetingBotStatus;
    message: string;
    snapshot?: BotSessionSnapshot;
  }> {
    const configError = !meetingBotSecretIsSafe(env.meetingBotSecret)
      ? "Configure a strong MEETING_BOT_SECRET (at least 32 characters) on both app and worker."
      : meetingBotRemoteConfigurationError(normalizeBaseUrl(baseUrl), req.callbackUrl);
    if (configError) return { workerConnected: false, status: "FAILED", message: configError };
    try {
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/bot/sessions`, {
        method: "POST",
        headers: workerHeaders(),
        body: JSON.stringify({
          ...req,
          botDisplayName: req.botDisplayName ?? DEFAULT_BOT_DISPLAY_NAME,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return {
          workerConnected: false,
          status: "FAILED",
          message: WORKER_OFFLINE_MESSAGE,
        };
      }

      const snapshot = (await res.json()) as BotSessionSnapshot;
      return {
        workerConnected: true,
        status: snapshot.status,
        message:
          snapshot.status === "FAILED"
            ? (snapshot.lastError ?? `${snapshot.botDisplayName} failed to join meeting.`)
            : `${snapshot.botDisplayName} (${snapshot.status})`,
        snapshot,
      };
    } catch {
      return {
        workerConnected: false,
        status: "FAILED",
        message: WORKER_OFFLINE_MESSAGE,
      };
    }
  },

  async getSession(
    consultationSessionId: string,
    baseUrl?: string,
  ): Promise<BotSessionSnapshot | null> {
    try {
      if (!meetingBotSecretIsSafe(env.meetingBotSecret) || meetingBotRemoteConfigurationError(normalizeBaseUrl(baseUrl))) return null;
      const encodedId = encodeURIComponent(consultationSessionId);
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/bot/sessions/${encodedId}`, {
        method: "GET",
        headers: workerHeaders(),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;
      return (await res.json()) as BotSessionSnapshot;
    } catch {
      return null;
    }
  },

  async stopSession(consultationSessionId: string, baseUrl?: string): Promise<boolean> {
    try {
      if (!meetingBotSecretIsSafe(env.meetingBotSecret) || meetingBotRemoteConfigurationError(normalizeBaseUrl(baseUrl))) return false;
      const encodedId = encodeURIComponent(consultationSessionId);
      const res = await fetch(
        `${normalizeBaseUrl(baseUrl)}/bot/sessions/${encodedId}/stop`,
        {
          method: "POST",
          headers: workerHeaders(),
          signal: AbortSignal.timeout(4000),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  },

  async reconnectSession(
    consultationSessionId: string,
    baseUrl?: string,
  ): Promise<{
    workerConnected: boolean;
    status: MeetingBotStatus;
    message: string;
  }> {
    const configError = !meetingBotSecretIsSafe(env.meetingBotSecret)
      ? "Configure a strong MEETING_BOT_SECRET (at least 32 characters) on both app and worker."
      : meetingBotRemoteConfigurationError(normalizeBaseUrl(baseUrl));
    if (configError) return { workerConnected: false, status: "FAILED", message: configError };
    try {
      const encodedId = encodeURIComponent(consultationSessionId);
      const res = await fetch(
        `${normalizeBaseUrl(baseUrl)}/bot/sessions/${encodedId}/reconnect`,
        {
          method: "POST",
          headers: workerHeaders(),
          signal: AbortSignal.timeout(8000),
        },
      );

      if (!res.ok) {
        return {
          workerConnected: false,
          status: "FAILED",
          message: WORKER_OFFLINE_MESSAGE,
        };
      }

      const snapshot = (await res.json()) as BotSessionSnapshot;
      return {
        workerConnected: true,
        status: snapshot.status,
        message: `${snapshot.botDisplayName} reconnected (${snapshot.status})`,
      };
    } catch {
      return {
        workerConnected: false,
        status: "FAILED",
        message: WORKER_OFFLINE_MESSAGE,
      };
    }
  },

  async runAudioDiagnostic(
    durationMs = 250,
    baseUrl?: string,
  ): Promise<AudioDiagnosticResult | null> {
    try {
      if (!meetingBotSecretIsSafe(env.meetingBotSecret) || meetingBotRemoteConfigurationError(normalizeBaseUrl(baseUrl))) return null;
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/bot/diagnostics/audio`, {
        method: "POST",
        headers: workerHeaders(),
        body: JSON.stringify({ durationMs }),
        signal: AbortSignal.timeout(Math.max(4000, durationMs + 2500)),
      });
      if (!res.ok) return null;
      return (await res.json()) as AudioDiagnosticResult;
    } catch {
      return null;
    }
  },
};
