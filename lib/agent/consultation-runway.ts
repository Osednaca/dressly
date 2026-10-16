import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BlockedView, JobView } from "@/lib/api-types";
import { buildNanoBananaPrompt } from "@/lib/agent/consultation-prompt";
import {
  createJob,
  failJob,
  getJob,
  jobView,
  recordPoll,
  updateJob,
} from "@/lib/agent/jobs";
import { env } from "@/lib/env";
import { publishConsultationEvent } from "@/lib/server/consultation-events";
import {
  appendConsultationActivity,
  recordDesignVersion,
  setConsultationStatus,
} from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import { RESULT_DIR, extFromContentType, writeDataFile } from "@/lib/storage/files";
import { contentTypeFor, mediaUrl, readMediaBytes } from "@/lib/storage/media";
import type {
  BagDesignState,
  DesignFieldDiff,
  DesignVersion,
  StylingSession,
} from "@/lib/types";
import { ProviderError } from "@/lib/util/http";
import { newId } from "@/lib/util/id";
import { runwayImageEngine, type RunwayReferenceImage } from "@/services/runway";

const INITIAL_DESIGN_STEP = "Rendering revised design with Runway Nano Banana 2.1";
const PENDING_STEPS: readonly string[] = [
  "Preserving reference silhouette and materials",
  "Applying approved modification with Nano Banana 2.1",
  "Finalizing studio product render",
];
const DESIGN_FAILED_MESSAGE =
  "We couldn't generate the revised bag design. Please try again.";

export async function readPublicAsset(
  imagePath: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const relative = imagePath.replace(/^\/+/, "");
  const disk = path.join(process.cwd(), "public", relative);
  const bytes = await readFile(/* turbopackIgnore: true */ disk);
  return { bytes, contentType: contentTypeFor(relative) };
}

/**
 * Resolves a consultation design image URL (`/catalog/...` or `/api/media/...`)
 * into raw bytes and content type for Runway reference images or YouCam VTO.
 */
export async function readDesignImageBytes(
  imageUrl: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  if (imageUrl.startsWith("/api/media/")) {
    const media = await readMediaBytes(imageUrl);
    if (!media) {
      throw new Error(`Design media asset could not be read: ${imageUrl}`);
    }
    return media;
  }
  return readPublicAsset(imageUrl);
}

export interface StartConsultationDesignParams {
  suggestionId?: string;
  changes: DesignFieldDiff[];
  nextState: BagDesignState;
  previousState: BagDesignState;
  highResFinal?: boolean;
}

export interface StartConsultationDesignResult {
  job: JobView | null;
  blocked: BlockedView | null;
  session: StylingSession;
}

export async function startConsultationDesign(
  session: StylingSession,
  params: StartConsultationDesignParams,
): Promise<StartConsultationDesignResult> {
  const consultation = session.consultation;
  if (!consultation) {
    return {
      job: null,
      blocked: {
        code: "NO_CONSULTATION",
        message: "Start a live consultation before generating a design revision.",
        retryable: false,
      },
      session,
    };
  }

  const currentVersion =
    consultation.versions.find((v) => v.id === consultation.currentDesignVersionId) ??
    consultation.versions.at(-1) ??
    consultation.versions[0];
  const originalVersion =
    consultation.versions.find((v) => v.id === consultation.originalVersionId) ??
    consultation.versions[0];

  if (!currentVersion) {
    return {
      job: null,
      blocked: {
        code: "NO_BASE_VERSION",
        message: "No canonical base design version is available.",
        retryable: false,
      },
      session,
    };
  }

  const includeOriginalReference = Boolean(
    originalVersion && currentVersion.id !== originalVersion.id,
  );

  const { promptText, versionLabel, versionSummary } = buildNanoBananaPrompt({
    nextState: params.nextState,
    previousState: params.previousState,
    changes: params.changes,
    includeOriginalReference,
    highResFinal: params.highResFinal,
  });

  try {
    const referenceImages: RunwayReferenceImage[] = [];
    const latestAsset = await readDesignImageBytes(currentVersion.imageUrl);
    referenceImages.push({
      image: latestAsset.bytes,
      contentType: latestAsset.contentType,
      tag: "latest_design",
    });

    if (includeOriginalReference && originalVersion) {
      const originalAsset = await readDesignImageBytes(originalVersion.imageUrl);
      referenceImages.push({
        image: originalAsset.bytes,
        contentType: originalAsset.contentType,
        tag: "original_design",
      });
    }

    const engine = runwayImageEngine({ allowFallbackWhenDisabled: true });
    const nextVersionNumber = consultation.versions.length + 1;
    const fullVersionLabel = versionLabel.startsWith(`V${nextVersionNumber}`)
      ? versionLabel
      : `V${nextVersionNumber} ${versionLabel}`;

    const handle = await engine.submitImage({
      promptText,
      ratio: params.highResFinal ? "1792:2400" : env.runwayImageRatio,
      thinkingLevel: "medium",
      outputCount: 1,
      referenceImages,
      targetState: params.nextState,
      versionLabel: fullVersionLabel,
    });

    const job = createJob({
      id: newId("job"),
      sessionId: session.id,
      kind: "consultation_design",
      provider: "runway",
      handle,
      externalId: handle.id,
      productId: null,
      productName: params.nextState.name,
      action: null,
      baseImageUrl: currentVersion.imageUrl,
      pendingItems: session.currentLook,
      startedAt: Date.now(),
      status: "pending",
      step: INITIAL_DESIGN_STEP,
      polls: 0,
      suggestionId: params.suggestionId,
      targetDesignState: structuredClone(params.nextState),
      previousDesignState: structuredClone(params.previousState),
      changes: structuredClone(params.changes),
      versionLabel,
      versionSummary,
      promptUsed: promptText,
      highResFinal: params.highResFinal,
    });

    const mutated = await mutateSession(session.id, (current) =>
      setConsultationStatus(current, "GENERATING_DESIGN"),
    );
    const updatedSession =
      mutated ?? setConsultationStatus(session, "GENERATING_DESIGN");

    const view = jobView(job);
    publishConsultationEvent(session.id, {
      type: "design.generation.started",
      job: view,
      suggestionId: params.suggestionId,
      session: updatedSession,
    });

    return {
      job: view,
      blocked: null,
      session: updatedSession,
    };
  } catch (error) {
    console.error("[dressly] consultation design generation could not start:", error);
    const retryable = error instanceof ProviderError ? error.retryable : true;
    const mutated = await mutateSession(session.id, (current) =>
      appendConsultationActivity(
        setConsultationStatus(current, "LIVE"),
        "error",
        "Runway Nano Banana 2.1 generation could not start",
      ),
    );
    const fallbackSession =
      mutated ??
      appendConsultationActivity(
        setConsultationStatus(session, "LIVE"),
        "error",
        "Runway Nano Banana 2.1 generation could not start",
      );

    return {
      job: null,
      blocked: {
        code: "RUNWAY_DESIGN_FAILED",
        message: DESIGN_FAILED_MESSAGE,
        retryable,
      },
      session: fallbackSession,
    };
  }
}

export interface PollConsultationDesignResult {
  job: JobView;
  session?: StylingSession;
  version?: DesignVersion;
  followUpJob?: JobView | null;
}

function pendingDesignStep(polls: number): string {
  const index = Math.min(Math.max(0, polls - 1), PENDING_STEPS.length - 1);
  return PENDING_STEPS[index] ?? PENDING_STEPS[0]!;
}

export async function pollConsultationDesign(
  jobId: string,
  onAutoTryOn?: (session: StylingSession, version: DesignVersion) => Promise<JobView | null>,
): Promise<PollConsultationDesignResult | null> {
  const job = getJob(jobId);
  if (!job || job.kind !== "consultation_design") return null;

  if (job.status === "success") {
    const session = await getSession(job.sessionId);
    const version = session?.consultation?.versions.find((v) => v.id === job.versionId);
    return {
      job: jobView(job),
      session: session ?? undefined,
      version,
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
    const engine = runwayImageEngine({ allowFallbackWhenDisabled: true });
    const state = await engine.pollImage({
      id: externalId,
      provider: "runway",
    });

    if (state.status === "pending") {
      const step = pendingDesignStep(polled.polls);
      const updated = updateJob(job.id, { step }) ?? polled;
      return { job: jobView(updated) };
    }

    if (state.status === "failed") {
      console.error(`[dressly] consultation design ${job.id} failed:`, state.message);
      const failedMessage = state.message || DESIGN_FAILED_MESSAGE;
      const failed = failJob(job.id, failedMessage, state.retryable) ?? polled;
      const view = jobView(failed);

      const updatedSession = await mutateSession(job.sessionId, (current) =>
        appendConsultationActivity(
          setConsultationStatus(current, "LIVE"),
          "error",
          `Design generation failed: ${failedMessage}`,
        ),
      );

      if (updatedSession) {
        publishConsultationEvent(job.sessionId, {
          type: "design.generation.failed",
          job: view,
          message: failedMessage,
          session: updatedSession,
        });
      }

      return {
        job: view,
        session: updatedSession ?? undefined,
      };
    }

    const ext = extFromContentType(state.contentType, "png");
    const versionId = newId("ver");
    const fileName = `design_${versionId}.${ext}`;
    await writeDataFile(RESULT_DIR, fileName, state.image);

    let createdVersion: DesignVersion | undefined;
    const updatedSession = await mutateSession(job.sessionId, (current) => {
      const recorded = recordDesignVersion(current, {
        id: versionId,
        imageUrl: mediaUrl("results", fileName),
        label: polled.versionLabel,
        summary: polled.versionSummary,
        designState: polled.targetDesignState,
        sourceSuggestionId: polled.suggestionId,
        promptUsed: polled.promptUsed,
      });
      createdVersion = recorded.version;
      return recorded.session;
    });

    const completedJob =
      updateJob(job.id, {
        status: "success",
        versionId,
        step: createdVersion ? `${createdVersion.label} ready` : "Design revision ready",
      }) ?? polled;
    const view = jobView(completedJob);

    if (updatedSession && createdVersion) {
      publishConsultationEvent(job.sessionId, {
        type: "design.generation.completed",
        version: createdVersion,
        job: view,
        session: updatedSession,
      });
    }

    let followUpJob: JobView | null = null;
    if (
      onAutoTryOn &&
      updatedSession &&
      createdVersion &&
      updatedSession.consultation?.autoTryOn &&
      updatedSession.userPhotoPath
    ) {
      followUpJob = await onAutoTryOn(updatedSession, createdVersion);
    }

    return {
      job: view,
      session: updatedSession ?? undefined,
      version: createdVersion,
      followUpJob,
    };
  } catch (error) {
    console.error(`[dressly] consultation design ${job.id} poll failed:`, error);
    const failed = failJob(job.id, DESIGN_FAILED_MESSAGE, true) ?? polled;
    const view = jobView(failed);

    const updatedSession = await mutateSession(job.sessionId, (current) =>
      appendConsultationActivity(
        setConsultationStatus(current, "LIVE"),
        "error",
        "Design generation failed while polling Runway",
      ),
    );

    if (updatedSession) {
      publishConsultationEvent(job.sessionId, {
        type: "design.generation.failed",
        job: view,
        message: DESIGN_FAILED_MESSAGE,
        session: updatedSession,
      });
    }

    return {
      job: view,
      session: updatedSession ?? undefined,
    };
  }
}

export const startConsultationDesignJob = startConsultationDesign;
export const pollConsultationDesignJob = pollConsultationDesign;
