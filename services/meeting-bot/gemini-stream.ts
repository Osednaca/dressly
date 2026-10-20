import { env } from "@/lib/env";
import type { AudioChunkPayload, ConsultationAudioSource } from "@/services/meeting-bot/audio-source";

/**
 * Worker-Side Gemini Live Audio Stream Client (`services/meeting-bot/gemini-stream.ts`).
 *
 * Connects server-to-server from the isolated Meeting Bot Worker to Google's
 * `BidiGenerateContent` WebSocket endpoint using `models/gemini-3.8-live`.
 *
 * Privacy & Security Guarantees (Section 31):
 * - Streams 16 kHz mono s16le PCM audio strictly in-memory (`realtimeInput.audio`);
 *   raw meeting audio is never written to disk.
 * - The `GEMINI_API_KEY` remains strictly inside the server/worker environment.
 * - Configures Gemini Live as a silent passive listener (`inputAudioTranscription: {}`)
 *   and emits partial and finalized transcript segments (`speaker: "MEETING"`).
 */

export const GEMINI_LIVE_WS_BASE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const GEMINI_CONSULTATION_SYSTEM_INSTRUCTION =
  "You are Dressly AI Assistant, a silent passive listener in a live fashion design consultation. Do not speak out loud. Listen carefully so input audio transcription captures all fashion design requests accurately.";

export const DEFAULT_SILENCE_FLUSH_MS = 1400;

export interface MinimalWebSocket {
  readyState: number;
  binaryType?: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface GeminiConsultationLiveStreamOptions {
  /** Gemini API key. Defaults to `env.geminiApiKey`. */
  apiKey?: string;
  /** Gemini Live model identifier. Defaults to `env.geminiLiveModel` (`gemini-3.8-live`). */
  model?: string;
  /** Silence window in ms after the last `inputTranscription` chunk before auto-finalizing. Defaults to 1400ms. */
  silenceFlushMs?: number;
  /** Optional callback invoked as partial transcript text accumulates within a turn. */
  onPartialTranscript?: (text: string) => void;
  /** Optional callback invoked when a turn completes or flushes after silence. */
  onFinalTranscript?: (text: string) => void;
  /** Optional callback invoked when Gemini Live connection/setup state changes. */
  onStatusChange?: (connected: boolean, detail?: string) => void;
  /** Optional callback invoked on WebSocket or protocol errors. */
  onError?: (error: Error) => void;
  /** Optional WebSocket factory for deterministic unit tests. */
  webSocketFactory?: (url: string) => MinimalWebSocket;
}

interface GeminiLiveServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    inputTranscription?: {
      text?: string;
      finished?: boolean;
    };
    outputTranscription?: {
      text?: string;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  goAway?: {
    timeLeft?: string;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

const WS_OPEN_STATE = 1;

export function normalizeGeminiLiveModel(model: string = env.geminiLiveModel): string {
  const trimmed = model.trim() || "gemini-3.8-live";
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

export function buildGeminiConsultationSetupMessage(model: string = env.geminiLiveModel) {
  return {
    setup: {
      model: normalizeGeminiLiveModel(model),
      generationConfig: {
        responseModalities: ["AUDIO"],
      },
      inputAudioTranscription: {},
      systemInstruction: {
        parts: [
          {
            text: GEMINI_CONSULTATION_SYSTEM_INSTRUCTION,
          },
        ],
      },
    },
  };
}

function joinTranscriptFragments(accumulated: string, incoming: string): string {
  if (!accumulated) return incoming;
  if (!incoming) return accumulated;
  if (
    accumulated.endsWith(" ") ||
    incoming.startsWith(" ") ||
    /^[.,!?;:'")\]]/.test(incoming)
  ) {
    return `${accumulated}${incoming}`;
  }
  return `${accumulated} ${incoming}`;
}

export class GeminiConsultationLiveStream {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly silenceFlushMs: number;
  private readonly webSocketFactory?: (url: string) => MinimalWebSocket;

  private readonly partialListeners = new Set<(text: string) => void>();
  private readonly finalListeners = new Set<(text: string) => void>();
  private readonly statusListeners = new Set<(connected: boolean, detail?: string) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  private ws: MinimalWebSocket | null = null;
  private setupComplete = false;
  private stopping = false;
  private turnBuffer = "";
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunksSent = 0;
  private detachAudioSourceFn: (() => void) | null = null;
  private readonly textDecoder = new TextDecoder();

  constructor(options: GeminiConsultationLiveStreamOptions = {}) {
    this.apiKey = options.apiKey ?? env.geminiApiKey;
    this.model = options.model ?? env.geminiLiveModel;
    this.silenceFlushMs = Math.max(50, options.silenceFlushMs ?? DEFAULT_SILENCE_FLUSH_MS);
    this.webSocketFactory = options.webSocketFactory;

    if (options.onPartialTranscript) {
      this.partialListeners.add(options.onPartialTranscript);
    }
    if (options.onFinalTranscript) {
      this.finalListeners.add(options.onFinalTranscript);
    }
    if (options.onStatusChange) {
      this.statusListeners.add(options.onStatusChange);
    }
    if (options.onError) {
      this.errorListeners.add(options.onError);
    }
  }

  get isConnected(): boolean {
    return Boolean(this.ws && this.ws.readyState === WS_OPEN_STATE && this.setupComplete);
  }

  get isSetupComplete(): boolean {
    return this.setupComplete;
  }

  get chunksSent(): number {
    return this.audioChunksSent;
  }

  get currentTurnBuffer(): string {
    return this.turnBuffer;
  }

  onPartialTranscript(callback: (text: string) => void): () => void {
    this.partialListeners.add(callback);
    return () => {
      this.partialListeners.delete(callback);
    };
  }

  onFinalTranscript(callback: (text: string) => void): () => void {
    this.finalListeners.add(callback);
    return () => {
      this.finalListeners.delete(callback);
    };
  }

  onStatusChange(callback: (connected: boolean, detail?: string) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorListeners.add(callback);
    return () => {
      this.errorListeners.delete(callback);
    };
  }

  /**
   * Connects a `ConsultationAudioSource` directly so every emitted 16 kHz PCM
   * chunk streams to Gemini Live automatically.
   */
  attachAudioSource(source: ConsultationAudioSource): () => void {
    if (this.detachAudioSourceFn) {
      this.detachAudioSourceFn();
    }
    const unsubscribe = source.onAudioChunk((chunk) => {
      this.sendAudioChunk(chunk);
    });
    this.detachAudioSourceFn = unsubscribe;
    return () => {
      unsubscribe();
      if (this.detachAudioSourceFn === unsubscribe) {
        this.detachAudioSourceFn = null;
      }
    };
  }

  /**
   * Opens the Gemini Live BidiGenerateContent WebSocket and sends the initial
   * passive-listener `setup` payload.
   */
  async start(): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN_STATE) {
      return;
    }

    const key = this.apiKey?.trim();
    if (!key) {
      throw new Error("GEMINI_API_KEY is required to start GeminiConsultationLiveStream.");
    }

    this.stopping = false;
    this.setupComplete = false;
    this.turnBuffer = "";
    this.clearSilenceTimer();

    const normalizedModel = normalizeGeminiLiveModel(this.model);
    console.log(
      `[GEMINI:WS] Opening BidiGenerateContent WebSocket (model=${normalizedModel})...`,
    );

    const url = `${GEMINI_LIVE_WS_BASE_URL}?key=${encodeURIComponent(key)}`;
    const socket = this.createWebSocket(url);
    socket.binaryType = "arraybuffer";
    this.ws = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      socket.onopen = () => {
        try {
          const setupPayload = buildGeminiConsultationSetupMessage(this.model);
          socket.send(JSON.stringify(setupPayload));
          console.log("[GEMINI:WS] WebSocket open, sent setup payload.");
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("[GEMINI:WS:ERROR] Failed to send setup payload:", error.message);
          if (!settled) {
            settled = true;
            reject(error);
          } else {
            this.emitError(error);
          }
        }
      };

      socket.onmessage = (event: { data: unknown }) => {
        void this.handleIncomingRawData(event.data);
      };

      socket.onerror = (event: unknown) => {
        const message =
          event && typeof event === "object" && "message" in event && typeof event.message === "string"
            ? event.message
            : "Gemini Live WebSocket connection error.";
        console.error(`[GEMINI:WS:ERROR] ${message}`);
        const error = new Error(message);
        if (!settled) {
          settled = true;
          reject(error);
        } else if (!this.stopping) {
          this.emitError(error);
        }
      };

      socket.onclose = (event: { code?: number; reason?: string }) => {
        this.clearSilenceTimer();
        const wasConnected = this.setupComplete;
        this.setupComplete = false;
        const code = event?.code ?? 1000;
        const reason = event?.reason || `WebSocket closed (code ${code})`;

        if (!settled) {
          settled = true;
          const err = new Error(
            `Gemini Live WebSocket closed before open (code ${event?.code ?? "unknown"}: ${reason}).`,
          );
          console.error(`[GEMINI:WS:ERROR] ${err.message}`);
          reject(err);
          return;
        }

        if (!this.stopping) {
          if (!wasConnected || code !== 1000) {
            console.error(
              `[GEMINI:WS:ERROR] WebSocket closed (code=${code}, setupComplete=${wasConnected}): ${reason}`,
            );
            this.emitError(
              new Error(`Gemini Live WebSocket closed (code ${code}): ${reason}`),
            );
          }
          if (wasConnected) {
            this.emitStatus(false, reason);
          }
        }
      };
    });
  }

  /**
   * Streams a 16 kHz mono s16le PCM audio chunk to Gemini Live once `setupComplete`
   * has been acknowledged and the WebSocket is open.
   */
  sendAudioChunk(chunk: AudioChunkPayload): void {
    if (!this.setupComplete || !this.ws || this.ws.readyState !== WS_OPEN_STATE) {
      return;
    }
    if (!chunk?.pcm16le || chunk.pcm16le.length === 0) {
      return;
    }

    const frame = {
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: chunk.pcm16le.toString("base64"),
        },
      },
    };

    try {
      this.ws.send(JSON.stringify(frame));
      this.audioChunksSent += 1;
      if (this.audioChunksSent === 1 || this.audioChunksSent % 50 === 0) {
        console.log(
          `[GEMINI:AUDIO] Sent ${this.audioChunksSent} PCM chunks (16kHz mono) to Gemini Live.`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[GEMINI:WS:ERROR] Failed to send audio chunk:", error.message);
      this.emitError(error);
    }
  }

  /**
   * Flushes any accumulated transcript text in the current turn buffer immediately
   * as a finalized transcript segment.
   */
  flushTurnBuffer(): string | null {
    this.clearSilenceTimer();
    const text = this.turnBuffer.trim();
    this.turnBuffer = "";
    if (!text) {
      return null;
    }
    console.log(`[GEMINI:TRANSCRIPT:FINAL] "${text}"`);
    for (const listener of this.finalListeners) {
      listener(text);
    }
    return text;
  }

  /**
   * Clears timers, detaches any bound audio source, and closes the WebSocket cleanly.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearSilenceTimer();
    this.turnBuffer = "";
    this.setupComplete = false;

    if (this.detachAudioSourceFn) {
      this.detachAudioSourceFn();
      this.detachAudioSourceFn = null;
    }

    const socket = this.ws;
    this.ws = null;

    if (socket) {
      try {
        if (socket.readyState <= WS_OPEN_STATE) {
          socket.close(1000, "Consultation ended");
        }
      } catch {
        // Ignore close errors on already-closing sockets
      }
    }

    this.emitStatus(false, "Gemini Live stream stopped.");
  }

  /**
   * Parses and handles an incoming Gemini Live server message (`string`, `Buffer`,
   * `ArrayBuffer`, `Uint8Array`, or `Blob`).
   */
  async handleIncomingRawData(data: unknown): Promise<void> {
    let rawText: string;

    if (typeof data === "string") {
      rawText = data;
    } else if (Buffer.isBuffer(data)) {
      rawText = data.toString("utf8");
    } else if (data instanceof ArrayBuffer) {
      rawText = this.textDecoder.decode(data);
    } else if (ArrayBuffer.isView(data)) {
      rawText = this.textDecoder.decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    } else if (
      data &&
      typeof data === "object" &&
      "text" in data &&
      typeof (data as Blob).text === "function"
    ) {
      rawText = await (data as Blob).text();
    } else {
      return;
    }

    let message: GeminiLiveServerMessage;
    try {
      message = JSON.parse(rawText) as GeminiLiveServerMessage;
    } catch {
      return;
    }

    this.handleParsedServerMessage(message);
  }

  private handleParsedServerMessage(msg: GeminiLiveServerMessage): void {
    if (msg.error?.message) {
      console.error(`[GEMINI:WS:ERROR] Server error: ${msg.error.message}`);
      this.emitError(new Error(`Gemini Live error: ${msg.error.message}`));
    }

    if (msg.setupComplete !== undefined && !this.setupComplete) {
      this.setupComplete = true;
      console.log("[GEMINI:WS] setupComplete received! Ready to stream 16kHz PCM audio.");
      this.emitStatus(true, "Gemini Live setupComplete acknowledged.");
    }

    const content = msg.serverContent;
    if (!content) {
      return;
    }

    const fragment = content.inputTranscription?.text;
    if (typeof fragment === "string" && fragment.length > 0) {
      this.turnBuffer = joinTranscriptFragments(this.turnBuffer, fragment);
      const currentText = this.turnBuffer.trim();
      if (currentText.length > 0) {
        console.log(`[GEMINI:TRANSCRIPT:PARTIAL] "${currentText}"`);
        for (const listener of this.partialListeners) {
          listener(currentText);
        }
        this.scheduleSilenceFlush();
      }
    }

    if (
      content.turnComplete ||
      content.interrupted ||
      content.inputTranscription?.finished === true
    ) {
      this.flushTurnBuffer();
    }
  }

  private scheduleSilenceFlush(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.flushTurnBuffer();
    }, this.silenceFlushMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private createWebSocket(url: string): MinimalWebSocket {
    if (this.webSocketFactory) {
      return this.webSocketFactory(url);
    }
    const GlobalWebSocket = globalThis.WebSocket as unknown as
      | (new (endpoint: string) => MinimalWebSocket)
      | undefined;
    if (!GlobalWebSocket) {
      throw new Error("Global WebSocket is not available in this Node.js runtime.");
    }
    return new GlobalWebSocket(url);
  }

  private emitStatus(connected: boolean, detail?: string): void {
    for (const listener of this.statusListeners) {
      listener(connected, detail);
    }
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}
