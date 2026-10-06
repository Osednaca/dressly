import type {
  BlockedView,
  ChatResponse,
  JobPollResponse,
  JobView,
  ProvidersResponse,
  SessionPayload,
} from "@/lib/api-types";

/**
 * Typed browser client for the Dressly API.
 *
 * The browser holds no authoritative state: it calls these, stores the returned
 * session, and renders it. Every error is normalized to a message the UI can show.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error?: unknown }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  providers: () => request<ProvidersResponse>("/api/providers"),
  createSession: () => postJson<SessionPayload>("/api/sessions"),
  getSession: (id: string) => request<SessionPayload>(`/api/sessions/${id}`),
  uploadPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<SessionPayload>(`/api/sessions/${id}/photo`, { method: "POST", body: form });
  },
  chat: (id: string, message: string) => postJson<ChatResponse>(`/api/sessions/${id}/chat`, { message }),
  pollJob: (jobId: string) => request<JobPollResponse>(`/api/jobs/${jobId}`),
  retryJob: (jobId: string) =>
    postJson<{ job: JobView | null; blocked: BlockedView | null }>(`/api/jobs/${jobId}/retry`),
  setFeedback: (id: string, lookId: string, feedback: "liked" | "rejected") =>
    postJson<SessionPayload>(`/api/sessions/${id}/looks/${lookId}/feedback`, { feedback }),
  restoreLook: (id: string, lookId: string) =>
    postJson<SessionPayload>(`/api/sessions/${id}/looks/${lookId}/restore`),
  finish: (id: string) => postJson<SessionPayload>(`/api/sessions/${id}/finish`),
  clearRejections: (id: string) => postJson<SessionPayload>(`/api/sessions/${id}/clear-rejections`),
  animate: (id: string, lookId?: string) =>
    postJson<{ job: JobView | null; blocked: BlockedView | null }>(`/api/sessions/${id}/runway`, {
      lookId,
    }),
};
