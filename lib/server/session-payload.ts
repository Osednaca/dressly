import { suggestionsFor } from "@/lib/agent/suggestions";
import type { SessionPayload } from "@/lib/api-types";
import type { StylingSession } from "@/lib/types";

/** The single shape the browser receives for a session, always with fresh suggestions. */
export function sessionPayload(session: StylingSession): SessionPayload {
  return { session, suggestions: suggestionsFor(session) };
}
