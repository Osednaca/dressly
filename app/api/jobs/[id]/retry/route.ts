export const dynamic = "force-dynamic";

import { startConsultationDesign } from "@/lib/agent/consultation-runway";
import { startConsultationTryOn } from "@/lib/agent/consultation-tryon";
import { getJob, jobView } from "@/lib/agent/jobs";
import { retryTryOn } from "@/lib/agent/tryon";
import { json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

/** Retry a failed try-on or consultation job. Bounded and explicit. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const existing = getJob(id);

    if (existing?.kind === "consultation_design") {
      const session = await getSession(existing.sessionId);
      if (!session || !existing.targetDesignState || !existing.previousDesignState) {
        return notFound("Job not found or expired");
      }
      const retried = await startConsultationDesign(session, {
        suggestionId: existing.suggestionId,
        changes: existing.changes ?? [],
        nextState: existing.targetDesignState,
        previousState: existing.previousDesignState,
        highResFinal: existing.highResFinal,
      });
      return json({
        job: retried.job,
        blocked: retried.blocked,
      });
    }

    if (existing?.kind === "consultation_tryon") {
      const session = await getSession(existing.sessionId);
      if (!session) {
        return notFound("Job not found or expired");
      }
      const retried = await startConsultationTryOn(session, existing.versionId);
      return json({
        job: retried.job,
        blocked: retried.blocked,
      });
    }

    const result = await retryTryOn(id);
    if (!result.job && !result.blocked) return notFound("Job not found or expired");
    return json({
      job: result.job ? jobView(result.job) : null,
      blocked: result.blocked,
    });
  } catch (error) {
    return serverError(error);
  }
}
