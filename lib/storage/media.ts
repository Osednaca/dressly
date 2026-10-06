import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  RESULT_DIR,
  UPLOAD_DIR,
  VIDEO_DIR,
  assertSafeName,
  contentTypeFromExt,
} from "@/lib/storage/files";

/**
 * Mapping between the browser-facing media URL and the file on disk.
 *
 * Generated images and user photos are deliberately *not* under `public/`: they are
 * served through a route so access is explicit and the path can never be used to walk
 * the filesystem. This module is the single place that knows the URL shape.
 */
export type MediaKind = "uploads" | "results" | "videos";

const DIRS: Record<MediaKind, string> = {
  uploads: UPLOAD_DIR,
  results: RESULT_DIR,
  videos: VIDEO_DIR,
};

export function isMediaKind(value: string): value is MediaKind {
  return value === "uploads" || value === "results" || value === "videos";
}

export function mediaUrl(kind: MediaKind, name: string): string {
  return `/api/media/${kind}/${encodeURIComponent(name)}`;
}

export function mediaDir(kind: MediaKind): string {
  return DIRS[kind];
}

export function extname(name: string): string {
  return path.extname(name).replace(/^\./, "").toLowerCase();
}

export function contentTypeFor(name: string): string {
  return contentTypeFromExt(extname(name));
}

/** Build a disk path from a browser media URL, or null when the URL is not ours. */
export function diskPathFromMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^\/api\/media\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, kind, rawName] = match;
  if (!kind || !rawName || !isMediaKind(kind)) return null;
  try {
    const name = assertSafeName(decodeURIComponent(rawName));
    return path.join(DIRS[kind], name);
  } catch {
    return null;
  }
}

/** Read the bytes behind one of our own media URLs, with its content type. */
export async function readMediaBytes(
  url: string | null | undefined,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const disk = diskPathFromMediaUrl(url);
  if (!disk) return null;
  const name = path.basename(disk);
  try {
    // The path is validated against the `data/` tree above; excluding it from static
    // tracing stops Turbopack from bundling the whole project into the server output.
    const bytes = await readFile(/* turbopackIgnore: true */ disk);
    return { bytes, contentType: contentTypeFor(name) };
  } catch {
    return null;
  }
}
