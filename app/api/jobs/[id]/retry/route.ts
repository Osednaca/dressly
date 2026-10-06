export const dynamic = "force-dynamic";

import { jobView } from "@/lib/agent/jobs";
import { retryTryOn } from "@/lib/agent/tryon";
import { json, notFound, serverError } from "@/lib/server/respond";

type Context = { params: Promise<{ id: string }> };

/** Retry a failed try-on for the same garment. Bounded and explicit. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
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
