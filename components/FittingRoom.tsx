"use client";

import { BeforeAfter } from "@/components/BeforeAfter";
import { DresslyGlow } from "@/components/shaders/DresslyGlow";
import { DresslyLoadingShader } from "@/components/shaders/DresslyLoadingShader";
import { LookStage } from "@/components/shaders/LookStage";
import { LoadingSteps } from "@/components/LoadingSteps";
import { Refresh, Sparkle } from "@/components/icons";
import type { BlockedView, JobView } from "@/lib/api-types";
import { CATEGORY_LABELS } from "@/lib/catalog/products";
import { lookItems } from "@/lib/catalog/query";
import type { DesignVersion, Look, StylingSession } from "@/lib/types";

const TRYON_STEPS = [
  "Preparing the fitting room",
  "Generating your virtual fit",
  "Layering the look",
  "Almost there — refining the details",
];

const DESIGN_STEPS = [
  "Locking canonical reference attributes",
  "Synthesizing studio revision with Runway",
  "Preserving silhouette and lighting",
  "Finalizing bespoke edition",
];

interface FittingRoomProps {
  session: StylingSession;
  job: JobView | null;
  mock: boolean;
  blocked: BlockedView | null;
  workspaceMode?: "stylist" | "consultation";
  selectedVersionId?: string | null;
  compareWithV1?: boolean;
  onChangeViewMode?: (mode: "design" | "tryon") => void;
  onTryOnVersion?: (versionId: string) => void;
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
  workspaceMode = "stylist",
  selectedVersionId = null,
  compareWithV1 = false,
  onChangeViewMode,
  onTryOnVersion,
  onRetry,
  onClearRejections,
}: FittingRoomProps) {
  const consultation = workspaceMode === "consultation" ? session.consultation : null;

  const activeLook: Look | undefined = session.looks.find(
    (look) => look.id === session.activeLookId,
  );
  const loading = job?.status === "pending" ? job : null;
  const failed = job?.status === "failed" ? job : null;
  const worn = lookItems(session.currentLook);

  const activeSteps = job?.kind === "consultation_design" ? DESIGN_STEPS : TRYON_STEPS;
  const stepIndex = Math.max(0, activeSteps.indexOf(job?.step ?? ""));
  const stepProgress = activeSteps.length > 1 ? stepIndex / (activeSteps.length - 1) : 0;

  if (consultation) {
    const versions = consultation.versions;
    const v1Version: DesignVersion | undefined = versions[0];
    const selectedVersion: DesignVersion | undefined =
      versions.find((v) => v.id === selectedVersionId) ??
      versions.find((v) => v.id === consultation.currentDesignVersionId) ??
      versions[versions.length - 1];

    const inspectedState = selectedVersion?.designState ?? consultation.designState;
    const verNum = selectedVersion?.version ?? 1;
    const viewMode = consultation.activeViewMode;

    const designStageLook: Look | undefined = selectedVersion
      ? {
          id: selectedVersion.id,
          index: selectedVersion.version,
          imagePath: selectedVersion.imageUrl,
          previousImagePath: "",
          items: session.currentLook,
          addedProductId: null,
          feedback: "pending",
          label: `V${selectedVersion.version} ${selectedVersion.label}`,
          createdAt: selectedVersion.createdAt,
        }
      : undefined;

    const versionTryOnLook: Look | undefined =
      (selectedVersion?.tryOnLookId
        ? session.looks.find((l) => l.id === selectedVersion.tryOnLookId)
        : undefined) ?? activeLook;

    const showCompare =
      viewMode === "design" &&
      compareWithV1 &&
      Boolean(v1Version && selectedVersion && selectedVersion.id !== v1Version.id);

    const attributeBadges = [
      { label: "Size", value: inspectedState.size },
      { label: "Color", value: inspectedState.primaryColor },
      { label: "Hardware", value: inspectedState.hardwareColor },
      { label: "Strap", value: inspectedState.strapType },
      { label: "Material", value: inspectedState.material },
      { label: "Silhouette", value: inspectedState.silhouette },
    ];

    return (
      <section className="flex min-h-0 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="overline text-muted">Atelier Design Stage</p>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {inspectedState.name} ·{" "}
              <span className="text-accent-soft">
                V{verNum} {selectedVersion?.label ?? "Original"}
              </span>
              {mock ? <span className="text-accent"> · Simulated</span> : null}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Consultation stage view"
            className="inline-flex items-center rounded-[3px] border border-chrome/15 bg-night/70 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "design"}
              onClick={() => onChangeViewMode?.("design")}
              className={`rounded-[2px] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition ${
                viewMode === "design"
                  ? "bg-accent/20 text-accent-soft"
                  : "text-muted hover:text-ink-soft"
              }`}
            >
              Current Design (V{verNum})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "tryon"}
              onClick={() => onChangeViewMode?.("tryon")}
              className={`rounded-[2px] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition ${
                viewMode === "tryon"
                  ? "bg-accent/20 text-accent-soft"
                  : "text-muted hover:text-ink-soft"
              }`}
            >
              Virtual Try-On
            </button>
          </div>
        </div>

        <DresslyGlow active={!loading} className="block">
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[4px] border border-chrome/15 bg-night shadow-[0_50px_120px_-60px_rgba(0,0,0,0.9)]">
            {viewMode === "design" ? (
              showCompare && v1Version && selectedVersion ? (
                <BeforeAfter
                  original={v1Version.imageUrl}
                  current={selectedVersion.imageUrl}
                  alt={`V${selectedVersion.version} ${selectedVersion.label}`}
                />
              ) : (
                <LookStage
                  look={designStageLook}
                  photoPath={selectedVersion?.imageUrl ?? null}
                  alt={`V${verNum} ${selectedVersion?.label ?? "Design"}`}
                />
              )
            ) : (
              <LookStage
                look={versionTryOnLook}
                photoPath={session.userPhotoPath}
                alt="Virtual Try-On"
              />
            )}

            {viewMode === "design" && !showCompare && selectedVersion ? (
              <span className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/55 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-soft backdrop-blur">
                V{selectedVersion.version} · {selectedVersion.label}
              </span>
            ) : null}

            {loading ? (
              <div className="absolute inset-0 overflow-hidden bg-night">
                <DresslyLoadingShader progress={stepProgress} />
                <div className="relative flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/50 text-accent-soft">
                    <Sparkle width={24} height={24} />
                  </span>
                  <LoadingSteps steps={activeSteps} active={stepIndex} />
                  <p className="text-[12px] text-white/50">
                    {job?.kind === "consultation_design"
                      ? "Runway is rendering the approved product revision."
                      : "YouCam is visualizing this design on your photo."}
                  </p>
                </div>
              </div>
            ) : null}

            {failed ? (
              <div className="absolute inset-x-4 bottom-4 rounded-[3px] border border-accent/40 bg-night-soft/95 p-4 text-white backdrop-blur">
                <p className="overline text-accent-soft">Generation failed</p>
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
                <p className="overline text-accent-soft">Notice</p>
                <p className="mt-1 text-[13px] text-white/85">{blocked.message}</p>
              </div>
            ) : null}
          </div>
        </DresslyGlow>

        <div className="mt-5">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="overline text-muted">Canonical Design Attributes (V{verNum})</p>
            {selectedVersion && onTryOnVersion ? (
              <button
                type="button"
                disabled={Boolean(loading)}
                onClick={() => onTryOnVersion(selectedVersion.id)}
                className="sheen inline-flex items-center gap-1.5 rounded-[3px] border border-accent/60 bg-accent px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-night transition hover:bg-accent-soft disabled:opacity-50"
              >
                <Sparkle width={13} height={13} /> Try this version
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {attributeBadges.map((attr) => (
              <span
                key={attr.label}
                className="animate-fade inline-flex items-center gap-2 rounded-full border border-chrome/12 bg-white/[0.03] px-3 py-1.5 text-[12px] text-ink-soft backdrop-blur"
              >
                <span className="overline text-muted">{attr.label}</span>
                <span className="text-ink">{attr.value}</span>
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="overline text-muted">Fitting room</p>
        <span className="text-[11px] text-muted">
          {activeLook ? activeLook.label : "Original photo"}
          {mock ? <span className="text-accent"> · Simulated</span> : null}
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
                  Dressly is fitting the garment to your photo.
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
