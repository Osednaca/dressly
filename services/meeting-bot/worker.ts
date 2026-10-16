import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@/lib/env";
import { resolveFfmpegExecutable } from "@/services/meeting-bot/audio-capture";
import {
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  SimulatedMeetAudioSource,
} from "@/services/meeting-bot/audio-source";
import {
  MEETING_BOT_SECRET_HEADER,
  type AudioDiagnosticRequest,
  type AudioDiagnosticResult,
  type BotHealthResponse,
  type StartBotSessionRequest,
} from "@/services/meeting-bot/contract";
import {
  PlaywrightMeetBotSession,
  resolveChromiumExecutable,
} from "@/services/meeting-bot/playwright-bot";

/**
 * Isolated Meeting Bot HTTP Worker (`services/meeting-bot/worker.ts`).
 *
 * Exposes the internal HTTP API on `127.0.0.1:${env.meetingBotPort}` (`4100` by default)
 * authenticated via `x-meeting-bot-secret: ${env.meetingBotSecret}`.
 */

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as T;
}

export interface BotWorkerServerHandle {
  server: http.Server;
  start(port?: number): Promise<number>;
  stopAll(): Promise<void>;
}

export function createBotWorkerServer(): BotWorkerServerHandle {
  const sessions = new Map<string, PlaywrightMeetBotSession>();
  let listening = false;

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? "GET").toUpperCase();
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    if (!pathname.startsWith("/bot")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const secretHeader = req.headers[MEETING_BOT_SECRET_HEADER];
    const providedSecret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    if (!providedSecret || providedSecret !== env.meetingBotSecret) {
      sendJson(res, 401, { error: "Unauthorized meeting bot request" });
      return;
    }

    // 1. GET /bot/health
    if (method === "GET" && pathname === "/bot/health") {
      const chromiumPath = resolveChromiumExecutable();
      const ffmpegPath = resolveFfmpegExecutable();
      const health: BotHealthResponse = {
        ok: true,
        activeSessions: sessions.size,
        audioBackend: env.meetingAudioBackend,
        chromiumFound: Boolean(chromiumPath),
        chromiumPath,
        ffmpegFound: Boolean(ffmpegPath),
        ffmpegPath,
      };
      sendJson(res, 200, health);
      return;
    }

    // 2. POST /bot/diagnostics/audio
    if (method === "POST" && pathname === "/bot/diagnostics/audio") {
      const body = (await readJsonBody<AudioDiagnosticRequest>(req).catch(() => null)) ?? {};
      const durationMs = Math.max(50, Math.min(5000, body.durationMs ?? 250));
      const simSource = new SimulatedMeetAudioSource({
        intervalMs: 100,
        emitImmediately: true,
      });

      let chunksEmitted = 0;
      let bytesTotal = 0;
      const unsubscribe = simSource.onAudioChunk((chunk) => {
        chunksEmitted += 1;
        bytesTotal += chunk.pcm16le.length;
      });

      await simSource.start();
      await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
      await simSource.stop();
      unsubscribe();

      const diagnostic: AudioDiagnosticResult = {
        ok: chunksEmitted > 0 && bytesTotal > 0,
        providerName: simSource.providerName,
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        chunksEmitted,
        bytesTotal,
        durationMs,
      };
      sendJson(res, 200, diagnostic);
      return;
    }

    // 3. POST /bot/sessions
    if (method === "POST" && pathname === "/bot/sessions") {
      const body = await readJsonBody<StartBotSessionRequest>(req).catch(() => null);
      if (
        !body ||
        typeof body.consultationSessionId !== "string" ||
        !body.consultationSessionId.trim() ||
        typeof body.meetingUrl !== "string" ||
        !body.meetingUrl.trim()
      ) {
        sendJson(res, 400, {
          error: "consultationSessionId and meetingUrl are required",
        });
        return;
      }

      const id = body.consultationSessionId.trim();
      const existing = sessions.get(id);
      if (existing) {
        sessions.delete(id);
        await existing.stop().catch(() => {});
      }

      const botSession = new PlaywrightMeetBotSession({
        consultationSessionId: id,
        meetingUrl: body.meetingUrl.trim(),
        botDisplayName: body.botDisplayName,
        callbackUrl: body.callbackUrl ?? "",
        audioBackend: body.audioBackend,
      });
      sessions.set(id, botSession);

      const snapshot = await botSession.start();
      sendJson(res, 200, snapshot);
      return;
    }

    // 4. Match /bot/sessions/:id[/(reconnect|stop)]
    const sessionMatch = /^\/bot\/sessions\/([^/]+)(?:\/(reconnect|stop))?$/.exec(pathname);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]!);
      const subAction = sessionMatch[2];
      const botSession = sessions.get(id);

      if (method === "GET" && !subAction) {
        if (!botSession) {
          sendJson(res, 404, { error: "Bot session not found" });
          return;
        }
        sendJson(res, 200, botSession.getSnapshot());
        return;
      }

      if (method === "POST" && subAction === "reconnect") {
        if (!botSession) {
          sendJson(res, 404, { error: "Bot session not found" });
          return;
        }
        const snapshot = await botSession.reconnect();
        sendJson(res, 200, snapshot);
        return;
      }

      if (method === "POST" && subAction === "stop") {
        if (botSession) {
          sessions.delete(id);
          await botSession.stop().catch(() => {});
        }
        sendJson(res, 200, { status: "STOPPED" });
        return;
      }
    }

    sendJson(res, 404, { error: "Not found" });
  };

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      console.error("[meeting-bot-worker] unhandled error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : "Internal worker error",
        });
      }
    });
  });

  async function start(port: number = env.meetingBotPort): Promise<number> {
    if (listening) {
      const addr = server.address() as AddressInfo | null;
      return addr?.port ?? port;
    }

    return new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        listening = true;
        const addr = server.address() as AddressInfo | null;
        resolve(addr?.port ?? port);
      });
    });
  }

  async function stopAll(): Promise<void> {
    const active = Array.from(sessions.values());
    sessions.clear();

    await Promise.allSettled(active.map((session) => session.stop()));

    if (listening) {
      listening = false;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }

  return {
    server,
    start,
    stopAll,
  };
}

function isExecutedAsMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    const currentFile = path.resolve(fileURLToPath(import.meta.url));
    const entryFile = path.resolve(process.argv[1]);
    return currentFile === entryFile;
  } catch {
    return false;
  }
}

if (isExecutedAsMain()) {
  const worker = createBotWorkerServer();
  void worker
    .start(env.meetingBotPort)
    .then((boundPort) => {
      console.log(
        `[meeting-bot-worker] Dressly AI Assistant worker listening on http://127.0.0.1:${boundPort}`,
      );
    })
    .catch((err) => {
      console.error("[meeting-bot-worker] failed to start:", err);
      process.exit(1);
    });

  const gracefulShutdown = () => {
    void worker.stopAll().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}
