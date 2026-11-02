export const dynamic = "force-dynamic";

import { pollConsultationDesign } from "@/lib/agent/consultation-runway";
import {
  pollConsultationTryOn,
  startConsultationTryOn,
} from "@/lib/agent/consultation-tryon";
import { acquireJobLease, getJob, jobView, releaseJobLease } from "@/lib/agent/jobs";
import { pollRunway } from "@/lib/agent/runway";
import { pollTryOn } from "@/lib/agent/tryon";
import { json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";

type Context = { params: Promise<{ id: string }> };

/**
 * Poll an asynchronous provider job.
 *
 * The browser drives the polling so the multi-step loading experience stays honest:
 * every call is one real status check against YouCam (or Runway), never a fake timer.
 */
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const job = await getJob(id);
    if (!job) return notFound("Job not found or expired");

    // Only one function instance may poll and materialize this job at a time.
    const owner = await acquireJobLease(id);
    if (!owner) return json({ job: jobView(job) });
    try {
      if (job.kind === "runway") {
        const result = await pollRunway(id);
        if (!result) return notFound("Job not found or expired");
        return json({
          job: result.job,
          session: result.session,
          suggestions: result.session ? sessionPayload(result.session).suggestions : undefined,
        });
      }

      if (job.kind === "consultation_design") {
        const result = await pollConsultationDesign(
          id,
          async (sess, ver) => (await startConsultationTryOn(sess, ver.id)).job,
        );
        if (!result) return notFound("Job not found or expired");
        return json({
          job: result.job,
          session: result.session,
          suggestions: result.session ? sessionPayload(result.session).suggestions : undefined,
          version: result.version,
          followUpJob: result.followUpJob ?? null,
        });
      }

      if (job.kind === "consultation_tryon") {
        const result = await pollConsultationTryOn(id);
        if (!result) return notFound("Job not found or expired");
        return json(result);
      }

      const result = await pollTryOn(id);
      if (!result) return notFound("Job not found or expired");
      return json({
        job: result.job,
        session: result.session,
        suggestions: result.session ? sessionPayload(result.session).suggestions : undefined,
        look: result.look,
      });
    } finally {
      await releaseJobLease(id, owner);
    }
  } catch (error) {
    return serverError(error);
  }
}
