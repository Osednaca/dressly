import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { chromium } from "playwright-core";
import { buildBrowserAudioCaptureInitScript } from "@/services/meeting-bot/audio-capture";
import { CHROMIUM_LAUNCH_ARGS, chromiumAudioOptions, resolveChromiumExecutable } from "@/services/meeting-bot/playwright-bot";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function audioHarness(useWorklet = false) {
  let now = 1000;
  const timers = new Map<number, () => void>();
  const chunks: Buffer[] = [];
  const readers = new Map<string, ReadableStreamDefaultController>();
  const fallbackNodes = new Map<string, any>();
  class Track extends EventTarget {
    kind = "audio";
    readyState = "live";
    muted = false;
    id: string;
    constructor(id: string) { super(); this.id = id; }
    end() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
  }
  class Stream {
    tracks: Track[];
    constructor(tracks: Track[]) { this.tracks = tracks; }
    getAudioTracks() { return this.tracks; }
  }
  class Node {
    disconnected = false;
    onaudioprocess: ((event: any) => void) | null = null;
    connect(_node: unknown) {}
    disconnect() { this.disconnected = true; }
  }
  class AudioContext {
    audioWorklet = useWorklet ? { addModule: async () => {} } : undefined;
    sampleRate = 16000;
    state = "running";
    destination = new Node();
    createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
    createScriptProcessor() { return new Node(); }
    createMediaStreamSource(stream: Stream) {
      const source = new Node();
      source.connect = (node: unknown) => { fallbackNodes.set(stream.tracks[0]!.id, node); };
      return source;
    }
  }
  const sandbox: any = {
    AudioContext, MediaStream: Stream, Date: { now: () => now },
    Blob, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    AudioWorkletNode: class extends Node { port = { onmessage: null as any, close() {} }; },
    setInterval: (cb: () => void, ms: number) => timers.set(ms, cb),
    console: { log() {} },
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    __dresslyPushAudioChunk: (chunk: string) => chunks.push(Buffer.from(chunk, "base64")),
    MediaStreamTrackProcessor: class {
      readable: ReadableStream;
      constructor({ track }: { track: Track }) {
        this.readable = new ReadableStream({ start: (controller) => readers.set(track.id, controller) });
      }
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(buildBrowserAudioCaptureInitScript(), sandbox);
  return {
    chunks, sandbox, fallbackNodes, readers,
    async track(id: string) {
      const track = new Track(id);
      new AudioContext().createMediaStreamSource(new Stream([track]));
      await flush();
      return track;
    },
    async frame(id: string, value: number, unsupported = false) {
      readers.get(id)!.enqueue({
        sampleRate: 16000, numberOfFrames: 1600, numberOfChannels: 1, format: "f32-planar",
        copyTo(target: Float32Array) { if (unsupported) throw new Error("bad layout"); target.fill(value); },
        close() {},
      });
      await flush();
    },
    fallback(id: string, value: number) {
      const node = fallbackNodes.get(id)!;
      if (useWorklet) node.port.onmessage({ data: new Int16Array(1600).fill(value * 32768).buffer });
      else node.onaudioprocess?.({ inputBuffer: {
          numberOfChannels: 1, getChannelData: () => new Float32Array(1600).fill(value),
        } });
    },
    tick(ms = 100) { now += ms; timers.get(100)!(); return chunks.at(-1)!; },
  };
}

function assertLevel(chunk: Buffer, expected: number) {
  assert.equal(chunk.length, 3200);
  for (let i = 0; i < chunk.length; i += 2) {
    assert.ok(Math.abs(chunk.readInt16LE(i) / 32768 - expected) < 0.001);
  }
}

for (const useWorklet of [false, true]) {
  test(`audio routes independently without duplication (${useWorklet ? "worklet" : "script"})`, async () => {
    const h = audioHarness(useWorklet);
    await h.track("processor");
    await h.track("fallback");
    await h.frame("processor", 0.25);
    h.fallback("processor", 0.25);
    h.fallback("fallback", 0.125);
    assertLevel(h.tick(), 0.375);
    // The duplicate discovery hooks must not register a second source for a track.
    assert.equal(h.sandbox.__dresslyGetAudioDiagnostics().tappedTracksCount, 2);
  });

  for (const failure of ["error", "done", "unsupported", "stall"] as const) {
    test(`audio recovers after processor ${failure} (${useWorklet ? "worklet" : "script"})`, async () => {
      const h = audioHarness(useWorklet);
      const track = await h.track("speech");
      await h.frame("speech", 0.25);
      assertLevel(h.tick(), 0.25);
      if (failure === "error") h.readers.get("speech")!.error(new Error("decoder failed"));
      if (failure === "done") h.readers.get("speech")!.close();
      if (failure === "unsupported") await h.frame("speech", 0.25, true);
      if (failure === "stall") h.tick(400);
      await flush();
      h.fallback("speech", 0.125);
      assertLevel(h.tick(), 0.125);
      if (failure === "stall") {
        // Resuming the processor replaces queued fallback rather than replaying both.
        h.fallback("speech", 0.125);
        await h.frame("speech", 0.5);
        h.fallback("speech", 0.125);
        assertLevel(h.tick(), 0.5);
      }
      track.end();
      await flush();
      assert.equal(h.sandbox.__dresslyGetAudioDiagnostics().tappedTracksCount, 0);
      assert.equal(h.fallbackNodes.get("speech").disconnected, true);
      const count = h.chunks.length;
      h.tick();
      assert.equal(h.chunks.length, count);
    });
  }
}

test("Chromium output is muted for WebRTC capture but remains routed for PulseAudio", () => {
  const webrtc = chromiumAudioOptions("webrtc-tap");
  const pulse = chromiumAudioOptions("pulseaudio");
  assert.deepEqual(webrtc.args, ["--mute-audio"]);
  assert.ok(!webrtc.ignoreDefaultArgs.includes("--mute-audio"));
  assert.deepEqual(pulse.args, []);
  assert.ok(pulse.ignoreDefaultArgs.includes("--mute-audio"));
});

for (const forceFallback of [false, true]) {
  test(`isolated Chromium captures muted remote WebRTC (${forceFallback ? "fallback" : "automatic"})`, {
    skip: process.env.RUN_AUDIO_CHROMIUM_TEST !== "1",
  }, async (t) => {
    const executablePath = resolveChromiumExecutable();
    assert.ok(executablePath, "Local Chromium is required for this opt-in test");
    const audioOptions = chromiumAudioOptions("webrtc-tap");
    const browser = await chromium.launch({
      ...audioOptions,
      executablePath, headless: true,
      args: [...CHROMIUM_LAUNCH_ARGS, ...audioOptions.args],
    });
    try {
      // launch() owns a disposable profile. Never use the authenticated bot profile.
      const context = await browser.newContext();
      const chunks: Buffer[] = [];
      const captureLogs: string[] = [];
      await context.exposeBinding("__dresslyBotLog", (_source, message: string) => {
        captureLogs.push(message);
      });
      await context.exposeBinding("__dresslyPushAudioChunk", (_source, pcm: string) => {
        chunks.push(Buffer.from(pcm, "base64"));
      });
      if (forceFallback) {
        await context.addInitScript("window.MediaStreamTrackProcessor = undefined");
      }
      await context.addInitScript(buildBrowserAudioCaptureInitScript());
      const page = await context.newPage();
      await page.goto("chrome://version");
      const commandLine = await page.locator("#command_line").innerText();
      assert.match(commandLine, /(?:^|\s)--mute-audio(?:\s|$)/, "Effective Chromium arguments must retain speaker muting");
      await page.goto("about:blank");
      await page.evaluate(async () => {
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const destination = ctx.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        await ctx.resume();
        const sender = new RTCPeerConnection({ iceServers: [] });
        const receiver = new RTCPeerConnection({ iceServers: [] });
        sender.onicecandidate = (event) => { if (event.candidate) void receiver.addIceCandidate(event.candidate); };
        receiver.onicecandidate = (event) => { if (event.candidate) void sender.addIceCandidate(event.candidate); };
        receiver.ontrack = () => {};
        sender.addTrack(destination.stream.getAudioTracks()[0]!, destination.stream);
        await sender.setLocalDescription(await sender.createOffer());
        await receiver.setRemoteDescription(sender.localDescription!);
        await receiver.setLocalDescription(await receiver.createAnswer());
        await sender.setRemoteDescription(receiver.localDescription!);
        Object.assign(window, { __audioTest: { ctx, oscillator, sender, receiver } });
      });
      const deadline = Date.now() + 10000;
      const hasSignal = () => chunks.filter((chunk) => {
        for (let i = 0; i < chunk.length; i += 2) if (Math.abs(chunk.readInt16LE(i)) > 100) return true;
        return false;
      }).length >= 5;
      while (!hasSignal() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(hasSignal(), "Muted bot must still capture multiple non-silent PCM frames from remote WebRTC");
      const processorHasSignal = captureLogs.some((message) => message.includes("Non-silent audio energy detected on track"));
      if (forceFallback) assert.equal(processorHasSignal, false);
      t.diagnostic(`Verified non-silent capture route: ${processorHasSignal ? "MediaStreamTrackProcessor" : "WebAudio fallback"}`);
      assert.ok(chunks.every((chunk) => chunk.length === 3200));
      const volumes = await page.locator("audio").evaluateAll((elements) => elements.map((el) => (el as HTMLAudioElement).volume));
      assert.ok(volumes.length > 0, "Remote track has an auxiliary playback element");
      assert.ok(volumes.every((volume) => volume === 0));
    } finally {
      await browser.close();
    }
  });
}
