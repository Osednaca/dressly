/**
 * Replaceable Consultation Audio Provider Abstraction (`ConsultationAudioSource`).
 *
 * Architectural Note — Official Google Meet Media API Drop-In Path:
 * Dressly decouples meeting audio ingestion from downstream speech transcription
 * (Gemini Live), semantic modification extraction (Gemini Flash), decision-making
 * (JEV SystemOne), product generation (Runway Nano Banana 2.1), and virtual try-on
 * (YouCam S2S v2.0).
 *
 * Today, `ChromeMeetAudioSource` (`providerName: "chrome-meet-playwright"`) captures
 * remote Google Meet audio output from an isolated Playwright + Chromium bot session,
 * while `SimulatedMeetAudioSource` (`providerName: "simulated"`) emits deterministic
 * 16 kHz mono s16le PCM frames for automated tests and `/bot/diagnostics/audio`.
 *
 * When migrating to Google Workspace's official Google Meet Media API (WebRTC media
 * channels / Cloud RTP audio streams), a future `GoogleMeetMediaApiAudioSource`
 * (`providerName: "google-meet-media-api"`) implements this exact
 * `ConsultationAudioSource` interface — negotiating the Meet Media API WebRTC Data/Audio
 * channels, decoding Opus RTP packets into `16 kHz mono s16le` `Buffer` frames, and
 * invoking `onAudioChunk` — with zero changes required in `GeminiConsultationLiveStream`,
 * the Next.js consultation orchestrator, JEV, Runway, or YouCam.
 */

export const PCM_SAMPLE_RATE = 16000 as const;
export const PCM_CHANNELS = 1 as const;
export const PCM_BYTES_PER_SAMPLE = 2 as const;
export const PCM_FRAME_DURATION_MS = 100 as const;
export const PCM_SAMPLES_PER_FRAME = 1600 as const; // 16000 Hz * 0.1s
export const PCM_FRAME_BYTES = 3200 as const; // 1600 samples * 2 bytes (s16le)

export interface AudioChunkPayload {
  pcm16le: Buffer;
  sampleRate: 16000;
  channels: 1;
  timestampMs: number;
}

export interface ConsultationAudioSource {
  readonly providerName: "chrome-meet-playwright" | "google-meet-media-api" | "simulated";
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudioChunk(callback: (chunk: AudioChunkPayload) => void): () => void;
  onStatusChange?(callback: (status: string, detail?: string) => void): () => void;
}

export interface SimulatedMeetAudioSourceOptions {
  /** Interval in ms between emitted PCM frames. Defaults to 100ms (3200 bytes at 16 kHz). */
  intervalMs?: number;
  /** Frequency in Hz of the deterministic test sine wave. Defaults to 440 Hz. */
  frequencyHz?: number;
  /** Optional custom PCM frame Buffer to emit instead of a generated sine wave. */
  customFrame?: Buffer;
  /** Emit an initial frame immediately when `start()` is called. Defaults to true. */
  emitImmediately?: boolean;
}

/**
 * Generates a deterministic 16 kHz mono 16-bit signed little-endian (s16le) PCM buffer
 * containing a clean low-amplitude sine wave for pipeline verification.
 */
export function generateSinePcm16leFrame(
  frequencyHz = 440,
  sampleCount: number = PCM_SAMPLES_PER_FRAME,
  frameIndex = 0,
): Buffer {
  const buffer = Buffer.alloc(sampleCount * PCM_BYTES_PER_SAMPLE);
  const amplitude = 0.25 * 0x7fff;
  const sampleOffset = frameIndex * sampleCount;

  for (let i = 0; i < sampleCount; i += 1) {
    const t = (sampleOffset + i) / PCM_SAMPLE_RATE;
    const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * t) * amplitude);
    buffer.writeInt16LE(sample, i * PCM_BYTES_PER_SAMPLE);
  }

  return buffer;
}

/**
 * Deterministic 16 kHz mono s16le PCM audio source for unit tests and
 * `/bot/diagnostics/audio` health checks without requiring a live human speaker.
 */
export class SimulatedMeetAudioSource implements ConsultationAudioSource {
  readonly providerName = "simulated" as const;

  private readonly intervalMs: number;
  private readonly frequencyHz: number;
  private readonly customFrame: Buffer | undefined;
  private readonly emitImmediately: boolean;

  private readonly chunkListeners = new Set<(chunk: AudioChunkPayload) => void>();
  private readonly statusListeners = new Set<(status: string, detail?: string) => void>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private frameCounter = 0;
  private totalChunksEmitted = 0;
  private totalBytesEmitted = 0;

  constructor(options: SimulatedMeetAudioSourceOptions = {}) {
    this.intervalMs = Math.max(10, options.intervalMs ?? PCM_FRAME_DURATION_MS);
    this.frequencyHz = options.frequencyHz ?? 440;
    this.customFrame = options.customFrame;
    this.emitImmediately = options.emitImmediately ?? true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get chunksEmitted(): number {
    return this.totalChunksEmitted;
  }

  get bytesEmitted(): number {
    return this.totalBytesEmitted;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emitStatus("LISTENING", "Simulated 16 kHz mono s16le PCM audio source started.");

    if (this.emitImmediately) {
      this.emitNextFrame();
    }

    this.timer = setInterval(() => {
      if (!this.running) return;
      this.emitNextFrame();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.running) return;
    this.running = false;
    this.emitStatus("STOPPED", "Simulated audio source stopped.");
  }

  onAudioChunk(callback: (chunk: AudioChunkPayload) => void): () => void {
    this.chunkListeners.add(callback);
    return () => {
      this.chunkListeners.delete(callback);
    };
  }

  onStatusChange(callback: (status: string, detail?: string) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /**
   * Manually emits a single deterministic 16 kHz mono s16le PCM frame.
   */
  emitNextFrame(overrideBuffer?: Buffer): AudioChunkPayload {
    const pcm16le = overrideBuffer
      ? Buffer.from(overrideBuffer)
      : this.customFrame
        ? Buffer.from(this.customFrame)
        : generateSinePcm16leFrame(this.frequencyHz, PCM_SAMPLES_PER_FRAME, this.frameCounter);

    this.frameCounter += 1;
    this.totalChunksEmitted += 1;
    this.totalBytesEmitted += pcm16le.length;

    const payload: AudioChunkPayload = {
      pcm16le,
      sampleRate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      timestampMs: Date.now(),
    };

    for (const listener of this.chunkListeners) {
      listener(payload);
    }

    return payload;
  }

  private emitStatus(status: string, detail?: string): void {
    for (const listener of this.statusListeners) {
      listener(status, detail);
    }
  }
}
