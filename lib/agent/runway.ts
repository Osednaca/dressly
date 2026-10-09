import type { BlockedView } from "@/lib/api-types";
import { createJob, failJob, getJob, jobView, recordPoll, updateJob, type AgentJob } from "@/lib/agent/jobs";
import { mutateSession } from "@/lib/session/store";
import { setLookVideo } from "@/lib/session/reducer";
import { VIDEO_DIR, writeDataFile } from "@/lib/storage/files";
import { mediaUrl, readMediaBytes } from "@/lib/storage/media";
import type { StylingSession } from "@/lib/types";
import { newId } from "@/lib/util/id";
import { ProviderError } from "@/lib/util/http";
import { runwayAvailable, runwayEngineOrThrow } from "@/services/runway";

/**
 * P2: "Bring this look to life".
 *
 * Strictly additive and strictly optional. It animates an existing look and can never
 * change the outfit; a failure here is surfaced and dismissed, never fatal.
 */

const PROMPT = [
  "Natural, confident fashion-model presence with subtle believable motion:",
  "a slow shift of weight, gentle breathing, a slight turn of the head,",
  "realistic fabric movement in the light.",
  "Preserve the person, their face and the outfit exactly as shown —",
  "never alter the clothing, colours, proportions or background.",
  "Cinematic editorial fashion look.",
].join(" ");

export interface StartRunwayResult {
  job: AgentJob | null;
  blocked: BlockedView | null;
}

/** Shopper-facing copy; provider detail is logged, never shown. */
const ANIMATION_FAILED_MESSAGE = "We couldn't animate this look. Please try again.";

export async function startRunway(
  session: StylingSession,
  lookId: string,
): Promise<StartRunwayResult> {
  if (!runwayAvailable()) {
    return {
      job: null,
      blocked: {
        code: "RUNWAY_DISABLED",
        message: "Animation isn't available right now.",
        retryable: false,
      },
    };
  }
  const look = session.looks.find((entry) => entry.id === lookId);
  if (!look) {
    return {
      job: null,
      blocked: { code: "NO_LOOK", message: "There is no look to animate yet.", retryable: false },
    };
  }

  const media = await readMediaBytes(look.imagePath);
  if (!media) {
    return {
      job: null,
      blocked: { code: "NO_LOOK", message: "The look image could not be read.", retryable: false },
    };
  }

  try {
    const engine = runwayEngineOrThrow();
    const handle = await engine.submit({
      image: media.bytes,
      imageContentType: media.contentType,
      promptText: PROMPT,
    });
    const job = createJob({
      id: newId("job"),
      sessionId: session.id,
      kind: "runway",
      provider: "runway",
      handle,
      // Without this the finished video can never be attached back to its look.
      lookId: look.id,
      productId: look.addedProductId,
      productName: "Bring this look to life",
      action: null,
      baseImageUrl: look.imagePath,
      pendingItems: look.items,
      startedAt: Date.now(),
      status: "pending",
      polls: 0,
    });
    return { job, blocked: null };
  } catch (error) {
    console.error("[dressly] animation could not start:", error);
    return {
      job: null,
      blocked: {
        code: "RUNWAY_FAILED",
        message: ANIMATION_FAILED_MESSAGE,
        retryable: error instanceof ProviderError ? error.retryable : true,
      },
    };
  }
}

export interface PollRunwayResult {
  job: ReturnType<typeof jobView>;
  session?: StylingSession;
}

export async function pollRunway(jobId: string): Promise<PollRunwayResult | null> {
  const job = getJob(jobId);
  if (!job || job.kind !== "runway") return null;
  if (job.status === "success") return { job: jobView(job) };
  if (job.status === "failed") return { job: jobView(job) };

  recordPoll(job.id);
  try {
    const state = await runwayEngineOrThrow().poll(job.handle as { id: string; provider: "runway" });
    if (state.status === "pending") return { job: jobView(getJob(job.id) ?? job) };
    if (state.status === "failed") {
      console.error(`[dressly] animation ${job.id} failed:`, state.message);
      failJob(job.id, ANIMATION_FAILED_MESSAGE, state.retryable);
      return { job: jobView(getJob(job.id) ?? job) };
    }

    const fileName = `${job.lookId ?? job.id}.mp4`;
    await writeDataFile(VIDEO_DIR, fileName, state.video);
    const session = await mutateSession(job.sessionId, (current) => {
      // Fall back to the active look if an older job predates the `lookId` field.
      const targetLookId = job.lookId ?? current.activeLookId ?? current.looks.at(-1)?.id;
      return targetLookId ? setLookVideo(current, targetLookId, mediaUrl("videos", fileName)) : current;
    });
    updateJob(job.id, { status: "success" });
    return { job: jobView(getJob(job.id) ?? job), session: session ?? undefined };
  } catch (error) {
    console.error(`[dressly] animation ${job.id} poll failed:`, error);
    failJob(job.id, ANIMATION_FAILED_MESSAGE, true);
    return { job: jobView(getJob(job.id) ?? job) };
  }
}
