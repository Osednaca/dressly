import { env } from "@/lib/env";
import { ProviderError } from "@/lib/util/http";
import type { TryOnEngine } from "@/services/contracts";
import { youcamEngine } from "@/services/youcam/client";
import { mockYoucamEngine } from "@/services/youcam/mock";

/**
 * The single wiring decision for the try-on engine.
 *
 * Fail-closed on purpose: with mock mode off and no credential, Dressly reports the
 * missing key instead of quietly producing a fabricated try-on. A wrong image is
 * worse than an honest error, especially in a judged demo.
 */
export function tryOnEngine(): TryOnEngine {
  if (env.mockExternalApis) return mockYoucamEngine;
  if (!env.youcamApiKey) {
    throw new ProviderError("youcam", 401, "YOUCAM_API_KEY is not configured", {
      retryable: false,
    });
  }
  return youcamEngine;
}

export function tryOnProvider(): "youcam" | "mock" {
  return env.mockExternalApis ? "mock" : "youcam";
}

export { youcamEngine, mockYoucamEngine };
