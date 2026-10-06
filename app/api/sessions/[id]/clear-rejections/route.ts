export const dynamic = "force-dynamic";

import { json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { clearRejections } from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

/** Recovery path when every matching garment has been rejected. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");
    const updated = await mutateSession(id, clearRejections);
    return json(sessionPayload(updated ?? session));
  } catch (error) {
    return serverError(error);
  }
}
