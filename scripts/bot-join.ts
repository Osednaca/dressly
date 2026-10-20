import { spawn } from "node:child_process";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { env } from "@/lib/env";
import {
  DEFAULT_BOT_DISPLAY_NAME,
  type BotWebhookEvent,
} from "@/services/meeting-bot/contract";
import {
  PlaywrightMeetBotSession,
  resolveChromiumExecutable,
} from "@/services/meeting-bot/playwright-bot";

/**
 * Dressly Real Google Meet Bot CLI (`scripts/bot-join.ts`).
 *
 * Modes:
 *   1. `npm run bot:login` (`--login`):
 *      Opens a headed Chromium window against the shared persistent profile
 *      (`data/bot-profile`) at `https://accounts.google.com` and `https://meet.google.com`
 *      so you can sign into the Google account once and persist cookies/session.
 *
 *   2. `npm run bot:join -- https://meet.google.com/xxx-xxxx-xxx`:
 *      Starts a local webhook listener and launches `PlaywrightMeetBotSession`
 *      (`headless: false`) against the provided Google Meet URL, logging every
 *      bot status transition, live 16 kHz PCM audio chunk/byte counters, and
 *      live Gemini transcriptions in real time until `Ctrl+C`.
 */

async function readWebhookJson(req: IncomingMessage): Promise<BotWebhookEvent | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as BotWebhookEvent;
  } catch {
    return null;
  }
}

async function runLoginMode(forceReset = false): Promise<void> {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    console.error(
      "[bot:login] Chrome executable not found. Set CHROMIUM_EXECUTABLE_PATH or install Google Chrome.",
    );
    process.exit(1);
  }

  const profileDir = path.resolve(process.cwd(), env.meetingBotProfileDir);
  const nativeMarker = path.join(profileDir, ".dressly-native-chrome-profile");

  // If the profile directory was previously created by Playwright's unbranded
  // Chrome for Testing with CDP attached (which triggers Google's v3/signin/rejected),
  // or if --reset was passed, wipe it cleanly before launching native Google Chrome.
  if (forceReset || (fs.existsSync(profileDir) && !fs.existsSync(nativeMarker))) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Ignore locked files if any
    }
  }

  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(nativeMarker, new Date().toISOString(), "utf8");

  console.log("====================================================================");
  console.log(" Dressly AI Assistant — Persistent Google Account Login");
  console.log("====================================================================");
  console.log(`Browser binary : ${executablePath}`);
  console.log(`Profile dir    : ${profileDir}`);
  console.log("Launch mode    : Native Google Chrome (no CDP / automation pipe)");
  console.log("");
  console.log("Instructions:");
  console.log(`  1. Sign into the Google account you want "${DEFAULT_BOT_DISPLAY_NAME}" to use.`);
  console.log("     (Tip: Google Meet also allows guest join without signing in if the host admits the bot.)");
  console.log("  2. Verify https://meet.google.com shows your signed-in account.");
  console.log("  3. Close the Chrome window (or press Ctrl+C here) to save the profile.");
  console.log("====================================================================\n");

  // Spawn official Google Chrome directly as a normal OS process with --user-data-dir
  // and NO Playwright CDP debugging pipe or --enable-automation flags attached.
  // This prevents Google Accounts from rejecting the login with `v3/signin/rejected`.
  const child = spawn(
    executablePath,
    [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmeet.google.com%2F",
      "https://meet.google.com",
    ],
    {
      stdio: "ignore",
      detached: false,
    },
  );

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    child.once("error", (err) => {
      if (!finished) {
        finished = true;
        reject(err);
      }
    });

    child.once("exit", () => {
      done();
    });

    process.once("SIGINT", () => {
      console.log("\n[bot:login] Closing Chrome and saving persistent profile...");
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore
      }
      done();
    });

    process.once("SIGTERM", () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore
      }
      done();
    });
  });

  console.log(`[bot:login] Authenticated profile saved in ${profileDir}`);
}

async function runJoinMode(meetingUrl: string): Promise<void> {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    console.error(
      "[bot:join] Chromium executable not found. Set CHROMIUM_EXECUTABLE_PATH or install Google Chrome / Playwright Chromium.",
    );
    process.exit(1);
  }

  const webhookServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const event = await readWebhookJson(req);
      if (event) {
        const ts = new Date(event.timestamp).toLocaleTimeString();
        if (event.type === "bot.status") {
          console.log(
            `[${ts}] [STATUS] ${event.status}${event.detail ? ` — ${event.detail}` : ""}`,
          );
        } else if (event.type === "transcript.partial") {
          console.log(`[${ts}] [GEMINI PARTIAL] "${event.text}"`);
        } else if (event.type === "transcript.final") {
          console.log(`[${ts}] [GEMINI FINAL]   "${event.text}"`);
        } else if (event.type === "bot.error") {
          console.error(
            `[${ts}] [BOT ERROR] (recoverable=${event.recoverable}) ${event.message}`,
          );
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    webhookServer.once("error", reject);
    webhookServer.listen(0, "127.0.0.1", () => {
      const addr = webhookServer.address() as AddressInfo;
      resolve(addr.port);
    });
  });

  const sessionId = `cli_${Date.now()}`;
  const callbackUrl = `http://127.0.0.1:${port}/webhook`;

  console.log("====================================================================");
  console.log(` Dressly AI Assistant — Live Google Meet Join`);
  console.log("====================================================================");
  console.log(`Meeting URL    : ${meetingUrl}`);
  console.log(`Session ID     : ${sessionId}`);
  console.log(`Browser binary : ${executablePath}`);
  console.log(`Headless mode  : false (headed window)`);
  console.log(`Gemini Live    : ${env.geminiApiKey ? `Enabled (${env.geminiLiveModel})` : "Disabled (no GEMINI_API_KEY)"}`);
  console.log("Press Ctrl+C at any time to leave the call and clean up.\n");

  const botSession = new PlaywrightMeetBotSession({
    consultationSessionId: sessionId,
    meetingUrl,
    botDisplayName: DEFAULT_BOT_DISPLAY_NAME,
    callbackUrl,
    headless: false,
  });

  await botSession.start();

  let lastLoggedChunks = 0;
  const metricsInterval = setInterval(() => {
    const snap = botSession.getSnapshot();
    if (snap.chunksCaptured !== lastLoggedChunks) {
      lastLoggedChunks = snap.chunksCaptured;
      console.log(
        `[AUDIO 16kHz PCM] status=${snap.status} chunks=${snap.chunksCaptured} bytes=${snap.bytesCaptured} geminiConnected=${snap.geminiConnected}`,
      );
    }
  }, 2000);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(metricsInterval);
      console.log("\n[bot:join] Stopping Dressly AI Assistant and leaving Google Meet...");
      void botSession
        .stop()
        .finally(() => {
          webhookServer.close(() => resolve());
        });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--login") || args.includes("login")) {
    await runLoginMode(args.includes("--reset"));
    return;
  }

  const urlArg = args.find((arg) => !arg.startsWith("-"));
  if (!urlArg) {
    console.error("Usage:");
    console.error("  npm run bot:login");
    console.error("  npm run bot:join -- https://meet.google.com/xxx-xxxx-xxx");
    process.exit(1);
  }

  await runJoinMode(urlArg);
}

void main().catch((err) => {
  console.error("[bot-join] Fatal error:", err);
  process.exit(1);
});
