import { env } from "@/lib/env";
import { ProviderError, requestJson } from "@/lib/util/http";
import type {
  RunwayEngine,
  RunwayHandle,
  RunwayRequest,
  RunwayState,
} from "@/services/runway/contract";

/**
 * Runway image-to-video (`gen4_turbo`). P2 and flag-gated.
 *
 * The prompt is deliberately restrained: it may add natural movement but must never
 * alter the person or the outfit. A perfect still is better than a distorted animation,
 * so the model is told to preserve everything and move almost nothing.
 */

const VERSION = "2024-11-06";
const SUBMIT_PATH = "/v1/image_to_video";

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

interface TaskEnvelope {
  id?: string;
  status?: string;
  output?: string[] | string;
  failure?: string;
  error?: string;
}

function normalize(status: string | undefined): "pending" | "success" | "failed" {
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

function outputUrl(payload: TaskEnvelope): string | null {
  if (typeof payload.output === "string") return payload.output;
  if (Array.isArray(payload.output)) return payload.output[0] ?? null;
  return null;
}

export const runwayEngine: RunwayEngine = {
  provider: "runway",

  async submit(request: RunwayRequest): Promise<RunwayHandle> {
    const dataUri = `data:${request.imageContentType};base64,${request.image.toString("base64")}`;
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
    const state = normalize(data.status);
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

    const url = outputUrl(data);
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
};
