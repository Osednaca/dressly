import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { env } from "@/lib/env";
import type { MeetingBotStatus } from "@/lib/types";
import { nowIso } from "@/lib/util/id";
import {
  buildBrowserAudioCaptureInitScript,
  ChromeMeetAudioSource,
} from "@/services/meeting-bot/audio-capture";
import {
  SimulatedMeetAudioSource,
  type AudioChunkPayload,
  type ConsultationAudioSource,
} from "@/services/meeting-bot/audio-source";
import {
  DEFAULT_BOT_DISPLAY_NAME,
  MEETING_BOT_SECRET_HEADER,
  type AudioBackendMode,
  type BotSessionSnapshot,
  type BotWebhookEvent,
  type StartBotSessionRequest,
} from "@/services/meeting-bot/contract";
import { GeminiConsultationLiveStream } from "@/services/meeting-bot/gemini-stream";

/**
 * Playwright + Chromium Google Meet Bot Controller (`services/meeting-bot/playwright-bot.ts`).
 *
 * Transparency & Compliance Guarantees:
 * - Joins Google Meet visibly as "Dressly AI Assistant" (`DEFAULT_BOT_DISPLAY_NAME`).
 * - Zero stealth plugins, zero CAPTCHA bypass, zero hidden participation.
 * - Joins strictly as a silent passive listener (camera & microphone muted at both
 *   the WebRTC `getUserMedia` track level and the Google Meet pre-join UI level).
 * - Guarantees zero orphan Chromium or FFmpeg processes on `stop()`.
 */

export const CHROMIUM_LAUNCH_ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=AudioServiceOutOfProcess",
] as const;

const POLL_INTERVAL_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 2;
const RECONNECT_BACKOFF_MS = [3000, 6000] as const;

const LEAVE_CALL_SELECTOR =
  '[aria-label*="Leave call" i], [aria-label*="Salir de la llamada" i], [aria-label*="Abandonar la llamada" i]';

const LOBBY_TEXT_RE =
  /Asking to be let in|Someone in the call will let you in soon|Wait until a meeting host brings you into the call|You'll join the call when someone lets you in|Solicitando unirse|Alguien de la llamada te dará acceso pronto|Un anfitrión te permitirá unirte pronto/i;

const ENTRY_BLOCKED_TEXT_RE =
  /You can't join this video call|No puedes unirte a esta videollamada|Check your meeting code|Invalid video call name|Sign in to join this meeting|Inicia sesión para unirte/i;

const CALL_ENDED_TEXT_RE =
  /You've left the meeting|Return to home screen|You were removed from the meeting|The call ended|Has salido de la reunión|Volver a la pantalla de inicio|Te han quitado de la reunión|La llamada ha terminado/i;

function findInSystemPath(binaryName: string): string | null {
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    const stdout = execFileSync(locator, [binaryName], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {
    // Binary not found in system PATH
  }
  return null;
}

function getPlaywrightCacheRoots(): string[] {
  const roots: string[] = [];
  const home = os.homedir();

  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }

  if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA) {
      roots.push(path.join(process.env.LOCALAPPDATA, "ms-playwright"));
    }
    roots.push(path.join(home, "AppData", "Local", "ms-playwright"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Caches", "ms-playwright"));
  } else {
    roots.push(path.join(home, ".cache", "ms-playwright"));
  }

  return roots;
}

/**
 * Resolves a local Chrome / Chromium / Edge executable across:
 *   1. `env.chromiumExecutablePath` (`process.env.CHROMIUM_EXECUTABLE_PATH`) if present on disk.
 *   2. Standard system paths (official Google Chrome preferred over unbranded Chromium / CfT).
 *   3. System PATH (`google-chrome`, `chrome`, `chromium-browser`, `chromium`, `msedge`).
 *   4. Playwright's local browser cache (`ms-playwright/chromium-*`).
 */
export function resolveChromiumExecutable(): string | null {
  const configured = process.env.CHROMIUM_EXECUTABLE_PATH?.trim() || env.chromiumExecutablePath;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const systemCandidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
          ];

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const bin of ["google-chrome", "google-chrome-stable", "chrome", "chromium-browser", "chromium", "msedge"]) {
    const found = findInSystemPath(bin);
    if (found) {
      return found;
    }
  }

  const cacheRelativePaths =
    process.platform === "win32"
      ? [
          path.join("chrome-win64", "chrome.exe"),
          path.join("chrome-win", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? [
            path.join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
            path.join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
            path.join("chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
          ]
        : [
            path.join("chrome-linux", "chrome"),
            path.join("chrome-linux64", "chrome"),
          ];

  for (const root of getPlaywrightCacheRoots()) {
    if (!fs.existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(root)
        .filter((name) => name.startsWith("chromium-"))
        .sort()
        .reverse();
    } catch {
      continue;
    }

    for (const dirName of entries) {
      for (const relPath of cacheRelativePaths) {
        const candidate = path.join(root, dirName, relPath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  try {
    const pwDefault = chromium.executablePath();
    if (pwDefault && fs.existsSync(pwDefault)) {
      return pwDefault;
    }
  } catch {
    // Ignore if Playwright default browser is not installed
  }

  return null;
}

/**
 * Outgoing media mute guard injected into the Chromium context so any tracks
 * returned by `navigator.mediaDevices.getUserMedia` have `enabled = false`.
 */
export function buildOutgoingMediaMuteInitScript(): string {
  return `
(function muteDresslyOutgoingMedia() {
  if (window.__dresslyOutgoingMuteInstalled) return;
  window.__dresslyOutgoingMuteInstalled = true;

  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function patchedGetUserMedia(constraints) {
      const stream = await origGetUserMedia(constraints);
      if (stream && typeof stream.getTracks === "function") {
        for (const track of stream.getTracks()) {
          track.enabled = false;
        }
      }
      return stream;
    };
  }
})();
`;
}

function sanitizeProfileSubdir(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return cleaned.length > 0 ? cleaned : "default";
}

/**
 * Resolves the persistent Chromium user-data directory for the Google Meet bot.
 * Uses the shared root `data/bot-profile` (`env.meetingBotProfileDir`) by default so
 * Google authentication saved via `npm run bot:login` persists across all consultation
 * sessions. Falls back to a session-scoped subdirectory only when `SingletonLock`
 * indicates another Chromium instance is actively holding the shared profile.
 */
export function resolveBotProfileDir(consultationSessionId: string): string {
  const sharedRoot = path.resolve(process.cwd(), env.meetingBotProfileDir);
  fs.mkdirSync(sharedRoot, { recursive: true });
  const singletonLock = path.join(sharedRoot, "SingletonLock");
  if (fs.existsSync(singletonLock)) {
    const fallbackDir = path.resolve(
      sharedRoot,
      sanitizeProfileSubdir(consultationSessionId),
    );
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
  return sharedRoot;
}

export class PlaywrightMeetBotSession {
  readonly consultationSessionId: string;
  readonly meetingUrl: string;
  readonly botDisplayName: string;
  readonly callbackUrl: string;
  readonly requestedAudioBackend: AudioBackendMode;
  readonly requestedHeadless?: boolean;

  private status: MeetingBotStatus = "STARTING";
  private effectiveAudioBackend: string;
  private chunksCaptured = 0;
  private bytesCaptured = 0;
  private geminiConnected = false;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private readonly startedAt: string = nowIso();

  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private audioSource: ConsultationAudioSource | null = null;
  private geminiStream: GeminiConsultationLiveStream | null = null;
  private detachAudioChunkListener: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private inCallPipelineStarted = false;
  private reconnectingInFlight = false;
  private joinClicked = false;

  constructor(req: StartBotSessionRequest) {
    this.consultationSessionId = req.consultationSessionId;
    this.meetingUrl = req.meetingUrl.trim();
    this.botDisplayName = req.botDisplayName?.trim() || DEFAULT_BOT_DISPLAY_NAME;
    this.callbackUrl = req.callbackUrl.trim();
    this.requestedAudioBackend = req.audioBackend ?? env.meetingAudioBackend;
    this.requestedHeadless = req.headless;
    this.effectiveAudioBackend = this.isSimulatedMode()
      ? "simulated"
      : this.requestedAudioBackend === "auto"
        ? "webrtc-tap"
        : this.requestedAudioBackend;
  }

  isSimulatedMode(): boolean {
    if (this.meetingUrl.startsWith("demo://")) return true;
    if (this.requestedAudioBackend === "simulated") return true;
    if (
      this.meetingUrl.endsWith("/drs-live-bag") &&
      (this.requestedAudioBackend as string) === "simulated"
    ) {
      return true;
    }
    return false;
  }

  getSnapshot(): BotSessionSnapshot {
    const headless = this.requestedHeadless ?? env.meetingBotHeadless;
    return {
      consultationSessionId: this.consultationSessionId,
      meetingUrl: this.meetingUrl,
      botDisplayName: this.botDisplayName,
      status: this.status,
      audioBackend: this.effectiveAudioBackend,
      headless,
      chunksCaptured: this.chunksCaptured,
      bytesCaptured: this.bytesCaptured,
      geminiConnected: this.geminiConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<BotSessionSnapshot> {
    if (this.stopped) {
      return this.getSnapshot();
    }

    if (this.isSimulatedMode()) {
      await this.startSimulatedFlow();
      return this.getSnapshot();
    }

    await this.startRealMeetFlow();
    return this.getSnapshot();
  }

  async reconnect(): Promise<BotSessionSnapshot> {
    if (this.stopped) {
      return this.getSnapshot();
    }

    this.clearTimers();
    await this.stopAudioAndGemini();
    await this.cleanupBrowser();

    this.reconnectAttempts += 1;
    this.inCallPipelineStarted = false;
    this.joinClicked = false;
    await this.transitionStatus("RECONNECTING", {
      detail: `Reconnecting ${this.botDisplayName} to Google Meet (attempt ${this.reconnectAttempts})`,
    });

    if (this.isSimulatedMode()) {
      await this.startSimulatedFlow();
    } else {
      await this.startRealMeetFlow();
    }

    return this.getSnapshot();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopped = true;
    this.stopPromise = (async () => {
      this.clearTimers();
      await this.stopAudioAndGemini();
      await this.cleanupBrowser(true);
      this.status = "STOPPED";
      await this.postWebhook({
        type: "bot.status",
        consultationSessionId: this.consultationSessionId,
        status: "STOPPED",
        detail: `${this.botDisplayName} stopped and cleaned up`,
        timestamp: nowIso(),
      });
    })();

    return this.stopPromise;
  }

  private async startSimulatedFlow(): Promise<void> {
    this.effectiveAudioBackend = "simulated";

    await this.transitionStatus("OPENING_MEET", {
      detail: `${this.botDisplayName} opening simulated consultation session`,
    });
    if (this.stopped) return;

    await this.transitionStatus("JOINED", {
      detail: `${this.botDisplayName} joined consultation`,
    });
    if (this.stopped) return;

    const simSource = new SimulatedMeetAudioSource({
      intervalMs: 100,
      emitImmediately: true,
    });
    this.audioSource = simSource;
    this.attachChunkCounter(simSource);
    await simSource.start();

    await this.transitionStatus("LISTENING", {
      detail: `${this.botDisplayName} listening to consultation`,
      error: null,
    });
  }

  private async startRealMeetFlow(): Promise<void> {
    const executablePath = resolveChromiumExecutable();
    if (!executablePath) {
      const message =
        "Chromium executable was not found. Set CHROMIUM_EXECUTABLE_PATH or install Google Chrome / Playwright Chromium.";
      await this.transitionStatus("FAILED", {
        detail: message,
        error: message,
      });
      await this.postWebhook({
        type: "bot.error",
        consultationSessionId: this.consultationSessionId,
        message,
        recoverable: false,
        timestamp: nowIso(),
      });
      return;
    }

    await this.transitionStatus("OPENING_MEET", {
      detail: `Launching ${this.botDisplayName} and opening Google Meet`,
    });

    const sharedRoot = path.resolve(process.cwd(), env.meetingBotProfileDir);
    const profileDir = resolveBotProfileDir(this.consultationSessionId);
    const headless = this.requestedHeadless ?? env.meetingBotHeadless;
    const launchArgs = headless
      ? [...CHROMIUM_LAUNCH_ARGS, "--headless=new"]
      : [...CHROMIUM_LAUNCH_ARGS];

    const chromeAudioSource = new ChromeMeetAudioSource({
      consultationSessionId: this.consultationSessionId,
      backend:
        this.requestedAudioBackend === "pulseaudio"
          ? "pulseaudio"
          : this.requestedAudioBackend === "webrtc-tap"
            ? "webrtc-tap"
            : "auto",
    });
    this.effectiveAudioBackend = chromeAudioSource.backend;
    this.audioSource = chromeAudioSource;
    this.attachChunkCounter(chromeAudioSource);

    try {
      const launchEnv: Record<string, string | undefined> = {
        ...process.env,
      };
      if (chromeAudioSource.backend === "pulseaudio") {
        launchEnv.PULSE_SINK = chromeAudioSource.sinkName;
      }

      const launchOptions = {
        executablePath,
        headless,
        args: launchArgs,
        ignoreDefaultArgs: ["--mute-audio", "--enable-automation"],
        env: launchEnv as Record<string, string>,
      };

      let context: BrowserContext;
      try {
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
      } catch (launchErr) {
        if (profileDir === sharedRoot) {
          const fallbackProfileDir = path.resolve(
            sharedRoot,
            sanitizeProfileSubdir(this.consultationSessionId),
          );
          fs.mkdirSync(fallbackProfileDir, { recursive: true });
          context = await chromium.launchPersistentContext(fallbackProfileDir, launchOptions);
        } else {
          throw launchErr;
        }
      }

      if (this.stopped) {
        await context.close().catch(() => {});
        return;
      }

      this.context = context;
      await context.addInitScript(buildOutgoingMediaMuteInitScript());
      await context.addInitScript(buildBrowserAudioCaptureInitScript());
      await context.exposeBinding(
        "__dresslyPushAudioChunk",
        (_source: unknown, base64Pcm: string) => {
          if (typeof base64Pcm === "string" && base64Pcm.length > 0) {
            chromeAudioSource.pushBase64PcmChunk(base64Pcm);
          }
        },
      );

      const page = context.pages()[0] ?? (await context.newPage());
      this.page = page;

      page.on("crash", () => {
        if (!this.stopped) {
          void this.handleUnexpectedDisconnect("Google Meet browser tab crashed.");
        }
      });

      page.on("close", () => {
        if (!this.stopped) {
          void this.handleUnexpectedDisconnect("Google Meet browser tab closed.");
        }
      });

      this.joinClicked = false;
      await page.goto(this.meetingUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      if (this.stopped) return;

      await this.tryPreJoinStep(page);
      this.startMeetStatePoller(page, chromeAudioSource);
    } catch (err) {
      if (this.stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      await this.handleUnexpectedDisconnect(`Failed to open Google Meet: ${message}`);
    }
  }

  private async tryPreJoinStep(page: Page): Promise<void> {
    if (this.stopped || this.joinClicked) return;

    try {
      // 1. Dismiss any pre-join permission/device banner if visible (EN / ES)
      const dismissSelectors = [
        'button:has-text("Continue without microphone and camera")',
        'button:has-text("Continuar sin micrófono ni cámara")',
        'button:has-text("Dismiss")',
        'button:has-text("Got it")',
        'button:has-text("Entendido")',
      ];
      for (const selector of dismissSelectors) {
        const bannerBtn = page.locator(selector).first();
        if (await bannerBtn.isVisible().catch(() => false)) {
          await bannerBtn.click({ timeout: 1000 }).catch(() => {});
        }
      }

      // 2. Mute microphone and camera toggles on the Google Meet pre-join screen if currently unmuted (EN / ES)
      const muteToggleGroups = [
        '[data-is-muted="false"][aria-label*="microphone" i], [data-is-muted="false"][aria-label*="micrófono" i], [aria-label*="Turn off microphone" i], [aria-label*="Desactivar micrófono" i]',
        '[data-is-muted="false"][aria-label*="camera" i], [data-is-muted="false"][aria-label*="cámara" i], [aria-label*="Turn off camera" i], [aria-label*="Desactivar cámara" i]',
      ];
      for (const selector of muteToggleGroups) {
        const toggle = page.locator(selector).first();
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click({ timeout: 1000 }).catch(() => {});
        }
      }

      // 3. Fill visible guest display name ("Dressly AI Assistant") and dispatch input/change events
      const nameInput = page
        .locator(
          'input[placeholder*="Your name" i], input[aria-label*="Your name" i], input[placeholder*="Tu nombre" i], input[aria-label*="Tu nombre" i]',
        )
        .first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(this.botDisplayName, { timeout: 1500 }).catch(() => {});
        await nameInput
          .evaluate((el, displayName) => {
            if (el instanceof HTMLInputElement && el.value !== displayName) {
              el.value = displayName;
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, this.botDisplayName)
          .catch(() => {});
      }

      // 4. Click join button (EN / ES)
      const joinButton = page
        .locator(
          'button:has-text("Ask to join"), button:has-text("Join now"), button:has-text("Solicitar unirse"), button:has-text("Unirse ahora"), button:has-text("Join anyway"), button:has-text("Switch here")',
        )
        .first();
      if (await joinButton.isVisible().catch(() => false)) {
        await joinButton.click({ timeout: 1500 });
        this.joinClicked = true;
      }
    } catch {
      // Non-fatal: the state poller continues retrying pre-join and inspecting lobby / in-call controls
    }
  }

  private startMeetStatePoller(page: Page, chromeAudioSource: ChromeMeetAudioSource): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    let inspecting = false;

    const inspectOnce = async () => {
      if (this.stopped || this.reconnectingInFlight || inspecting) return;
      inspecting = true;

      try {
        // 1. Check if in-call controls ("Leave call" / "Salir de la llamada") are visible
        const leaveButton = page.locator(LEAVE_CALL_SELECTOR).first();
        const inCall = await leaveButton.isVisible().catch(() => false);
        if (inCall) {
          if (!this.inCallPipelineStarted) {
            this.inCallPipelineStarted = true;
            this.reconnectAttempts = 0;
            await this.transitionStatus("JOINED", {
              detail: `${this.botDisplayName} admitted to Google Meet`,
              error: null,
            });
            await this.startInCallAudioAndGemini(chromeAudioSource);
            await this.transitionStatus("LISTENING", {
              detail: `${this.botDisplayName} listening to consultation`,
              error: null,
            });
          }
          return;
        }

        // 2. Inspect page text for entry blocks, lobby state, or call termination
        const bodyText =
          (await page.locator("body").innerText({ timeout: 500 }).catch(() => "")) || "";

        if (ENTRY_BLOCKED_TEXT_RE.test(bodyText)) {
          this.clearTimers();
          const blockMessage =
            "Google Meet requires sign-in or rejected the meeting code. Run 'npm run bot:login' once to authenticate the persistent bot profile.";
          await this.transitionStatus("FAILED", {
            detail: blockMessage,
            error: blockMessage,
          });
          await this.postWebhook({
            type: "bot.error",
            consultationSessionId: this.consultationSessionId,
            message: blockMessage,
            recoverable: false,
            timestamp: nowIso(),
          });
          return;
        }

        if (LOBBY_TEXT_RE.test(bodyText)) {
          this.joinClicked = true;
          if (this.status !== "WAITING_FOR_ADMISSION") {
            await this.transitionStatus("WAITING_FOR_ADMISSION", {
              detail: `${this.botDisplayName} waiting in Google Meet lobby for host admission`,
            });
          }
          return;
        }

        // 3. Retry pre-join configuration while still on the pre-join screen
        if (this.status === "OPENING_MEET" && !this.joinClicked) {
          await this.tryPreJoinStep(page);
          if (this.joinClicked) {
            const afterJoinText =
              (await page.locator("body").innerText({ timeout: 400 }).catch(() => "")) || "";
            if (LOBBY_TEXT_RE.test(afterJoinText)) {
              await this.transitionStatus("WAITING_FOR_ADMISSION", {
                detail: `${this.botDisplayName} waiting in Google Meet lobby for host admission`,
              });
              return;
            }
          }
        }

        // 4. Check if removed or call ended
        if (CALL_ENDED_TEXT_RE.test(bodyText)) {
          await this.handleUnexpectedDisconnect("Google Meet call ended or bot was removed.");
        }
      } catch {
        // Ignore transient DOM evaluation errors while page navigates
      } finally {
        inspecting = false;
      }
    };

    void inspectOnce();
    this.pollTimer = setInterval(() => {
      void inspectOnce();
    }, POLL_INTERVAL_MS);
  }

  private async startInCallAudioAndGemini(
    chromeAudioSource: ChromeMeetAudioSource,
  ): Promise<void> {
    await chromeAudioSource.start();

    if (env.geminiApiKey && !env.mockExternalApis) {
      const stream = new GeminiConsultationLiveStream({
        apiKey: env.geminiApiKey,
        model: env.geminiLiveModel,
        onPartialTranscript: (text) => {
          void this.postWebhook({
            type: "transcript.partial",
            consultationSessionId: this.consultationSessionId,
            text,
            timestamp: nowIso(),
          });
        },
        onFinalTranscript: (text) => {
          void this.postWebhook({
            type: "transcript.final",
            consultationSessionId: this.consultationSessionId,
            text,
            timestamp: nowIso(),
          });
        },
        onStatusChange: (connected) => {
          this.geminiConnected = connected;
        },
        onError: (err) => {
          this.lastError = err.message;
          void this.postWebhook({
            type: "bot.error",
            consultationSessionId: this.consultationSessionId,
            message: err.message,
            recoverable: true,
            timestamp: nowIso(),
          });
        },
      });

      this.geminiStream = stream;
      stream.attachAudioSource(chromeAudioSource);

      try {
        await stream.start();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        await this.postWebhook({
          type: "bot.error",
          consultationSessionId: this.consultationSessionId,
          message: `Gemini Live stream warning: ${message}`,
          recoverable: true,
          timestamp: nowIso(),
        });
      }
    }
  }

  private async handleUnexpectedDisconnect(reason: string): Promise<void> {
    if (this.stopped || this.reconnectingInFlight) return;
    this.reconnectingInFlight = true;
    this.clearTimers();
    this.inCallPipelineStarted = false;
    this.joinClicked = false;

    await this.stopAudioAndGemini();
    await this.cleanupBrowser();

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const attemptIndex = this.reconnectAttempts;
      this.reconnectAttempts += 1;
      const backoffMs = RECONNECT_BACKOFF_MS[attemptIndex] ?? 6000;

      await this.transitionStatus("RECONNECTING", {
        detail: `${reason} Reconnecting (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
        error: reason,
      });

      await this.postWebhook({
        type: "bot.error",
        consultationSessionId: this.consultationSessionId,
        message: reason,
        recoverable: true,
        timestamp: nowIso(),
      });

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectingInFlight = false;
        if (!this.stopped) {
          void this.startRealMeetFlow();
        }
      }, backoffMs);
      return;
    }

    this.reconnectingInFlight = false;
    const finalMessage = "Dressly left the consultation";
    await this.transitionStatus("FAILED", {
      detail: finalMessage,
      error: finalMessage,
    });
    await this.postWebhook({
      type: "bot.error",
      consultationSessionId: this.consultationSessionId,
      message: finalMessage,
      recoverable: false,
      timestamp: nowIso(),
    });
  }

  private attachChunkCounter(source: ConsultationAudioSource): void {
    if (this.detachAudioChunkListener) {
      this.detachAudioChunkListener();
    }
    this.detachAudioChunkListener = source.onAudioChunk((chunk: AudioChunkPayload) => {
      this.chunksCaptured += 1;
      this.bytesCaptured += chunk.pcm16le.length;
    });
  }

  private clearTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async stopAudioAndGemini(): Promise<void> {
    if (this.detachAudioChunkListener) {
      this.detachAudioChunkListener();
      this.detachAudioChunkListener = null;
    }

    const stream = this.geminiStream;
    this.geminiStream = null;
    this.geminiConnected = false;
    if (stream) {
      await stream.stop().catch(() => {});
    }

    const source = this.audioSource;
    this.audioSource = null;
    if (source) {
      await source.stop().catch(() => {});
    }
  }

  private async cleanupBrowser(clickLeaveCall = false): Promise<void> {
    const page = this.page;
    this.page = null;

    if (clickLeaveCall && page) {
      try {
        const leaveBtn = page.locator(LEAVE_CALL_SELECTOR).first();
        if (await leaveBtn.isVisible().catch(() => false)) {
          await leaveBtn.click({ timeout: 1000 }).catch(() => {});
        }
      } catch {
        // Ignore errors when leaving call during teardown
      }
    }

    const ctx = this.context;
    this.context = null;
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }

  private async transitionStatus(
    nextStatus: MeetingBotStatus,
    options?: { detail?: string; error?: string | null },
  ): Promise<void> {
    this.status = nextStatus;
    if (options?.error !== undefined) {
      this.lastError = options.error;
    }
    await this.postWebhook({
      type: "bot.status",
      consultationSessionId: this.consultationSessionId,
      status: nextStatus,
      detail: options?.detail,
      error: this.lastError,
      timestamp: nowIso(),
    });
  }

  private async postWebhook(event: BotWebhookEvent): Promise<void> {
    if (!this.callbackUrl) return;
    try {
      await fetch(this.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [MEETING_BOT_SECRET_HEADER]: env.meetingBotSecret,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // Non-fatal if Next.js callback endpoint is unreachable in standalone tests
    }
  }
}
