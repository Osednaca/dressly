export const dynamic = "force-dynamic";

import { badRequest, json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { setLookFeedback } from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import type { LookFeedback } from "@/lib/types";

type Context = { params: Promise<{ id: string; lookId: string }> };

/** Like or reject a look from the history strip. A state change, not a chat turn. */
export async function POST(request: Request, context: Context) {
  try {
    const { id, lookId } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Expected a JSON body.");
    }
    const feedback =
      typeof body === "object" && body !== null && "feedback" in body
        ? (body as { feedback?: unknown }).feedback
        : undefined;
    if (feedback !== "liked" && feedback !== "rejected") {
      return badRequest("`feedback` must be `liked` or `rejected`.");
    }

    const updated = await mutateSession(id, (current) =>
      setLookFeedback(current, lookId, feedback as LookFeedback),
    );
    return json(sessionPayload(updated ?? session));
  } catch (error) {
    return serverError(error);
  }
}
