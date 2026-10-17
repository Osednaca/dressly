export const dynamic = "force-dynamic";

import { enqueueConsultationUtterance } from "@/lib/agent/consultation-aggregator";
import { ingestConsultationTranscript } from "@/lib/agent/consultation-orchestrator";
import { env } from "@/lib/env";
import { publishConsultationEvent } from "@/lib/server/consultation-events";
import { logConsultationMilestone } from "@/lib/server/consultation-logger";
import { setConsultationBotStatus } from "@/lib/session/reducer";
import { mutateSession } from "@/lib/session/store";
import { nowIso } from "@/lib/util/id";
import {
  MEETING_BOT_SECRET_HEADER,
  type BotWebhookEvent,
} from "@/services/meeting-bot/contract";

type Context = { params: Promise<{ id: string }> };

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function POST(request: Request, context: Context) {
  try {
    const providedSecret = request.headers.get(MEETING_BOT_SECRET_HEADER);
    if (!providedSecret || providedSecret !== env.meetingBotSecret) {
      return jsonResponse({ error: "Unauthorized meeting bot webhook" }, 401);
    }

    const { id } = await context.params;
    const event = (await request.json().catch(() => null)) as BotWebhookEvent | null;
    if (!event || typeof event !== "object" || typeof event.type !== "string") {
      return jsonResponse({ error: "Invalid bot webhook payload" }, 400);
    }

    switch (event.type) {
      case "bot.status": {
        const updated = await mutateSession(id, (session) =>
          setConsultationBotStatus(session, event.status, {
            error: event.error,
            activityText: event.detail,
          }),
        );
        if (!updated || !updated.consultation) {
          return jsonResponse({ error: "Consultation session not found" }, 404);
        }
        if (
          event.status === "OPENING_MEET" ||
          event.status === "WAITING_FOR_ADMISSION"
        ) {
          logConsultationMilestone("meet loaded", {
            sessionId: id,
            botStatus: event.status,
            detail: event.detail ?? null,
          });
        } else if (event.status === "JOINED") {
          logConsultationMilestone("bot admitted", {
            sessionId: id,
            botStatus: event.status,
            detail: event.detail ?? null,
          });
        } else if (event.status === "LISTENING") {
          logConsultationMilestone("audio capture started", {
            sessionId: id,
            botStatus: event.status,
            sampleRate: 16000,
            channels: 1,
          });
          logConsultationMilestone("Gemini connected", {
            sessionId: id,
            botStatus: event.status,
            model: env.geminiLiveModel,
          });
        }
        publishConsultationEvent(id, {
          type: "bot.status",
          status: updated.consultation.botStatus,
          consultationStatus: updated.consultation.status,
          message: event.detail,
          timestamp: event.timestamp || nowIso(),
          session: updated,
        });
        return jsonResponse({ ok: true, session: updated });
      }

      case "transcript.partial": {
        if (typeof event.text !== "string" || !event.text.trim()) {
          return jsonResponse({ ok: true });
        }
        const turn = await ingestConsultationTranscript(id, {
          text: event.text,
          isFinal: false,
          timestamp: event.timestamp,
        });
        if (!turn) return jsonResponse({ error: "Consultation session not found" }, 404);
        return jsonResponse({ ok: true, session: turn.session });
      }

      case "transcript.final": {
        if (typeof event.text !== "string" || !event.text.trim()) {
          return jsonResponse({ ok: true });
        }
        await enqueueConsultationUtterance(id, event.text, async (mergedText) => {
          await ingestConsultationTranscript(id, {
            text: mergedText,
            isFinal: true,
            immediate: true,
            timestamp: event.timestamp,
          });
        });
        return jsonResponse({ ok: true, queued: true });
      }

      case "bot.error": {
        const targetStatus = event.recoverable ? "RECONNECTING" : "FAILED";
        const updated = await mutateSession(id, (session) =>
          setConsultationBotStatus(session, targetStatus, {
            error: event.message,
            activityText: event.message,
          }),
        );
        if (!updated || !updated.consultation) {
          return jsonResponse({ error: "Consultation session not found" }, 404);
        }
        publishConsultationEvent(id, {
          type: "bot.status",
          status: updated.consultation.botStatus,
          consultationStatus: updated.consultation.status,
          message: event.message,
          timestamp: event.timestamp || nowIso(),
          session: updated,
        });
        return jsonResponse({ ok: true, session: updated });
      }

      default:
        return jsonResponse({ error: "Unsupported bot webhook event type" }, 400);
    }
  } catch (error) {
    console.error("[dressly] bot-event webhook failed:", error);
    return jsonResponse(
      { error: "Something went wrong on our side. Please try again." },
      500,
    );
  }
}
