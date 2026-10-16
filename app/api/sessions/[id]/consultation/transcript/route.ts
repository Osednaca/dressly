export const dynamic = "force-dynamic";

import { ingestConsultationTranscript } from "@/lib/agent/consultation-orchestrator";
import type { IngestTranscriptRequest } from "@/lib/api-types";
import { badRequest, json, notFound, serverError } from "@/lib/server/respond";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as IngestTranscriptRequest | null;
    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      return badRequest("Transcript text is required.");
    }

    const result = await ingestConsultationTranscript(id, body);
    if (!result) return notFound("Consultation session not found");
    return json(result);
  } catch (error) {
    return serverError(error);
  }
}
