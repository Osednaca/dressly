import { env } from "@/lib/env";
import { ProviderError, requestJson } from "@/lib/util/http";
import type {
  RunwayEngine,
  RunwayHandle,
  RunwayImageRequest,
  RunwayImageState,
  RunwayRequest,
  RunwayState,
} from "@/services/runway/contract";

/**
 * Runway image-to-video (`gen4_turbo`) and text-to-image (`nano_banana_2.1`).
 *
 * The animation prompt is deliberately restrained: it may add natural movement but must
 * never alter the person or the outfit. The consultation image endpoint uses reference
 * images (`@latest_design`, `@original_design`) to apply approved design modifications
 * without silhouette or framing drift.
 */

const VERSION = "2024-11-06";
const SUBMIT_PATH = "/v1/image_to_video";
const IMAGE_SUBMIT_PATH = "/v1/text_to_image";
const REFERENCE_TAG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,15}$/;

function authHeaders(): Record<string, string> {
  if (!env.runwayApiKey) {
    throw new ProviderError("runway", 401, "RUNWAY_API_KEY is not configured");
  }
  return {
    Authorization: `Bearer ${env.runwayApiKey}`,
    "Content-Type": "application/json",
    "X-Runway-Version": VERSION,
  };
}

function toDataUri(image: Buffer, contentType: string): string {
  const mime = contentType.trim() || "image/png";
  return `data:${mime};base64,${image.toString("base64")}`;
}

interface TaskEnvelope {
  id?: string;
  status?: string;
  progress?: number;
  output?: string[] | string;
  failure?: string;
  error?: string;
}

function normalizeStatus(status: string | undefined): "pending" | "success" | "failed" {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCEEDED":
    case "SUCCESS":
      return "success";
    case "FAILED":
    case "CANCELLED":
    case "CANCELED":
      return "failed";
    default:
      return "pending";
  }
}

function extractOutputUrl(output: TaskEnvelope["output"]): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output[0] ?? null;
  return null;
}

async function downloadImage(
  url: string,
): Promise<{ image: Buffer; contentType: string }> {
  const download = await fetch(url);
  if (!download.ok) {
    throw new ProviderError(
      "runway",
      download.status,
      `could not download generated image (${download.status})`,
      { retryable: true },
    );
  }
  const contentType = download.headers.get("content-type") ?? "image/png";
  const image = Buffer.from(await download.arrayBuffer());
  return { image, contentType };
}

export const runwayEngine: RunwayEngine = {
  provider: "runway",

  async submit(request: RunwayRequest): Promise<RunwayHandle> {
    const dataUri = toDataUri(request.image, request.imageContentType);
    const response = await requestJson<TaskEnvelope>(
      `${env.runwayBaseUrl}${SUBMIT_PATH}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: env.runwayModel,
          promptImage: dataUri,
          promptText: request.promptText,
          ratio: env.runwayRatio,
          duration: request.durationSeconds ?? env.runwayDurationSeconds,
        }),
      },
      { provider: "runway", timeoutMs: 60_000, retries: 1 },
    );

    if (!response.ok || !response.data?.id) {
      throw new ProviderError(
        "runway",
        response.status,
        `animation task rejected: ${response.data?.failure ?? response.text.slice(0, 200)}`,
        { retryable: response.status >= 500, body: response.text },
      );
    }
    return { id: response.data.id, provider: "runway" };
  },

  async poll(handle: RunwayHandle): Promise<RunwayState> {
    const response = await requestJson<TaskEnvelope>(
      `${env.runwayBaseUrl}/v1/tasks/${encodeURIComponent(handle.id)}`,
      { method: "GET", headers: authHeaders() },
      { provider: "runway", timeoutMs: 30_000, retries: 1 },
    );

    if (!response.ok) {
      return {
        status: "failed",
        provider: "runway",
        id: handle.id,
        message: `animation status check failed (${response.status})`,
        retryable: response.status >= 500,
      };
    }

    const data = response.data ?? {};
    const state = normalizeStatus(data.status);
    if (state === "pending") return { status: "pending", provider: "runway", id: handle.id };
    if (state === "failed") {
      return {
        status: "failed",
        provider: "runway",
        id: handle.id,
        message: data.failure ?? data.error ?? "Runway could not animate this look.",
        retryable: true,
      };
    }

    const url = extractOutputUrl(data.output);
    if (!url) {
      return {
        status: "failed",
        provider: "runway",
        id: handle.id,
        message: "Runway reported success without a video.",
        retryable: true,
      };
    }

    const download = await fetch(url);
    if (!download.ok) {
      return {
        status: "failed",
        provider: "runway",
        id: handle.id,
        message: `could not download the animation (${download.status})`,
        retryable: true,
      };
    }
    return {
      status: "success",
      provider: "runway",
      id: handle.id,
      video: Buffer.from(await download.arrayBuffer()),
      contentType: download.headers.get("content-type") ?? "video/mp4",
    };
  },

  async submitImage(request: RunwayImageRequest): Promise<RunwayHandle> {
    const referenceImages = (request.referenceImages ?? []).map((ref) => {
      if (!REFERENCE_TAG_PATTERN.test(ref.tag)) {
        throw new ProviderError(
          "runway",
          400,
          `Invalid Runway reference image tag "${ref.tag}" (must match ^[a-zA-Z][a-zA-Z0-9_]{2,15}$)`,
          { retryable: false },
        );
      }
      return {
        uri: toDataUri(ref.image, ref.contentType),
        tag: ref.tag,
      };
    });

    const response = await requestJson<TaskEnvelope>(
      `${env.runwayBaseUrl}${IMAGE_SUBMIT_PATH}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: request.model ?? env.runwayImageModel,
          promptText: request.promptText,
          ratio: request.ratio ?? env.runwayImageRatio,
          thinkingLevel: request.thinkingLevel ?? "medium",
          outputCount: request.outputCount ?? 1,
          referenceImages,
        }),
      },
      { provider: "runway", timeoutMs: 60_000, retries: 1 },
    );

    if (!response.ok || !response.data?.id) {
      throw new ProviderError(
        "runway",
        response.status,
        `image task rejected: ${response.data?.failure ?? response.text.slice(0, 200)}`,
        { retryable: response.status >= 500, body: response.text },
      );
    }

    return { id: response.data.id, provider: "runway" };
  },

  async pollImage(handle: RunwayHandle): Promise<RunwayImageState> {
    const response = await requestJson<TaskEnvelope>(
      `${env.runwayBaseUrl}/v1/tasks/${encodeURIComponent(handle.id)}`,
      { method: "GET", headers: authHeaders() },
      { provider: "runway", timeoutMs: 30_000, retries: 1 },
    );

    if (!response.ok) {
      return {
        status: "failed",
        message: `image status check failed (${response.status})`,
        retryable: response.status >= 500,
      };
    }

    const payload = response.data ?? {};
    const state = normalizeStatus(payload.status);
    if (state === "pending") {
      return {
        status: "pending",
        progress: typeof payload.progress === "number" ? payload.progress : undefined,
      };
    }
    if (state === "failed") {
      return {
        status: "failed",
        message:
          payload.failure ??
          payload.error ??
          "Runway could not generate the revised product image.",
        retryable: true,
      };
    }

    const outputUrl = extractOutputUrl(payload.output);
    if (!outputUrl) {
      return {
        status: "failed",
        message: "Runway reported success without an output image URL.",
        retryable: true,
      };
    }

    try {
      const { image, contentType } = await downloadImage(outputUrl);
      return {
        status: "success",
        image,
        contentType,
      };
    } catch (error) {
      return {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Could not download the generated Runway image.",
        retryable: true,
      };
    }
  },
};
