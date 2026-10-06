import { env } from "@/lib/env";
import { ProviderError } from "@/lib/util/http";
import { runwayEngine } from "@/services/runway/client";
import type { RunwayEngine } from "@/services/runway/contract";

/**
 * The single Runway wiring decision.
 *
 * Returns the engine only when the P2 feature is both enabled and credentialed;
 * otherwise it throws a clear, non-retryable error. Runway can never silently become
 * part of the core flow.
 */
export function runwayEngineOrThrow(): RunwayEngine {
  if (!env.runwayEnabled) {
    throw new ProviderError("runway", 403, "Runway animation is disabled (RUNWAY_ENABLED=false)", {
      retryable: false,
    });
  }
  if (!env.runwayApiKey) {
    throw new ProviderError("runway", 401, "RUNWAY_API_KEY is not configured", {
      retryable: false,
    });
  }
  return runwayEngine;
}

export function runwayAvailable(): boolean {
  return env.runwayEnabled && Boolean(env.runwayApiKey);
}

export { runwayEngine };
export type { RunwayEngine, RunwayHandle, RunwayRequest, RunwayState } from "@/services/runway/contract";
