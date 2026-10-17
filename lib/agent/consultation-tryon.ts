import type { BlockedView, JobPollResponse, JobView } from "@/lib/api-types";
import { readDesignImageBytes } from "@/lib/agent/consultation-runway";
import {
  createJob,
  failJob,
  getJob,
  jobView,
  recordPoll,
  updateJob,
} from "@/lib/agent/jobs";
import { suggestionsFor } from "@/lib/agent/suggestions";
import { publishConsultationEvent } from "@/lib/server/consultation-events";
import { logConsultationMilestone } from "@/lib/server/consultation-logger";
import {
  appendConsultationActivity,
  attachTryOnToVersion,
  buildCustomBagProduct,
  placeInLook,
  placeProduct,
  recordLook,
  setConsultationStatus,
} from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import { RESULT_DIR, extFromContentType, writeDataFile } from "@/lib/storage/files";
import { mediaUrl, readMediaBytes } from "@/lib/storage/media";
import type { Look, StylingSession } from "@/lib/types";
import { ProviderError } from "@/lib/util/http";
import { newId } from "@/lib/util/id";
import type { TryOnEngine } from "@/services/contracts";
import { tryOnEngine } from "@/services/youcam";

const INITIAL_TRYON_STEP = "Preparing custom handbag virtual try-on";
const PENDING_TRYON_STEPS: readonly string[] = [
  "Fitting custom handbag onto your photo",
  "Harmonizing lighting, scale, and proportions",
  "Finalizing virtual try-on",
];
const TRYON_FAILED_MESSAGE =
  "We couldn't complete the custom handbag virtual try-on. Please try again.";

export interface StartConsultationTryOnResult {
  job: JobView | null;
  blocked: BlockedView | null;
  session: StylingSession;
}

export interface StartConsultationTryOnOptions {
  engine?: TryOnEngine;
}

async function resolvePersonBytes(
  imagePath: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const media = await readMediaBytes(imagePath);
  if (media) return media;
  if (!imagePath.startsWith("/api/media/")) {
    return await readDesignImageBytes(imagePath).catch(() => null);
  }
  return null;
}

export async function startConsultationTryOn(
  session: StylingSession,
  versionId?: string,
  options?: StartConsultationTryOnOptions,
): Promise<StartConsultationTryOnResult> {
  const consultation = session.consultation;
  if (!consultation) {
    return {
      job: null,
      blocked: {
        code: "NO_CONSULTATION",
        message: "Start a live consultation before previewing virtual try-on.",
        retryable: false,
      },
      session,
    };
  }

  const targetVersionId = versionId ?? consultation.currentDesignVersionId;
  const version =
    consultation.versions.find((v) => v.id === targetVersionId) ??
    consultation.versions.find((v) => v.id === consultation.currentDesignVersionId) ??
    consultation.versions.at(-1);

  if (!version) {
    return {
      job: null,
      blocked: {
        code: "NO_DESIGN_VERSION",
        message: "No design version is available for virtual try-on.",
        retryable: false,
      },
      session,
    };
  }

  if (!session.userPhotoPath) {
    return {
      job: null,
      blocked: {
        code: "PHOTO_REQUIRED",
        message: "Upload your photo first to preview this custom design on yourself.",
        retryable: false,
      },
      session,
    };
  }

  const activeLook = session.looks.find((look) => look.id === session.activeLookId);
  const baseImageUrl = activeLook?.imagePath ?? session.userPhotoPath;

  const [base, designImg] = await Promise.all([
    resolvePersonBytes(baseImageUrl),
    readDesignImageBytes(version.imageUrl).catch(() => null),
  ]);

  if (!base) {
    return {
      job: null,
      blocked: {
        code: "PHOTO_REQUIRED",
        message: "Upload your photo first to preview this custom design on yourself.",
        retryable: false,
      },
      session,
    };
  }

  if (!designImg) {
    return {
      job: null,
      blocked: {
        code: "DESIGN_IMAGE_MISSING",
        message: "The generated design image could not be read for virtual try-on.",
        retryable: false,
      },
      session,
    };
  }

  try {
    const engine = options?.engine ?? tryOnEngine({ allowFallbackWhenDisabled: true });
    const handle = await engine.submit({
      personImage: base.bytes,
      personContentType: base.contentType,
      garmentImage: designImg.bytes,
      garmentContentType: designImg.contentType,
      garmentCategory: "auto",
      changeShoes: false,
      garmentId: version.id,
      garmentName: `${version.designState.name} (${version.label})`,
      taskKind: "bag",
      gender: "female",
      bagStyle: "style_parisian_chic",
    });

    const customBagProduct = buildCustomBagProduct(version);
    const job = createJob({
      id: newId("job"),
      sessionId: session.id,
      kind: "consultation_tryon",
      provider: handle.provider,
      handle,
      externalId: handle.id,
      versionId: version.id,
      tryOnTaskKind: handle.taskKind ?? "bag",
      productId: customBagProduct.id,
      productName: customBagProduct.name,
      action: "ADD_ACCESSORY",
      baseImageUrl,
      pendingItems: placeInLook(session.currentLook, customBagProduct),
      startedAt: Date.now(),
      status: "pending",
      step: INITIAL_TRYON_STEP,
      polls: 0,
    });

    const mutated = await mutateSession(session.id, (current) =>
      appendConsultationActivity(
        setConsultationStatus(current, "GENERATING_TRYON"),
        "tryon",
        `Starting virtual try-on for V${version.version}...`,
      ),
    );
    const updated =
      mutated ??
      appendConsultationActivity(
        setConsultationStatus(session, "GENERATING_TRYON"),
        "tryon",
        `Starting virtual try-on for V${version.version}...`,
      );

    const view = jobView(job);
    logConsultationMilestone("YouCam started", {
      sessionId: session.id,
      jobId: view.id,
      provider: view.provider,
      versionId: version.id,
      version: version.version,
      taskKind: handle.taskKind ?? "bag",
    });
    publishConsultationEvent(session.id, {
      type: "vto.started",
      job: view,
      versionId: version.id,
      session: updated,
    });

    return {
      job: view,
      blocked: null,
      session: updated,
    };
  } catch (err) {
    if (err instanceof ProviderError) {
      const customBagProduct = buildCustomBagProduct(version);
      const activityText = `Virtual try-on unavailable (${err.message}) — custom design V${version.version} preserved.`;
      const blocked: BlockedView = {
        code: "BAG_VTO_UNAVAILABLE",
        message: `YouCam Bag Virtual Try-On could not process this request (${err.message}). Your generated V${version.version} design is preserved on stage.`,
        retryable: err.retryable,
      };

      const mutated = await mutateSession(session.id, (current) => {
        const withBag = placeProduct(current, customBagProduct);
        return appendConsultationActivity(
          setConsultationStatus(withBag, "LIVE"),
          "error",
          activityText,
        );
      });
      const updated =
        mutated ??
        appendConsultationActivity(
          setConsultationStatus(placeProduct(session, customBagProduct), "LIVE"),
          "error",
          activityText,
        );

      publishConsultationEvent(session.id, {
        type: "vto.failed",
        blocked,
        message: blocked.message,
        session: updated,
      });

      return {
        job: null,
        blocked,
        session: updated,
      };
    }

    console.error("[dressly] consultation try-on could not start:", err);
    const blocked: BlockedView = {
      code: "TRYON_FAILED",
      message: TRYON_FAILED_MESSAGE,
      retryable: true,
    };
    const mutated = await mutateSession(session.id, (current) =>
      appendConsultationActivity(
        setConsultationStatus(current, "LIVE"),
        "error",
        TRYON_FAILED_MESSAGE,
      ),
    );
    const updated =
      mutated ??
      appendConsultationActivity(
        setConsultationStatus(session, "LIVE"),
        "error",
        TRYON_FAILED_MESSAGE,
      );

    publishConsultationEvent(session.id, {
      type: "vto.failed",
      blocked,
      message: blocked.message,
      session: updated,
    });

    return {
      job: null,
      blocked,
      session: updated,
    };
  }
}

function pendingTryOnStep(polls: number): string {
  const index = Math.min(Math.max(0, polls - 1), PENDING_TRYON_STEPS.length - 1);
  return PENDING_TRYON_STEPS[index] ?? PENDING_TRYON_STEPS[0]!;
}

export async function pollConsultationTryOn(
  jobId: string,
): Promise<JobPollResponse | null> {
  const job = getJob(jobId);
  if (!job || job.kind !== "consultation_tryon") return null;

  if (job.status === "success") {
    const session = await getSession(job.sessionId);
    const look = session?.looks.find((entry) => entry.id === job.lookId);
    return {
      job: jobView(job, look?.index),
      session: session ?? undefined,
      suggestions: session ? suggestionsFor(session) : undefined,
      look,
    };
  }

  if (job.status === "failed") {
    const session = await getSession(job.sessionId);
    return {
      job: jobView(job),
      session: session ?? undefined,
    };
  }

  const polled = recordPoll(job.id) ?? job;
  const externalId = polled.externalId ?? polled.handle.id;

  try {
    const engine = tryOnEngine({ allowFallbackWhenDisabled: true });
    const state = await engine.poll({
      id: externalId,
      provider: polled.provider as "youcam" | "mock",
      taskKind: polled.tryOnTaskKind ?? "bag",
    });

    if (state.status === "pending") {
      const step = pendingTryOnStep(polled.polls);
      const updated = updateJob(job.id, { step }) ?? polled;
      return { job: jobView(updated) };
    }

    if (state.status === "failed") {
      console.error(`[dressly] consultation try-on ${job.id} failed:`, state.message);
      const failedMessage = state.message || TRYON_FAILED_MESSAGE;
      const failed = failJob(job.id, failedMessage, state.retryable) ?? polled;
      const view = jobView(failed);

      const updated = await mutateSession(job.sessionId, (current) =>
        appendConsultationActivity(
          setConsultationStatus(current, "LIVE"),
          "error",
          `Virtual try-on failed: ${failedMessage}`,
        ),
      );

      if (updated) {
        publishConsultationEvent(job.sessionId, {
          type: "vto.failed",
          job: view,
          message: failedMessage,
          session: updated,
        });
      }

      return {
        job: view,
        session: updated ?? undefined,
      };
    }

    const ext = extFromContentType(state.contentType, "jpg");
    const lookId = newId("look");
    const fileName = `look_${lookId}.${ext}`;
    await writeDataFile(RESULT_DIR, fileName, state.image);
    const imagePath = mediaUrl("results", fileName);

    let createdLook: Look | undefined;
    let resolvedVersionId = polled.versionId ?? "";

    const updated = await mutateSession(job.sessionId, (current) => {
      const consultation = current.consultation;
      const version =
        consultation?.versions.find((v) => v.id === polled.versionId) ??
        consultation?.versions.find((v) => v.id === consultation?.currentDesignVersionId) ??
        consultation?.versions.at(-1);

      let next = current;
      if (version) {
        resolvedVersionId = version.id;
        const customBag = buildCustomBagProduct(version);
        next = placeProduct(next, customBag);
        next = recordLook(next, {
          id: lookId,
          imagePath,
          previousImagePath: polled.baseImageUrl,
          items: next.currentLook,
          addedProductId: customBag.id,
          feedback: "pending",
          label: `V${version.version} · ${version.label} Try-On`,
        });
        next = attachTryOnToVersion(next, version.id, lookId);
      } else {
        next = recordLook(next, {
          id: lookId,
          imagePath,
          previousImagePath: polled.baseImageUrl,
          items: polled.pendingItems,
          addedProductId: polled.productId,
          feedback: "pending",
          label: `Look ${next.looks.length + 1}`,
        });
      }
      next = setConsultationStatus(next, "LIVE");
      createdLook = next.looks.find((entry) => entry.id === lookId);
      return next;
    });

    const completedJob =
      updateJob(job.id, {
        status: "success",
        lookId,
        step: "Virtual try-on ready",
      }) ?? polled;
    const view = jobView(completedJob, createdLook?.index);

    if (updated && createdLook) {
      logConsultationMilestone("YouCam completed", {
        sessionId: job.sessionId,
        jobId: view.id,
        lookId: createdLook.id,
        versionId: resolvedVersionId,
        imagePath: createdLook.imagePath,
      });
      publishConsultationEvent(job.sessionId, {
        type: "vto.completed",
        look: createdLook,
        versionId: resolvedVersionId,
        job: view,
        session: updated,
      });
    }

    return {
      job: view,
      session: updated ?? undefined,
      suggestions: updated ? suggestionsFor(updated) : undefined,
      look: createdLook,
    };
  } catch (error) {
    console.error(`[dressly] consultation try-on ${job.id} poll failed:`, error);
    const failed = failJob(job.id, TRYON_FAILED_MESSAGE, true) ?? polled;
    const view = jobView(failed);

    const updated = await mutateSession(job.sessionId, (current) =>
      appendConsultationActivity(
        setConsultationStatus(current, "LIVE"),
        "error",
        TRYON_FAILED_MESSAGE,
      ),
    );

    if (updated) {
      publishConsultationEvent(job.sessionId, {
        type: "vto.failed",
        job: view,
        message: TRYON_FAILED_MESSAGE,
        session: updated,
      });
    }

    return {
      job: view,
      session: updated ?? undefined,
    };
  }
}

export const startConsultationTryOnJob = startConsultationTryOn;
export const pollConsultationTryOnJob = pollConsultationTryOn;
