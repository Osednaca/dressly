import { env } from "@/lib/env";
import { ProviderError } from "@/lib/util/http";
import { isSupabaseStorage } from "@/lib/storage/supabase";
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
export function tryOnEngine(options?: {
  allowFallbackWhenDisabled?: boolean;
}): TryOnEngine {
  if (env.mockExternalApis) {
    if (isSupabaseStorage()) {
      throw new ProviderError("youcam", 503, "YouCam mock cannot run across serverless instances; configure the real YouCam provider", { retryable: false });
    }
    return mockYoucamEngine;
  }
  if (!env.youcamApiKey) {
    if (options?.allowFallbackWhenDisabled && !isSupabaseStorage()) return mockYoucamEngine;
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
