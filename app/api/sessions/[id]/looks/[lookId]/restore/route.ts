export const dynamic = "force-dynamic";

import { json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { restoreLook } from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string; lookId: string }> };

/** Reopen a previous look so the session continues from it. History is navigation. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id, lookId } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");
    const updated = await mutateSession(id, (current) => restoreLook(current, lookId));
    return json(sessionPayload(updated ?? session));
  } catch (error) {
    return serverError(error);
  }
}
