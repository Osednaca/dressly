import { env } from "@/lib/env";
import type { YouCamGarmentCategory } from "@/lib/types";
import { ProviderError, requestJson } from "@/lib/util/http";
import type { TryOnEngine, TryOnHandle, TryOnRequest, TryOnState } from "@/services/contracts";

/**
 * YouCam / Perfect Corp Clothes Virtual Try-On (`cloth-v4`).
 *
 * The lifecycle is genuinely asynchronous and Dressly implements all of it:
 *
 *   1. POST /s2s/v2.0/file            -> file_id + presigned upload request
 *   2. PUT  <presigned url>           -> raw bytes land in YouCam storage
 *   3. POST /s2s/v2.0/task/cloth-v4   -> task_id
 *   4. GET  /s2s/v2.0/task/cloth-v4/{task_id} -> running | success | error
 *
 * This module owns that protocol and nothing else. It has no opinion about styling.
 */

const FILE_PATH = "/s2s/v2.0/file";
const TASK_PATH = "/s2s/v2.0/task/cloth-v4";

interface YouCamEnvelope<T> {
  status?: number;
  data?: T;
  error?: string | { code?: string; message?: string };
  error_code?: string;
  message?: string;
}

interface FileEntry {
  file_id: string;
  requests: { method?: string; url: string; headers?: Record<string, string> }[];
}

interface TaskCreateData {
  task_id: string;
}

interface TaskStatusData {
  task_status?: string;
  results?: { url?: string } | { url?: string }[];
  error?: string | null;
  error_message?: string | null;
}

function authHeaders(): Record<string, string> {
  if (!env.youcamApiKey) {
    throw new ProviderError("youcam", 401, "YOUCAM_API_KEY is not configured", {
      retryable: false,
    });
  }
  return { Authorization: `Bearer ${env.youcamApiKey}` };
}

function opts(provider: string, timeoutMs: number, retries = 2) {
  return { provider, timeoutMs, retries };
}

/** Pull the provider's own error text out so the UI can show it verbatim. */
function providerMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const envelope = payload as YouCamEnvelope<unknown>;
    if (typeof envelope.error === "string" && envelope.error.length > 0) return envelope.error;
    if (typeof envelope.error === "object" && envelope.error !== null) {
      const nested = envelope.error as { code?: string; message?: string };
      return [nested.code, nested.message].filter(Boolean).join(": ") || fallback;
    }
    if (envelope.error_code) return envelope.error_code;
    if (envelope.message) return envelope.message;
  }
  return fallback;
}

function unwrap<T>(payload: unknown, context: string): T {
  const envelope = payload as YouCamEnvelope<T> | null;
  if (!envelope || typeof envelope !== "object") {
    throw new ProviderError("youcam", 502, `${context}: empty response`, { retryable: true });
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new ProviderError("youcam", 502, `${context}: ${providerMessage(payload, "no data")}`, {
      retryable: true,
    });
  }
  return envelope.data;
}

async function uploadAsset(
  bytes: Buffer,
  contentType: string,
  fileName: string,
): Promise<string> {
  const create = await requestJson<unknown>(
    `${env.youcamBaseUrl}${FILE_PATH}`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ content_type: contentType, file_name: fileName, file_size: bytes.length }],
      }),
    },
    opts("youcam", env.youcamTimeoutMs),
  );

  if (!create.ok) {
    throw new ProviderError(
      "youcam",
      create.status,
      `file registration failed: ${providerMessage(create.data, create.text.slice(0, 300))}`,
      { retryable: create.status >= 500 || create.status === 429, body: create.text },
    );
  }

  const data = unwrap<{ files: FileEntry[] }>(create.data, "file registration");
  const file = data.files?.[0];
  const request = file?.requests?.[0];
  if (!file || !request) {
    throw new ProviderError("youcam", 502, "file registration returned no upload request", {
      retryable: true,
    });
  }

  const upload = await fetch(request.url, {
    method: request.method ?? "PUT",
    headers: request.headers ?? { "Content-Type": contentType },
    body: new Uint8Array(bytes),
  });

  if (!upload.ok) {
    const text = await upload.text().catch(() => "");
    throw new ProviderError(
      "youcam",
      upload.status,
      `asset upload failed (${upload.status}): ${text.slice(0, 200)}`,
      { retryable: upload.status >= 500, body: text },
    );
  }

  return file.file_id;
}

function normalizeStatus(raw: string | undefined): "pending" | "success" | "failed" {
  switch ((raw ?? "").toLowerCase()) {
    case "success":
    case "succeeded":
    case "done":
    case "completed":
      return "success";
    case "error":
    case "failed":
    case "failure":
      return "failed";
    default:
      // queued / running / processing / anything new the provider adds.
      return "pending";
  }
}

function resultUrl(data: TaskStatusData): string | null {
  const results = data.results;
  if (!results) return null;
  if (Array.isArray(results)) return results[0]?.url ?? null;
  return results.url ?? null;
}

export const youcamEngine: TryOnEngine = {
  provider: "youcam",

  async submit(request: TryOnRequest): Promise<TryOnHandle> {
    const [srcFileId, refFileId] = await Promise.all([
      uploadAsset(request.personImage, request.personContentType, "dressly-person.jpg"),
      uploadAsset(request.garmentImage, request.garmentContentType, `dressly-${request.garmentId}.jpg`),
    ]);

    const body: Record<string, unknown> = {
      src_file_id: srcFileId,
      ref_file_id: refFileId,
      garment_category: request.garmentCategory satisfies YouCamGarmentCategory,
      // "normal" ignores obvious background bystanders without the false rejections
      // that "strict" produces on casual phone photos.
      filter_multi_person: "normal",
    };
    // `change_shoes` is only honoured by the provider for these two categories.
    if (request.garmentCategory === "full_body" || request.garmentCategory === "lower_body") {
      body.change_shoes = request.changeShoes;
    }

    const created = await requestJson<unknown>(
      `${env.youcamBaseUrl}${TASK_PATH}`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      opts("youcam", env.youcamTimeoutMs, 1),
    );

    if (!created.ok) {
      throw new ProviderError(
        "youcam",
        created.status,
        `try-on task rejected: ${providerMessage(created.data, created.text.slice(0, 300))}`,
        { retryable: created.status >= 500 || created.status === 429, body: created.text },
      );
    }

    const data = unwrap<TaskCreateData>(created.data, "try-on task creation");
    if (!data.task_id) {
      throw new ProviderError("youcam", 502, "try-on task returned no task_id", { retryable: true });
    }
    return { id: data.task_id, provider: "youcam" };
  },

  async poll(handle: TryOnHandle): Promise<TryOnState> {
    const response = await requestJson<unknown>(
      `${env.youcamBaseUrl}${TASK_PATH}/${encodeURIComponent(handle.id)}`,
      { method: "GET", headers: authHeaders() },
      opts("youcam", env.youcamTimeoutMs, 1),
    );

    if (!response.ok) {
      return {
        status: "failed",
        provider: "youcam",
        id: handle.id,
        message: `status check failed (${response.status}): ${providerMessage(
          response.data,
          response.text.slice(0, 200),
        )}`,
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const data = unwrap<TaskStatusData>(response.data, "try-on status");
    const state = normalizeStatus(data.task_status);

    if (state === "pending") return { status: "pending", provider: "youcam", id: handle.id };

    if (state === "failed") {
      return {
        status: "failed",
        provider: "youcam",
        id: handle.id,
        message:
          (typeof data.error === "string" && data.error) ||
          data.error_message ||
          "YouCam could not generate this try-on. Try a clearer, full-body photo.",
        retryable: true,
      };
    }

    const url = resultUrl(data);
    if (!url) {
      return {
        status: "failed",
        provider: "youcam",
        id: handle.id,
        message: "YouCam reported success without a result image.",
        retryable: true,
      };
    }

    const download = await fetch(url, { method: "GET" });
    if (!download.ok) {
      return {
        status: "failed",
        provider: "youcam",
        id: handle.id,
        message: `could not download the result image (${download.status})`,
        retryable: true,
      };
    }

    return {
      status: "success",
      provider: "youcam",
      id: handle.id,
      image: Buffer.from(await download.arrayBuffer()),
      contentType: download.headers.get("content-type") ?? "image/jpeg",
    };
  },
};
