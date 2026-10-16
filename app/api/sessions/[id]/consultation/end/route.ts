export const dynamic = "force-dynamic";

import { endSessionConsultation } from "@/lib/agent/consultation-orchestrator";
import { json, notFound, serverError } from "@/lib/server/respond";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await endSessionConsultation(id);
    if (!session) return notFound("Session not found");
    return json({ session });
  } catch (error) {
    return serverError(error);
  }
}
