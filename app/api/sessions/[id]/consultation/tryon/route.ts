export const dynamic = "force-dynamic";

import { startConsultationTryOn } from "@/lib/agent/consultation-tryon";
import { json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    const body = (await request.json().catch(() => null)) as { versionId?: unknown } | null;
    const versionId =
      typeof body?.versionId === "string" && body.versionId.trim().length > 0
        ? body.versionId.trim()
        : undefined;

    const result = await startConsultationTryOn(session, versionId);
    return json({
      session: result.session,
      job: result.job,
      blocked: result.blocked,
    });
  } catch (error) {
    return serverError(error);
  }
}
