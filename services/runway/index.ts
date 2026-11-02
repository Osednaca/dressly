import sharp from "sharp";
import { renderStudioBagSvg } from "@/lib/catalog/bag-svg";
import { env } from "@/lib/env";
import { DEFAULT_BAG_DESIGN_STATE, type BagDesignState } from "@/lib/types";
import { ProviderError } from "@/lib/util/http";
import { isSupabaseStorage } from "@/lib/storage/supabase";
import { newId } from "@/lib/util/id";
import { runwayEngine } from "@/services/runway/client";
import type {
  RunwayEngine,
  RunwayHandle,
  RunwayImageEngine,
  RunwayImageRequest,
  RunwayImageState,
} from "@/services/runway/contract";

interface MockImageTask {
  targetState: BagDesignState;
  versionLabel?: string;
  image?: Buffer;
}

const mockImageTasks = new Map<string, MockImageTask>();

async function renderMockHandbagPng(
  targetState: BagDesignState,
  versionLabel?: string,
): Promise<Buffer> {
  const svg = renderStudioBagSvg(targetState, { versionLabel });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export const mockRunwayImageEngine: RunwayImageEngine = {
  provider: "mock",

  async submitImage(request: RunwayImageRequest): Promise<RunwayHandle> {
    const id = newId("rw_img");
    const targetState = request.targetState ?? DEFAULT_BAG_DESIGN_STATE;
    const image = await renderMockHandbagPng(targetState, request.versionLabel);
    mockImageTasks.set(id, {
      targetState,
      versionLabel: request.versionLabel,
      image,
    });
    return { id, provider: "runway" };
  },

  async pollImage(handle: RunwayHandle): Promise<RunwayImageState> {
    const task = mockImageTasks.get(handle.id);
    if (task?.image) {
      mockImageTasks.delete(handle.id);
      return {
        status: "success",
        image: task.image,
        contentType: "image/png",
      };
    }

    const fallbackImage = await renderMockHandbagPng(
      task?.targetState ?? DEFAULT_BAG_DESIGN_STATE,
      task?.versionLabel,
    );
    mockImageTasks.delete(handle.id);
    return {
      status: "success",
      image: fallbackImage,
      contentType: "image/png",
    };
  },
};

/**
 * The single Runway wiring decision for P2 look animation.
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

export function runwayImageEngine(options?: {
  allowFallbackWhenDisabled?: boolean;
}): RunwayImageEngine {
  if (env.mockExternalApis) {
    if (isSupabaseStorage()) {
      throw new ProviderError("runway", 503, "Runway mock cannot run across serverless instances; configure the real Runway provider", { retryable: false });
    }
    return mockRunwayImageEngine;
  }
  if (runwayAvailable()) {
    return runwayEngine;
  }
  if (options?.allowFallbackWhenDisabled && !isSupabaseStorage()) {
    return mockRunwayImageEngine;
  }
  return runwayEngineOrThrow();
}

export { runwayEngine };
export type {
  RunwayEngine,
  RunwayHandle,
  RunwayImageEngine,
  RunwayImageRequest,
  RunwayImageState,
  RunwayReferenceImage,
  RunwayRequest,
  RunwayState,
} from "@/services/runway/contract";
