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
  "Cannot reach the bot worker. Check the worker process and HTTPS tunnel; audio is not being captured.";

function workerHttpFailure(status: number): string {
  if (status === 401 || status === 403) return "Bot worker authentication failed. Check the shared secret on the app and worker.";
  if (status === 404) return "Bot worker endpoint was not found. Check the worker URL and tunnel configuration.";
  return `Bot worker returned HTTP ${status}. Check the worker and tunnel logs.`;
}

function workerNetworkFailure(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "Bot worker request timed out. Check the worker process and HTTPS tunnel.";
  }
  return WORKER_OFFLINE_MESSAGE;
}

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
        console.warn(`[meeting-bot-client] Start rejected: HTTP ${res.status}`);
        return {
          workerConnected: false,
          status: "FAILED",
          message: workerHttpFailure(res.status),
        };
      }

      const snapshot = (await res.json()) as BotSessionSnapshot;
      return {
        workerConnected: true,
        status: snapshot.status,
        message:
          snapshot.status === "FAILED"
            ? "Bot worker reported a startup failure. Check the worker logs."
            : `${snapshot.botDisplayName} (${snapshot.status})`,
        snapshot: { ...snapshot, lastError: snapshot.lastError ? "Worker reported an error; check its logs." : snapshot.lastError },
      };
    } catch (error) {
      console.warn(`[meeting-bot-client] Start failed: ${error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "connection error"}`);
      return {
        workerConnected: false,
        status: "FAILED",
        message: workerNetworkFailure(error),
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
    attemptId?: string,
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
          body: JSON.stringify({ attemptId }),
          signal: AbortSignal.timeout(8000),
        },
      );

      if (!res.ok) {
        console.warn(`[meeting-bot-client] Reconnect rejected: HTTP ${res.status}`);
        return {
          workerConnected: false,
          status: "FAILED",
          message: workerHttpFailure(res.status),
        };
      }

      const snapshot = (await res.json()) as BotSessionSnapshot;
      return {
        workerConnected: true,
        status: snapshot.status,
        message: `${snapshot.botDisplayName} ${snapshot.status === "RECONNECTING" ? "reconnecting" : "reconnected"} (${snapshot.status})`,
      };
    } catch (error) {
      console.warn(`[meeting-bot-client] Reconnect failed: ${error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "connection error"}`);
      return {
        workerConnected: false,
        status: "FAILED",
        message: workerNetworkFailure(error),
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
