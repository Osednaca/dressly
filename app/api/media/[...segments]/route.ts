export const dynamic = "force-dynamic";

import { readDataFile } from "@/lib/storage/files";
import { contentTypeFor, isMediaKind, mediaDir } from "@/lib/storage/media";
import { assertSafeName } from "@/lib/storage/files";
import { SupabaseRequestError, isSupabaseStorage } from "@/lib/storage/supabase";

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
    if (segments.length !== 2) return new Response("Not found", { status: 404 });
    const [kind, rawName] = segments;
    if (!kind || !rawName || !isMediaKind(kind)) {
      return new Response("Not found", { status: 404 });
    }
    let name: string;
    try { name = assertSafeName(rawName); } catch { return new Response("Not found", { status: 404 }); }
    const bytes = await readDataFile(mediaDir(kind), name);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(name),
        "Cache-Control": "private, max-age=60",
        "Content-Length": String(bytes.length),
      },
    });
  } catch (error) {
    if (isSupabaseStorage() && !(error instanceof SupabaseRequestError && error.status === 404)) {
      console.error("[dressly] media read failed:", error);
      return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
    return new Response("Not found", { status: 404 });
  }
}
