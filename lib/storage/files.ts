import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

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
  await Promise.all(
    [UPLOAD_DIR, RESULT_DIR, SESSION_DIR, VIDEO_DIR].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
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
  const target = path.join(dir, safe);
  await writeFile(target, contents);
  return target;
}

export async function readDataFile(dir: string, name: string): Promise<Buffer> {
  const safe = assertSafeName(name);
  return readFile(path.join(dir, safe));
}

export async function readJsonFile<T>(dir: string, name: string): Promise<T | null> {
  try {
    const raw = await readDataFile(dir, name);
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(dir: string, name: string, value: unknown): Promise<void> {
  await writeDataFile(dir, name, JSON.stringify(value, null, 2));
}

export async function deleteDataFile(dir: string, name: string): Promise<void> {
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
