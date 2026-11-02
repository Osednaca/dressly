import type { MeetingBotStatus } from "@/lib/types";

/**
 * Wire contracts between the Dressly Next.js server and the isolated
 * Playwright + Chromium Meeting Bot Worker (`services/meeting-bot/worker.ts`).
 */

export type AudioBackendMode = "auto" | "webrtc-tap" | "pulseaudio" | "simulated";

export const DEFAULT_BOT_DISPLAY_NAME = "Dressly AI Assistant";
export const MEETING_BOT_SECRET_HEADER = "x-meeting-bot-secret";

export interface StartBotSessionRequest {
  consultationSessionId: string;
  attemptId?: string;
  meetingUrl: string;
  botDisplayName?: string; // defaults to "Dressly AI Assistant"
  callbackUrl: string;     // e.g. http://127.0.0.1:3000/api/sessions/{id}/consultation/bot-event
  audioBackend?: "auto" | "webrtc-tap" | "pulseaudio" | "simulated";
  headless?: boolean;
}

export interface BotSessionSnapshot {
  consultationSessionId: string;
  meetingUrl: string;
  botDisplayName: string;
  status: MeetingBotStatus;
  audioBackend: string;
  headless: boolean;
  chunksCaptured: number;
  bytesCaptured: number;
  geminiConnected: boolean;
  reconnectAttempts: number;
  lastError?: string | null;
  startedAt: string;
}

export type BotWebhookEvent =
  (| {
      type: "bot.status";
      consultationSessionId: string;
      status: MeetingBotStatus;
      detail?: string;
      error?: string | null;
      timestamp: string;
    }
  | {
      type: "transcript.partial";
      consultationSessionId: string;
      text: string;
      timestamp: string;
    }
  | {
      type: "transcript.final";
      consultationSessionId: string;
      text: string;
      timestamp: string;
    }
  | {
      type: "bot.error";
      consultationSessionId: string;
      message: string;
      recoverable: boolean;
      timestamp: string;
    }) & { attemptId?: string };

export interface BotHealthResponse {
  ok: boolean;
  activeSessions: number;
  audioBackend: string;
  chromiumFound: boolean;
  chromiumPath?: string | null;
  ffmpegFound: boolean;
  ffmpegPath?: string | null;
}

export interface AudioDiagnosticRequest {
  durationMs?: number;
  injectTestTone?: boolean;
  audioBackend?: "auto" | "webrtc-tap" | "pulseaudio" | "simulated";
}

export interface AudioDiagnosticResult {
  ok: boolean;
  providerName: string;
  sampleRate: 16000;
  channels: 1;
  chunksEmitted: number;
  bytesTotal: number;
  durationMs: number;
}
