export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readDataFile } from "@/lib/storage/files";
import { contentTypeFor, isMediaKind, mediaDir } from "@/lib/storage/media";
import { assertSafeName } from "@/lib/storage/files";

type Context = { params: Promise<{ segments: string[] }> };

/**
 * Serve user artifacts: uploaded photos, generated try-ons and animations.
 *
 * These live under `data/`, not `public/`, so they are read through this route where
 * the file name is validated before touching the filesystem.
 */
export async function GET(_request: Request, context: Context) {
  try {
    const { segments } = await context.params;
    if (segments.length !== 2) return new NextResponse("Not found", { status: 404 });
    const [kind, rawName] = segments;
    if (!kind || !rawName || !isMediaKind(kind)) {
      return new NextResponse("Not found", { status: 404 });
    }
    const name = assertSafeName(rawName);
    const bytes = await readDataFile(mediaDir(kind), name);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(name),
        "Cache-Control": "private, max-age=60",
        "Content-Length": String(bytes.length),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
