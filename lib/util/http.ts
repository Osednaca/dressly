/**
 * HTTP plumbing shared by every provider client.
 *
 * Providers fail in three interesting ways: they hang, they rate-limit, and they
 * return 5xx. All three are retryable; a 4xx is not. Encoding that here keeps each
 * provider client focused on its own request/response schema.
 */

export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly body: string;

  constructor(
    provider: string,
    status: number,
    message: string,
    options: { retryable?: boolean; body?: string } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.retryable = options.retryable ?? false;
    this.body = options.body ?? "";
  }
}

export interface RequestOptions {
  provider: string;
  timeoutMs: number;
  /** Additional attempts after the first. Default 2. */
  retries?: number;
  retryDelayMs?: number;
}

export interface JsonResponse<T> {
  status: number;
  ok: boolean;
  data: T | null;
  text: string;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One HTTP attempt with a hard deadline. Network failures and timeouts are
 * normalized into `ProviderError` so callers never see a raw `AbortError`.
 */
async function attempt(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<JsonResponse<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: unknown = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: response.status, ok: response.ok, data, text };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ProviderError(
      options.provider,
      aborted ? 408 : 0,
      aborted
        ? `request timed out after ${options.timeoutMs}ms`
        : `network failure: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JSON request with bounded retries. Returns the parsed body even on failure so a
 * provider's own error payload can be surfaced to the UI verbatim.
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<JsonResponse<T>> {
  const retries = options.retries ?? 2;
  const delay = options.retryDelayMs ?? 700;
  let lastError: ProviderError | null = null;

  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    try {
      const result = await attempt(url, init, options);
      if (result.ok) {
        return { status: result.status, ok: true, data: result.data as T, text: result.text };
      }
      const error = new ProviderError(
        options.provider,
        result.status,
        `HTTP ${result.status}`,
        { retryable: RETRYABLE_STATUS.has(result.status), body: result.text },
      );
      if (!error.retryable || attemptIndex === retries) {
        return {
          status: result.status,
          ok: false,
          data: result.data as T | null,
          text: result.text,
        };
      }
      lastError = error;
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || attemptIndex === retries) {
        throw error;
      }
      lastError = error;
    }
    await sleep(delay * 2 ** attemptIndex);
  }

  throw lastError ?? new ProviderError(options.provider, 0, "request failed");
}

/** True when a credential is absent. Callers use this to choose mock or degraded paths. */
export function isMissingKey(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}
