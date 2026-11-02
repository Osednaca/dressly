import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { isSupabaseStorage, supabaseBucket, supabaseRequest } from "@/lib/storage/supabase";

/**
 * Every byte Dressly persists lives under one directory tree so the whole runtime
 * state can be deleted, inspected or archived as a unit. Never inside `public/`:
 * user photos and generated try-ons must be served through a route that can gate
 * access, not as static files.
 */
export const DATA_ROOT = path.join(process.cwd(), "data");

export const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");
export const RESULT_DIR = path.join(DATA_ROOT, "results");
export const SESSION_DIR = path.join(DATA_ROOT, "sessions");
export const VIDEO_DIR = path.join(DATA_ROOT, "videos");

export async function ensureDirs(): Promise<void> {
  if (isSupabaseStorage()) return;
  await Promise.all(
    [UPLOAD_DIR, RESULT_DIR, SESSION_DIR, VIDEO_DIR].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
}

function objectPath(dir: string, name: string): string {
  const kind = new Map([[UPLOAD_DIR, "uploads"], [RESULT_DIR, "results"], [VIDEO_DIR, "videos"]]).get(dir);
  if (!kind) throw new Error("Unsupported Supabase media directory");
  return `/storage/v1/object/${encodeURIComponent(supabaseBucket())}/${kind}/${encodeURIComponent(assertSafeName(name))}`;
}

/** Reject traversal before touching the filesystem. Ids are always our own tokens. */
export function assertSafeName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
    throw new Error(`unsafe file name: ${name}`);
  }
  return name;
}

export async function writeDataFile(
  dir: string,
  name: string,
  contents: Buffer | string,
): Promise<string> {
  await ensureDirs();
  const safe = assertSafeName(name);
  if (isSupabaseStorage()) {
    const bytes = typeof contents === "string" ? Buffer.from(contents) : contents;
    await supabaseRequest(objectPath(dir, safe), {
      method: "POST",
      headers: { "Content-Type": contentTypeFromExt(path.extname(safe).slice(1)), "x-upsert": "true" },
      body: new Uint8Array(bytes),
    });
    return path.join(dir, safe);
  }
  const target = path.join(dir, safe);
  await writeFile(target, contents);
  return target;
}

export async function readDataFile(dir: string, name: string): Promise<Buffer> {
  const safe = assertSafeName(name);
  if (isSupabaseStorage()) {
    const object = objectPath(dir, safe);
    const response = await supabaseRequest(object.replace("/storage/v1/object/", "/storage/v1/object/authenticated/"));
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(path.join(dir, safe));
}

export async function readJsonFile<T>(dir: string, name: string): Promise<T | null> {
  try {
    const raw = await readDataFile(dir, name);
    return JSON.parse(raw.toString("utf8")) as T;
  } catch (error) {
    if (isSupabaseStorage()) throw error;
    return null;
  }
}

export async function writeJsonFile(dir: string, name: string, value: unknown): Promise<void> {
  await writeDataFile(dir, name, JSON.stringify(value, null, 2));
}

export async function deleteDataFile(dir: string, name: string): Promise<void> {
  if (isSupabaseStorage()) {
    const object = objectPath(dir, name);
    const base = `/storage/v1/object/${encodeURIComponent(supabaseBucket())}`;
    const prefix = object.slice(base.length + 1).split("/").map(decodeURIComponent).join("/");
    await supabaseRequest(base, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [prefix] }) });
    return;
  }
  try {
    await unlink(path.join(dir, assertSafeName(name)));
  } catch {
    // Deleting something that is already gone is not an error worth surfacing.
  }
}

export function extFromContentType(contentType: string, fallback = "png"): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/svg+xml":
      return "svg";
    default:
      return fallback;
  }
}

export function contentTypeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}
