"use client";

import { DresslyGlow } from "@/components/shaders/DresslyGlow";
import { DresslyLoadingShader } from "@/components/shaders/DresslyLoadingShader";
import { LookStage } from "@/components/shaders/LookStage";
import { LoadingSteps } from "@/components/LoadingSteps";
import { Refresh, Sparkle } from "@/components/icons";
import type { BlockedView, JobView } from "@/lib/api-types";
import { CATEGORY_LABELS } from "@/lib/catalog/products";
import { lookItems } from "@/lib/catalog/query";
import type { Look, StylingSession } from "@/lib/types";

const TRYON_STEPS = [
  "Preparing the fitting room",
  "Generating your virtual fit",
  "Layering the look",
  "Almost there — refining the details",
];

interface FittingRoomProps {
  session: StylingSession;
  job: JobView | null;
  mock: boolean;
  blocked: BlockedView | null;
  onRetry: (jobId: string) => void;
  onClearRejections: () => void;
}

/**
 * The stage: a fashion-editorial frame around the shopper's photo and the generated look.
 * The image itself is never filtered; the shader only appears as a glow around the frame,
 * a transition between looks, or the styling state.
 */
export function FittingRoom({
  session,
  job,
  mock,
  blocked,
  onRetry,
  onClearRejections,
}: FittingRoomProps) {
  const activeLook: Look | undefined = session.looks.find(
    (look) => look.id === session.activeLookId,
  );
  const loading = job?.status === "pending" ? job : null;
  const failed = job?.status === "failed" ? job : null;
  const worn = lookItems(session.currentLook);

  const stepIndex = Math.max(0, TRYON_STEPS.indexOf(job?.step ?? ""));
  const stepProgress = TRYON_STEPS.length > 1 ? stepIndex / (TRYON_STEPS.length - 1) : 0;

  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="overline text-muted">Fitting room</p>
        <span className="text-[11px] text-muted">
          {activeLook ? activeLook.label : "Original photo"}
          {" · "}
          <span className={mock ? "text-accent" : "text-sage"}>
            {mock ? "Simulated" : "YouCam"}
          </span>
        </span>
      </div>

      <DresslyGlow active={Boolean(activeLook) && !loading} className="block">
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[4px] border border-chrome/15 bg-night shadow-[0_50px_120px_-60px_rgba(0,0,0,0.9)]">
          <LookStage look={activeLook} photoPath={session.userPhotoPath} alt="Your look" />

          {!activeLook && session.userPhotoPath ? (
            <span className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/45 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur">
              Original
            </span>
          ) : null}

          {loading ? (
            <div className="absolute inset-0 overflow-hidden bg-night">
              <DresslyLoadingShader progress={stepProgress} />
              <div className="relative flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/50 text-accent-soft">
                  <Sparkle width={24} height={24} />
                </span>
                <LoadingSteps steps={TRYON_STEPS} active={stepIndex} />
                <p className="text-[12px] text-white/50">
                  Dressly is applying {job?.provider === "mock" ? "a simulated" : "a real"} garment
                  to your photo.
                </p>
              </div>
            </div>
          ) : null}

          {failed ? (
            <div className="absolute inset-x-4 bottom-4 rounded-[3px] border border-accent/40 bg-night-soft/95 p-4 text-white backdrop-blur">
              <p className="overline text-accent-soft">Try-on failed</p>
              <p className="mt-1 text-[13px] text-white/85">{failed.message}</p>
              {failed.retryable ? (
                <button
                  type="button"
                  onClick={() => onRetry(failed.id)}
                  className="mt-3 inline-flex items-center gap-2 rounded-[2px] border border-white/25 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white transition hover:border-accent hover:text-accent-soft"
                >
                  <Refresh width={14} height={14} /> Try again
                </button>
              ) : null}
            </div>
          ) : null}

          {blocked ? (
            <div className="absolute inset-x-4 bottom-4 rounded-[3px] border border-accent/40 bg-night-soft/95 p-4 text-white backdrop-blur">
              <p className="overline text-accent-soft">Cannot continue</p>
              <p className="mt-1 text-[13px] text-white/85">{blocked.message}</p>
              {blocked.code === "NO_CANDIDATES" ? (
                <button
                  type="button"
                  onClick={onClearRejections}
                  className="mt-3 inline-flex items-center gap-2 rounded-[2px] border border-white/25 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white transition hover:border-accent hover:text-accent-soft"
                >
                  <Refresh width={14} height={14} /> Reset rejected pieces
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </DresslyGlow>

      <div className="mt-5">
        <p className="overline mb-2 text-muted">Your look</p>
        <div className="flex flex-wrap gap-2">
          {worn.length === 0 ? (
            <p className="text-[12px] text-muted">Nothing on the body yet.</p>
          ) : (
            worn.map((item) => (
              <span
                key={item.id}
                className="animate-fade inline-flex items-center gap-2 rounded-full border border-chrome/12 bg-white/[0.03] px-3 py-1.5 text-[12px] text-ink-soft backdrop-blur"
              >
                <span className="overline text-muted">{CATEGORY_LABELS[item.category]}</span>
                {item.name}
                <span className="text-muted">${item.price}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
