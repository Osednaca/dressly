import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BlockedView, JobView } from "@/lib/api-types";
import { createJob, failJob, getJob, jobView, recordPoll, updateJob, type AgentJob } from "@/lib/agent/jobs";
import { getProduct } from "@/lib/catalog/products";
import { placeInLook, placeProduct, recordLook, clearSlot } from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import { RESULT_DIR, extFromContentType, writeDataFile } from "@/lib/storage/files";
import { contentTypeFor, readMediaBytes, mediaUrl } from "@/lib/storage/media";
import type { AgentAction, Look, Product, StylingSession } from "@/lib/types";
import { newId } from "@/lib/util/id";
import { ProviderError } from "@/lib/util/http";
import { tryOnEngine } from "@/services/youcam";
import type { TryOnState } from "@/services/contracts";

/**
 * The chained try-on.
 *
 * Each garment is applied on top of the *previous result*, never the original photo.
 * That single decision is what makes an outfit evolve as one continuous look instead of
 * a set of unrelated single-garment renders, and it is faithful to YouCam's API, which
 * takes a source body image and a garment reference.
 */

export interface StartTryOnResult {
  job: AgentJob | null;
  blocked: BlockedView | null;
}

async function readPublicAsset(imagePath: string): Promise<{ bytes: Buffer; contentType: string }> {
  const relative = imagePath.replace(/^\/+/, "");
  const disk = path.join(process.cwd(), "public", relative);
  const bytes = await readFile(disk);
  return { bytes, contentType: contentTypeFor(relative) };
}

function blockedFromError(error: unknown): BlockedView {
  if (error instanceof ProviderError) {
    return { code: "YOUCAM_UNAVAILABLE", message: error.message, retryable: error.retryable };
  }
  return {
    code: "TRYON_FAILED",
    message: error instanceof Error ? error.message : "The try-on could not be started.",
    retryable: true,
  };
}

export async function startTryOn(
  session: StylingSession,
  selection: { product: Product; action: AgentAction },
): Promise<StartTryOnResult> {
  const { product } = selection;
  if (!session.userPhotoPath) {
    return {
      job: null,
      blocked: {
        code: "PHOTO_REQUIRED",
        message: "Add a full-body photo first so Dressly can dress you.",
        retryable: false,
      },
    };
  }
  if (product.vtoCategory === null) {
    return {
      job: null,
      blocked: {
        code: "NOT_VTO_CAPABLE",
        message: `${product.name} is a styling add-on and cannot be tried on virtually.`,
        retryable: false,
      },
    };
  }

  try {
    const engine = tryOnEngine();
    const active = session.looks.find((look) => look.id === session.activeLookId);
    const baseImageUrl = active?.imagePath ?? session.userPhotoPath;

    const [person, garment] = await Promise.all([
      readMediaBytes(baseImageUrl),
      readPublicAsset(product.image),
    ]);
    if (!person) {
      return {
        job: null,
        blocked: {
          code: "PHOTO_REQUIRED",
          message: "Your uploaded photo could not be read. Please add it again.",
          retryable: false,
        },
      };
    }

    const handle = await engine.submit({
      personImage: person.bytes,
      personContentType: person.contentType,
      garmentImage: garment.bytes,
      garmentContentType: garment.contentType,
      garmentCategory: product.vtoCategory,
      changeShoes: true,
      garmentId: product.id,
      garmentName: product.name,
    });

    const job = createJob({
      id: newId("job"),
      sessionId: session.id,
      kind: "tryon",
      provider: engine.provider,
      handle,
      productId: product.id,
      productName: product.name,
      action: selection.action,
      baseImageUrl,
      pendingItems: placeInLook(session.currentLook, product),
      startedAt: Date.now(),
      status: "pending",
      polls: 0,
    });
    return { job, blocked: null };
  } catch (error) {
    return { job: null, blocked: blockedFromError(error) };
  }
}

export interface PollTryOnResult {
  job: JobView;
  session?: StylingSession;
  look?: Look;
}

async function commitLook(job: AgentJob, state: TryOnState & { status: "success" }): Promise<PollTryOnResult> {
  const product = job.productId ? getProduct(job.productId) : undefined;
  const ext = extFromContentType(state.contentType, "png");
  const lookId = newId("look");
  const fileName = `${lookId}.${ext}`;
  await writeDataFile(RESULT_DIR, fileName, state.image);
  const imagePath = mediaUrl("results", fileName);

  const next = await mutateSession(job.sessionId, (current) => {
    let session = current;
    if (job.action === "CHANGE_FULL_OUTFIT") {
      session = clearSlot(session, "upper_body");
      session = clearSlot(session, "lower_body");
      session = clearSlot(session, "outer");
      session = clearSlot(session, "shoes");
    }
    if (product) session = placeProduct(session, product);
    session = recordLook(session, {
      id: lookId,
      imagePath,
      previousImagePath: job.baseImageUrl,
      items: job.pendingItems,
      addedProductId: job.productId,
      feedback: "pending",
      label: `Look ${session.looks.length + 1}`,
    });
    return session;
  });

  updateJob(job.id, { status: "success", lookId });
  const updated = getJob(job.id) ?? job;
  const look = next?.looks.find((entry) => entry.id === lookId);
  return { job: jobView(updated, look?.index), session: next ?? undefined, look };
}

export async function pollTryOn(jobId: string): Promise<PollTryOnResult | null> {
  const job = getJob(jobId);
  if (!job) return null;
  if (job.status === "success") {
    const session = await getSession(job.sessionId);
    const look = session?.looks.find((entry) => entry.id === job.lookId);
    return { job: jobView(job, look?.index), session: session ?? undefined, look };
  }
  if (job.status === "failed") return { job: jobView(job) };

  recordPoll(job.id);
  try {
    const state = await tryOnEngine().poll(job.handle as { id: string; provider: "youcam" | "mock" });
    if (state.status === "pending") {
      const refreshed = getJob(job.id) ?? job;
      return { job: jobView(refreshed) };
    }
    if (state.status === "failed") {
      failJob(job.id, state.message, state.retryable);
      const refreshed = getJob(job.id) ?? job;
      return { job: jobView(refreshed) };
    }
    return await commitLook(job, state as TryOnState & { status: "success" });
  } catch (error) {
    failJob(job.id, error instanceof Error ? error.message : "poll failed", true);
    const refreshed = getJob(job.id) ?? job;
    return { job: jobView(refreshed) };
  }
}

/** Re-submit a failed try-on for the same garment, e.g. after a transient outage. */
export async function retryTryOn(jobId: string): Promise<StartTryOnResult> {
  const job = getJob(jobId);
  if (!job) {
    return { job: null, blocked: { code: "NO_JOB", message: "That request has expired.", retryable: false } };
  }
  const product = job.productId ? getProduct(job.productId) : undefined;
  const session = await getSession(job.sessionId);
  if (!product || !session) {
    return { job: null, blocked: { code: "NO_JOB", message: "That request can no longer be retried.", retryable: false } };
  }
  const action = job.action ?? "CHANGE_FULL_OUTFIT";
  return startTryOn(session, { product, action });
}
