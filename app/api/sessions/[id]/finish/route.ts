export const dynamic = "force-dynamic";

import { json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { markCompleted } from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

/** Finalise the session: freeze the outfit, unlock the summary and the cart. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");
    const updated = await mutateSession(id, markCompleted);
    return json(sessionPayload(updated ?? session));
  } catch (error) {
    return serverError(error);
  }
}
