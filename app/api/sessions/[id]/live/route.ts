export const dynamic = "force-dynamic";

import { env } from "@/lib/env";
import { json, notFound, serverError } from "@/lib/server/respond";
import { getSession } from "@/lib/session/store";
import { isGeminiConfigured } from "@/services/gemini";
import { createLiveToken } from "@/services/gemini/live";

type Context = { params: Promise<{ id: string }> };

/**
 * Mint a single-use Gemini Live token for this styling session.
 *
 * The token carries the locked setup (prompt, tools, model), so the browser opens the
 * voice session directly with Google without ever holding the API key.
 */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    if (env.mockExternalApis || !isGeminiConfigured()) {
      return json(
        { error: "Live voice needs GEMINI_API_KEY (and mock mode off). You can type instead." },
        503,
      );
    }
    return json(await createLiveToken(session));
  } catch (error) {
    return serverError(error);
  }
}
