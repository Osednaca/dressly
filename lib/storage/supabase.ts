/** Server-only Supabase REST transport. Never expose the secret to a browser. */
export class SupabaseRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Supabase request failed: HTTP ${status}`);
    this.status = status;
  }
}
export function isSupabaseStorage(): boolean {
  const backend = process.env.DRESSLY_STORAGE_BACKEND?.trim();
  if (backend && backend !== "local" && backend !== "supabase") {
    throw new Error("DRESSLY_STORAGE_BACKEND must be local or supabase");
  }
  if (process.env.VERCEL && backend !== "supabase") {
    throw new Error("Vercel requires DRESSLY_STORAGE_BACKEND=supabase");
  }
  return backend === "supabase";
}

function config() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new Error("Supabase storage requires SUPABASE_URL and SUPABASE_SECRET_KEY");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid SUPABASE_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SUPABASE_URL must be an HTTPS origin");
  }
  return { origin: url.origin, key };
}

export function supabaseBucket(): string {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "dressly-private";
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket) || bucket.includes("..")) {
    throw new Error("Invalid SUPABASE_STORAGE_BUCKET");
  }
  return bucket;
}

export async function supabaseRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/rest/v1/") && !path.startsWith("/storage/v1/")) {
    throw new Error("Invalid Supabase request path");
  }
  const { origin, key } = config();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  // New sb_secret_* keys are not JWTs. Legacy service-role JWTs use Bearer auth.
  if (key.startsWith("sb_secret_")) headers.delete("Authorization");
  else headers.set("Authorization", `Bearer ${key}`);
  let response: Response;
  try { response = await fetch(origin + path, { ...init, headers }); }
  catch { throw new Error("Supabase request failed: network error"); }
  if (!response.ok) throw new SupabaseRequestError(response.status);
  return response;
}
