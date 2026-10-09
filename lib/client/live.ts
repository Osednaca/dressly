/**
 * Browser side of the Gemini Live stylist.
 *
 * One WebSocket straight to Google (authorised by a single-use token from our server),
 * the microphone streamed in as 16 kHz PCM16, the stylist's voice played back from
 * 24 kHz PCM16. Tool calls are handed to the app, which runs the real styling turn.
 */

const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;

/** Mic capture: average down to 16 kHz and post ~100 ms PCM16 chunks. */
const CAPTURE_WORKLET = `
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${INPUT_RATE};
    this.acc = 0; this.sum = 0; this.n = 0; this.out = [];
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i]; this.n += 1; this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        this.out.push(this.sum / this.n);
        this.sum = 0; this.n = 0;
      }
    }
    if (this.out.length >= ${INPUT_RATE / 10}) {
      const pcm = new Int16Array(this.out.length);
      for (let i = 0; i < this.out.length; i++) {
        pcm[i] = Math.max(-1, Math.min(1, this.out[i])) * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this.out = [];
    }
    return true;
  }
}
registerProcessor("pcm16-capture", Pcm16Capture);
`;

export type LiveStatus = "idle" | "connecting" | "live" | "error";

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveHandlers {
  onStatus: (status: LiveStatus, detail?: string) => void;
  /** Running caption for the current turn; `final` once the turn is over. */
  onTranscript: (role: "user" | "dressly", text: string) => void;
  onToolCall: (call: LiveToolCall) => Promise<Record<string, unknown>>;
}

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] };
  goAway?: unknown;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(data: string): Int16Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

export class LiveStylist {
  private ws: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private micContext: AudioContext | null = null;
  private playContext: AudioContext | null = null;
  private playHead = 0;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private userText = "";
  private dresslyText = "";
  private closed = false;

  constructor(private readonly handlers: LiveHandlers) {}

  /** Must be called from a user gesture so audio playback is allowed to start. */
  async start(token: string, model: string, greeting: string): Promise<void> {
    this.handlers.onStatus("connecting");
    this.playContext = new AudioContext({ sampleRate: OUTPUT_RATE });
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      this.stop();
      throw new Error(
        error instanceof DOMException && error.name === "NotFoundError"
          ? "No microphone was found."
          : "Microphone access is blocked. Allow it for this site in your browser settings.",
      );
    }

    const ws = new WebSocket(`${LIVE_URL}?access_token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    const decoder = new TextDecoder();

    ws.onopen = () => ws.send(JSON.stringify({ setup: { model } }));
    ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : decoder.decode(event.data as ArrayBuffer);
      let message: ServerMessage;
      try {
        message = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      if (message.setupComplete) {
        void this.startMic();
        this.send({ realtimeInput: { text: greeting } });
        this.handlers.onStatus("live");
      }
      if (message.serverContent) this.handleContent(message.serverContent);
      if (message.toolCall?.functionCalls) void this.handleToolCalls(message.toolCall.functionCalls);
    };
    ws.onerror = () => {
      if (!this.closed) this.handlers.onStatus("error", "Lost the connection to the live stylist.");
    };
    ws.onclose = (event) => {
      if (this.closed) return;
      const detail = event.code === 1000 ? undefined : event.reason || "The live session ended.";
      this.stop();
      this.handlers.onStatus(detail ? "error" : "idle", detail);
    };
  }

  /** Something the shopper typed while live. */
  sendText(text: string): void {
    this.send({ realtimeInput: { text } });
  }

  /** An app event the stylist should react to (e.g. a finished try-on). */
  notify(text: string): void {
    this.send({ realtimeInput: { text: `[fitting room] ${text}` } });
  }

  stop(): void {
    this.closed = true;
    this.stopPlayback();
    this.micStream?.getTracks().forEach((track) => track.stop());
    void this.micContext?.close();
    void this.playContext?.close();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
    this.ws = null;
    this.micStream = null;
    this.micContext = null;
    this.playContext = null;
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private async startMic(): Promise<void> {
    if (!this.micStream) return;
    const context = new AudioContext();
    this.micContext = context;
    const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    if (this.closed) return;
    const node = new AudioWorkletNode(context, "pcm16-capture");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.send({
        realtimeInput: { audio: { data: toBase64(event.data), mimeType: `audio/pcm;rate=${INPUT_RATE}` } },
      });
    };
    context.createMediaStreamSource(this.micStream).connect(node);
  }

  private handleContent(content: NonNullable<ServerMessage["serverContent"]>): void {
    if (content.interrupted) this.stopPlayback();
    if (content.inputTranscription?.text) {
      this.userText += content.inputTranscription.text;
      this.handlers.onTranscript("user", this.userText.trim());
    }
    if (content.outputTranscription?.text) {
      this.dresslyText += content.outputTranscription.text;
      this.handlers.onTranscript("dressly", this.dresslyText.trim());
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.play(fromBase64(part.inlineData.data));
    }
    if (content.turnComplete || content.interrupted) {
      this.userText = "";
      this.dresslyText = "";
    }
  }

  private play(pcm: Int16Array): void {
    const context = this.playContext;
    if (!context || pcm.length === 0) return;
    const buffer = context.createBuffer(1, pcm.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) channel[index] = (pcm[index] ?? 0) / 0x8000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.playHead = Math.max(this.playHead, context.currentTime);
    source.start(this.playHead);
    this.playHead += buffer.duration;
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
  }

  /** Barge-in: the shopper spoke over the stylist, so drop whatever is still queued. */
  private stopPlayback(): void {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.playing.clear();
    this.playHead = 0;
  }

  private async handleToolCalls(calls: { id: string; name: string; args?: Record<string, unknown> }[]) {
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        try {
          const result = await this.handlers.onToolCall({ id: call.id, name: call.name, args: call.args ?? {} });
          return { id: call.id, name: call.name, response: { result } };
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            response: { error: error instanceof Error ? error.message : "The styling engine failed." },
          };
        }
      }),
    );
    this.send({ toolResponse: { functionResponses } });
  }
}
