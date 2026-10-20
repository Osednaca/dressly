export const dynamic = "force-dynamic";

import {
  patchSessionConsultation,
  startSessionConsultation,
} from "@/lib/agent/consultation-orchestrator";
import type {
  StartConsultationRequest,
  UpdateConsultationRequest,
} from "@/lib/api-types";
import { badRequest, json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

const GOOGLE_MEET_URL_RE =
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#].*)?$/i;

const LOCAL_MEET_TEST_URL_RE =
  /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/.*)?$/i;

function isValidMeetingUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("demo://")) return true;
  if (LOCAL_MEET_TEST_URL_RE.test(trimmed)) return true;
  return GOOGLE_MEET_URL_RE.test(trimmed);
}

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");
    return json({ session });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as StartConsultationRequest | null;
    if (!body || typeof body !== "object") {
      return badRequest("Invalid JSON body");
    }
    if (body.consentConfirmed !== true) {
      return badRequest("Explicit listening consent is required to start a consultation.");
    }
    if (typeof body.meetingUrl !== "string" || !isValidMeetingUrl(body.meetingUrl)) {
      return badRequest(
        "Please provide a valid Google Meet link (https://meet.google.com/xxx-xxxx-xxx).",
      );
    }

    const result = await startSessionConsultation(id, body);
    if (!result) return notFound("Session not found");
    return json(result);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as UpdateConsultationRequest | null;
    if (!body || typeof body !== "object") {
      return badRequest("Invalid JSON body");
    }

    const session = await patchSessionConsultation(id, body);
    if (!session) return notFound("Session not found");
    return json({ session });
  } catch (error) {
    return serverError(error);
  }
}
