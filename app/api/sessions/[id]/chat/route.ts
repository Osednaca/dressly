export const dynamic = "force-dynamic";

import { chatTurn } from "@/lib/server/chat-turn";
import { badRequest, json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

/** One shopper message in, one full agent turn out. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Expected a JSON body.");
    }
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? (body as { message?: unknown }).message
        : undefined;
    if (typeof message !== "string" || message.trim().length === 0) {
      return badRequest("A non-empty `message` is required.");
    }

    const response = await chatTurn(session, message.trim().slice(0, 600));
    return json(response);
  } catch (error) {
    return serverError(error);
  }
}
