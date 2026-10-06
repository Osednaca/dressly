"use client";

import { BeforeAfter } from "@/components/BeforeAfter";
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

/** The stage: the shopper's photo, the generated look, and the before/after reveal. */
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

  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="overline text-muted">Fitting room</p>
        <span className="text-[11px] text-muted">
          {activeLook ? activeLook.label : "Original photo"}
          {" · "}
          <span className={mock ? "text-accent" : "text-sage"}>
            {mock ? "Simulated" : "YouCam"}
          </span>
        </span>
      </div>

      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[3px] border border-line bg-night">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-night px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/50 text-accent-soft">
              <Sparkle width={24} height={24} />
            </span>
            <LoadingSteps steps={TRYON_STEPS} active={stepIndex} />
            <p className="text-[12px] text-white/50">
              Dressly is applying {job?.provider === "mock" ? "a simulated" : "a real"} garment to
              your photo.
            </p>
          </div>
        ) : activeLook ? (
          <BeforeAfter
            original={activeLook.previousImagePath}
            current={activeLook.imagePath}
            alt={activeLook.label}
          />
        ) : session.userPhotoPath ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.userPhotoPath}
              alt="Your photo"
              className="absolute inset-0 h-full w-full object-contain"
            />
            <span className="absolute left-3 top-3 rounded-sm bg-black/45 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur">
              Original
            </span>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/40">
            <p className="text-sm">Add a photo to begin.</p>
          </div>
        )}

        {failed ? (
          <div className="absolute inset-x-4 bottom-4 rounded-[2px] border border-accent/40 bg-night-soft/95 p-4 text-white backdrop-blur">
            <p className="overline text-accent-soft">Try-on failed</p>
            <p className="mt-1 text-[13px] text-white/85">{failed.message}</p>
            {failed.retryable ? (
              <button
                type="button"
                onClick={() => onRetry(failed.id)}
                className="mt-3 inline-flex items-center gap-2 rounded-[2px] border border-white/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white transition hover:border-accent hover:text-accent-soft"
              >
                <Refresh width={14} height={14} /> Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {blocked ? (
          <div className="absolute inset-x-4 bottom-4 rounded-[2px] border border-accent/40 bg-night-soft/95 p-4 text-white backdrop-blur">
            <p className="overline text-accent-soft">Cannot continue</p>
            <p className="mt-1 text-[13px] text-white/85">{blocked.message}</p>
            {blocked.code === "NO_CANDIDATES" ? (
              <button
                type="button"
                onClick={onClearRejections}
                className="mt-3 inline-flex items-center gap-2 rounded-[2px] border border-white/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white transition hover:border-accent hover:text-accent-soft"
              >
                <Refresh width={14} height={14} /> Reset rejected pieces
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {worn.length === 0 ? (
          <p className="text-[12px] text-muted">Nothing on the body yet.</p>
        ) : (
          worn.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-[12px]"
            >
              <span className="overline text-muted">{CATEGORY_LABELS[item.category]}</span>
              {item.name}
              <span className="text-muted">${item.price}</span>
            </span>
          ))
        )}
      </div>
    </section>
  );
}
