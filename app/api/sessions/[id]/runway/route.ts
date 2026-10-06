export const dynamic = "force-dynamic";

import { startRunway } from "@/lib/agent/runway";
import { jobView } from "@/lib/agent/jobs";
import { json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

/** P2: animate the active (or named) look with Runway. Optional and flag-gated. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    let lookId: string | undefined;
    try {
      const body = (await request.json()) as { lookId?: unknown };
      if (typeof body.lookId === "string") lookId = body.lookId;
    } catch {
      // body is optional
    }
    const targetId = lookId ?? session.activeLookId ?? session.looks.at(-1)?.id;
    if (!targetId) return json({ job: null, blocked: { code: "NO_LOOK", message: "No look to animate yet.", retryable: false } });

    const result = await startRunway(session, targetId);
    return json({
      job: result.job ? jobView(result.job) : null,
      blocked: result.blocked,
    });
  } catch (error) {
    return serverError(error);
  }
}
