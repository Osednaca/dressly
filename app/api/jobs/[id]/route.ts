export const dynamic = "force-dynamic";

import { getJob, jobView } from "@/lib/agent/jobs";
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
    const job = getJob(id);
    if (!job) return notFound("Job not found or expired");

    if (job.kind === "runway") {
      const result = await pollRunway(id);
      if (!result) return notFound("Job not found or expired");
      return json({
        job: result.job,
        session: result.session,
        suggestions: result.session ? sessionPayload(result.session).suggestions : undefined,
      });
    }

    const result = await pollTryOn(id);
    if (!result) return notFound("Job not found or expired");
    return json({
      job: result.job,
      session: result.session,
      suggestions: result.session ? sessionPayload(result.session).suggestions : undefined,
      look: result.look,
    });
  } catch (error) {
    return serverError(error);
  }
}
