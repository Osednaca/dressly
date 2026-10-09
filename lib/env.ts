/**
 * Server-side environment access.
 *
 * Every provider credential is read here and only here, and every consumer is a
 * server module. Nothing in this file may be imported from a client component.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function flag(name: string, fallback: boolean): boolean {
  const value = read(name);
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export const env = {
  /** YouCam / Perfect Corp. The mandated core try-on engine. */
  youcamApiKey: read("YOUCAM_API_KEY"),
  youcamBaseUrl: read("YOUCAM_API_URL") ?? "https://yce-api-01.makeupar.com",
  youcamPollIntervalMs: Number(read("YOUCAM_POLL_INTERVAL_MS") ?? 3000),
  youcamTimeoutMs: Number(read("YOUCAM_TIMEOUT_MS") ?? 120_000),

  /** JEV (TypeSafe System One) — the decision engine. */
  typesafeApiKey: read("TYPESAFE_API_KEY"),
  /**
   * Origin only. The official `@typesafe-ai/sdk` appends its own fixed `/v1/systemone`
   * path, so a full URL here would produce a doubled path.
   */
  typesafeBaseUrl: read("TYPESAFE_API_URL") ?? "https://api.typesafe.ai",
  jevModel: read("JEV_MODEL") ?? "jev-1.13.0",
  jevTimeoutMs: Number(read("JEV_TIMEOUT_MS") ?? 20_000),

  /** Gemini — language and multimodal understanding. */
  geminiApiKey: read("GEMINI_API_KEY"),
  geminiModel: read("GEMINI_MODEL") ?? "gemini-3.8-flash",
  geminiTimeoutMs: Number(read("GEMINI_TIMEOUT_MS") ?? 30_000),
  /** Gemini Live — the real-time spoken stylist. */
  geminiLiveModel: read("GEMINI_LIVE_MODEL") ?? "gemini-3.8-live",

  /** Runway — optional P2 animation only. */
  runwayApiKey: read("RUNWAY_API_KEY"),
  runwayBaseUrl: read("RUNWAY_API_URL") ?? "https://api.dev.runwayml.com",
  /**
   * Any image-to-video model the Runway API exposes, e.g. `gemini_omni_flash_1.1`
   * (Google's Gemini Omni, hosted by Runway), `gen4_turbo`, `veo3.1`, `seedance2`.
   * Sent verbatim as the request `model`.
   */
  runwayModel: read("RUNWAY_MODEL") ?? "gen4_turbo",
  /** Output aspect ratio; must be one the chosen model supports. */
  runwayRatio: read("RUNWAY_RATIO") ?? "720:1280",
  /** Output duration in seconds; must be within the chosen model's range. */
  runwayDurationSeconds: Number(read("RUNWAY_DURATION_SECONDS") ?? 5),
  runwayEnabled: flag("RUNWAY_ENABLED", false),

  /**
   * Development only. Simulates provider responses so the UI can be built without
   * credentials. Must never back a recorded or judged demo.
   */
  mockExternalApis: flag("DRESSLY_MOCK_EXTERNAL_APIS", false),

  /** Preloads a reliable curated flow. Still uses real provider calls. */
  demoMode: flag("DRESSLY_DEMO_MODE", false),
} as const;

export interface ProviderStatus {
  id: "youcam" | "jev" | "gemini" | "runway";
  label: string;
  role: string;
  /** True when a real credential is present. */
  configured: boolean;
  /** True when this provider is expected to be reachable for the current run. */
  active: boolean;
  detail: string;
}

/** Truthful provider state for the UI banner. Never over-claims a live integration. */
export function providerStatuses(): ProviderStatus[] {
  const mock = env.mockExternalApis;
  return [
    {
      id: "youcam",
      label: "YouCam",
      role: "Virtual try-on",
      configured: Boolean(env.youcamApiKey),
      active: Boolean(env.youcamApiKey) && !mock,
      detail: mock
        ? "Mocked in development"
        : env.youcamApiKey
          ? "Live"
          : "Missing YOUCAM_API_KEY",
    },
    {
      id: "jev",
      label: "JEV",
      role: "Decision engine",
      configured: Boolean(env.typesafeApiKey),
      active: Boolean(env.typesafeApiKey) && !mock,
      detail: mock
        ? "Mocked in development"
        : env.typesafeApiKey
          ? `Live (${env.jevModel})`
          : "Missing TYPESAFE_API_KEY",
    },
    {
      id: "gemini",
      label: "Gemini",
      role: "Language understanding",
      configured: Boolean(env.geminiApiKey),
      active: Boolean(env.geminiApiKey) && !mock,
      detail: mock
        ? "Mocked in development"
        : env.geminiApiKey
          ? `Live (${env.geminiModel})`
          : "Missing GEMINI_API_KEY",
    },
    {
      id: "runway",
      label: "Runway",
      role: "Optional animation",
      configured: Boolean(env.runwayApiKey),
      active: Boolean(env.runwayApiKey) && env.runwayEnabled && !mock,
      detail: !env.runwayEnabled
        ? "Disabled by feature flag"
        : env.runwayApiKey
          ? "Live"
          : "Missing RUNWAY_API_KEY",
    },
  ];
}

/**
 * True when the app is running without the credentials the demo depends on.
 * The UI surfaces this loudly so fake results are never mistaken for real ones.
 */
export function isDegraded(): boolean {
  return env.mockExternalApis || !env.youcamApiKey || !env.typesafeApiKey || !env.geminiApiKey;
}
