import { Wordmark } from "@/components/Logo";
import { Sparkle } from "@/components/icons";
import type { ConsultationStatus } from "@/lib/types";

export interface MastheadProps {
  workspaceMode?: "stylist" | "consultation";
  consultationActive?: boolean;
  consultationStatus?: ConsultationStatus;
  onSelectMode?: (mode: "stylist" | "consultation") => void;
  onStartConsultationClick?: () => void;
}

/** Site header. Deliberately quiet: the fitting room is the star. */
export function Masthead({
  workspaceMode = "stylist",
  consultationActive = false,
  consultationStatus,
  onSelectMode,
  onStartConsultationClick,
}: MastheadProps) {
  const isLive =
    consultationStatus === "LIVE" ||
    consultationStatus === "GENERATING_DESIGN" ||
    consultationStatus === "GENERATING_TRYON" ||
    consultationStatus === "STARTING" ||
    consultationStatus === "WAITING_FOR_ADMISSION";

  const showControls = Boolean(onSelectMode || onStartConsultationClick);

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-chrome/10 bg-background/60 px-6 py-4 backdrop-blur-xl md:px-10">
      <div className="flex items-baseline gap-4">
        <Wordmark />
        <p className="overline hidden text-muted sm:block">Style it. Design it. Try it.</p>
      </div>

      {showControls ? (
        <div className="flex items-center gap-3">
          {consultationActive && onSelectMode ? (
            <div
              role="tablist"
              aria-label="Workspace mode"
              className="inline-flex items-center rounded-[3px] border border-chrome/15 bg-night/70 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={workspaceMode === "stylist"}
                onClick={() => onSelectMode("stylist")}
                className={`rounded-[2px] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition ${
                  workspaceMode === "stylist"
                    ? "bg-white/[0.08] text-ink"
                    : "text-muted hover:text-ink-soft"
                }`}
              >
                AI Stylist
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={workspaceMode === "consultation"}
                onClick={() => onSelectMode("consultation")}
                className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] transition ${
                  workspaceMode === "consultation"
                    ? "bg-accent/20 text-accent-soft"
                    : "text-muted hover:text-ink-soft"
                }`}
              >
                <span className={isLive ? "animate-pulse text-accent" : "text-muted"}>
                  {isLive ? "●" : "○"}
                </span>
                Live Consultation
              </button>
            </div>
          ) : onStartConsultationClick ? (
            <button
              type="button"
              onClick={onStartConsultationClick}
              className="sheen inline-flex items-center gap-2 rounded-[3px] border border-accent/50 bg-accent/12 px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-accent-soft transition hover:bg-accent hover:text-night"
            >
              <Sparkle width={13} height={13} />
              Start Consultation
            </button>
          ) : null}
        </div>
      ) : (
        <p className="overline hidden text-muted sm:block">Your AI personal stylist</p>
      )}
    </header>
  );
}
