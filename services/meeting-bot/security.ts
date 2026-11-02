/** Public deployments must never accept or send the development shared secret. */
export function meetingBotSecretIsSafe(secret: string): boolean {
  if (!secret) return false;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return secret !== "dressly-local-bot-secret" && secret.length >= 32;
  }
  return true;
}

/** Vercel needs an externally reachable HTTPS worker and callback, not localhost. */
export function meetingBotRemoteConfigurationError(baseUrl: string, callbackUrl?: string): string | null {
  if (!process.env.VERCEL) return null;
  const externalHttps = (value: string | undefined) => {
    try {
      const parsed = new URL(value ?? "");
      return parsed.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
    } catch { return false; }
  };
  if (!externalHttps(baseUrl)) return "Set MEETING_BOT_URL to an externally hosted HTTPS bot worker.";
  if (callbackUrl !== undefined && !externalHttps(callbackUrl)) return "Set NEXT_PUBLIC_APP_URL to the public HTTPS application URL.";
  return null;
}
