export const dynamic = "force-dynamic";

import { json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");
    return json(sessionPayload(session));
  } catch (error) {
    return serverError(error);
  }
}
