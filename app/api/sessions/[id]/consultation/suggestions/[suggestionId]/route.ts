export const dynamic = "force-dynamic";

import { handleSuggestionAction } from "@/lib/agent/consultation-orchestrator";
import type { SuggestionActionRequest } from "@/lib/api-types";
import { badRequest, json, notFound, serverError } from "@/lib/server/respond";

type Context = { params: Promise<{ id: string; suggestionId: string }> };

const VALID_ACTIONS = new Set(["apply", "edit", "ignore"]);

export async function POST(request: Request, context: Context) {
  try {
    const { id, suggestionId } = await context.params;
    const body = (await request.json().catch(() => null)) as SuggestionActionRequest | null;
    if (!body || !VALID_ACTIONS.has(body.action)) {
      return badRequest('Action must be one of "apply", "edit", or "ignore".');
    }

    const result = await handleSuggestionAction(id, suggestionId, body);
    if (!result) return notFound("Consultation session not found");
    return json(result);
  } catch (error) {
    return serverError(error);
  }
}
