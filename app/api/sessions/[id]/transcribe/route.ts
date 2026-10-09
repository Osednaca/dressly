export const dynamic = "force-dynamic";

import { env } from "@/lib/env";
import { badRequest, json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";
import { isGeminiConfigured, transcribeAudio } from "@/services/gemini";

type Context = { params: Promise<{ id: string }> };

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Server-side voice transcription.
 *
 * Used only when the browser's own speech recognition is unavailable. The clip is
 * transcribed by Gemini and discarded — it is never written to disk.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    if (env.mockExternalApis || !isGeminiConfigured()) {
      return json(
        { error: "Voice transcription needs GEMINI_API_KEY (and mock mode off). You can type instead." },
        503,
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("Upload the recording under the `file` field.");
    if (!file.type.startsWith("audio/")) return badRequest("The recording must be audio.");
    if (file.size === 0) return badRequest("The recording is empty.");
    if (file.size > MAX_BYTES) return badRequest("The recording is too long.");

    const mimeType = file.type.split(";")[0] ?? "audio/wav";
    const text = await transcribeAudio(Buffer.from(await file.arrayBuffer()), mimeType);
    return json({ text: text.slice(0, 600) });
  } catch (error) {
    return serverError(error);
  }
}
