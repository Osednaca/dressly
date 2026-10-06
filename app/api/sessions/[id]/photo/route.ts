export const dynamic = "force-dynamic";

import { badRequest, json, notFound, serverError } from "@/lib/server/respond";
import { sessionPayload } from "@/lib/server/session-payload";
import { recompute } from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import { UPLOAD_DIR, ensureDirs, extFromContentType, writeDataFile } from "@/lib/storage/files";
import { mediaUrl } from "@/lib/storage/media";
import { newId } from "@/lib/util/id";

type Context = { params: Promise<{ id: string }> };

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Accept the shopper's full-body photo.
 *
 * This is the one image the shopper provides, and it is only ever sent to YouCam.
 * It is stored under `data/`, never `public/`, and served back through the media route.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const session = await getSession(id);
    if (!session) return notFound("Session not found");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("Upload a photo file under the `file` field.");
    if (!file.type.startsWith("image/")) return badRequest("The photo must be an image.");
    if (file.size === 0) return badRequest("The uploaded photo is empty.");
    if (file.size > MAX_BYTES) return badRequest("The photo is larger than 12MB.");

    await ensureDirs();
    const ext = extFromContentType(file.type, "jpg");
    const fileName = `${newId("photo")}.${ext}`;
    await writeDataFile(UPLOAD_DIR, fileName, Buffer.from(await file.arrayBuffer()));

    const updated = await mutateSession(id, (current) =>
      recompute({ ...current, userPhotoPath: mediaUrl("uploads", fileName) }),
    );
    return json(sessionPayload(updated ?? session));
  } catch (error) {
    return serverError(error);
  }
}
