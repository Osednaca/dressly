export const dynamic = "force-dynamic";

import { restoreSessionDesignVersion } from "@/lib/agent/consultation-orchestrator";
import { json, notFound, serverError } from "@/lib/server/respond";

type Context = { params: Promise<{ id: string; versionId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id, versionId } = await context.params;
    const session = await restoreSessionDesignVersion(id, versionId);
    if (!session) return notFound("Consultation session not found");
    return json({ session });
  } catch (error) {
    return serverError(error);
  }
}
