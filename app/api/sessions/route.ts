export const dynamic = "force-dynamic";

import { env } from "@/lib/env";
import { json, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { recompute } from "@/lib/session/reducer";
import { createSession, mutateSession } from "@/lib/session/store";
import { ensureDirs } from "@/lib/storage/files";

/**
 * Start a styling session. The shopper's photo is uploaded separately, so a session
 * exists the moment the app opens.
 *
 * In demo mode the session is seeded with the brief from the scripted flow, but the
 * provider calls afterwards are still real.
 */
export async function POST() {
  try {
    await ensureDirs();
    const created = await createSession(null);
    if (env.demoMode) {
      const seeded = await mutateSession(created.id, (session) =>
        recompute({
          ...session,
          occasion: "Rooftop dinner",
          targetStyles: ["evening", "smart_casual"],
          budget: 420,
        }),
      );
      return json(sessionPayload(seeded ?? created), 201);
    }
    return json(sessionPayload(created), 201);
  } catch (error) {
    return serverError(error);
  }
}
