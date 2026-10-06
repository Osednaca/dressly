export const dynamic = "force-dynamic";

import { env, isDegraded, providerStatuses } from "@/lib/env";
import { json } from "@/lib/server/respond";

/**
 * Truthful provider state for the UI banner.
 *
 * The browser is told exactly which integrations are live, mocked or missing so a
 * simulated result can never be mistaken for a real one.
 */
export async function GET() {
  return json({
    statuses: providerStatuses(),
    degraded: isDegraded(),
    mock: env.mockExternalApis,
    demo: env.demoMode,
  });
}
