"use client";

import { Layers, Refresh, Sparkle } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import type { DesignVersion } from "@/lib/types";

export interface DesignVersionStripProps {
  versions: DesignVersion[];
  currentVersionId: string;
  selectedVersionId: string;
  compareWithV1: boolean;
  busy?: boolean;
  onSelectVersion: (versionId: string) => void;
  onToggleCompare: () => void;
  onRestoreVersion: (versionId: string) => void;
  onTryOnVersion: (versionId: string) => void;
}

function formatVersionTitle(version: DesignVersion): string {
  const prefix = `V${version.version}`;
  if (version.label.toUpperCase().startsWith(prefix)) {
    return version.label;
  }
  return `${prefix} ${version.label}`;
}

export function DesignVersionStrip({
  versions,
  currentVersionId,
  selectedVersionId,
  compareWithV1,
  busy = false,
  onSelectVersion,
  onToggleCompare,
  onRestoreVersion,
  onTryOnVersion,
}: DesignVersionStripProps) {
  if (versions.length === 0) return null;

  const selectedVersion =
    versions.find((v) => v.id === selectedVersionId) ??
    versions.find((v) => v.id === currentVersionId) ??
    versions[versions.length - 1]!;

  const canCompare = versions.length >= 2 && selectedVersion.version > 1;
  const isHistoricalSelection = selectedVersion.id !== currentVersionId;

  return (
    <DresslyGlass className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <p className="overline text-muted">Design versions</p>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {formatVersionTitle(selectedVersion)} · {selectedVersion.summary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canCompare}
            onClick={onToggleCompare}
            className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] transition disabled:opacity-40 ${
              compareWithV1 && canCompare
                ? "border-accent bg-accent/15 text-accent-soft"
                : "border-chrome/18 bg-white/[0.03] text-ink-soft hover:border-accent/60 hover:text-accent-soft"
            }`}
          >
            <Layers width={12} height={12} /> Compare
          </button>

          {isHistoricalSelection ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRestoreVersion(selectedVersion.id)}
              className="inline-flex items-center gap-1.5 rounded-[3px] border border-chrome/20 bg-white/[0.04] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-ink transition hover:border-accent/60 hover:text-accent-soft disabled:opacity-40"
            >
              <Refresh width={12} height={12} /> Restore
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => onTryOnVersion(selectedVersion.id)}
            className="sheen inline-flex items-center gap-1.5 rounded-[3px] border border-accent/60 bg-accent/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-soft transition hover:bg-accent hover:text-night disabled:opacity-40"
          >
            <Sparkle width={12} height={12} /> Try this version
          </button>
        </div>
      </div>

      <div className="thin-scroll flex gap-3 overflow-x-auto pb-1">
        {versions.map((ver) => {
          const isSelected = ver.id === selectedVersion.id;
          const isCanonical = ver.id === currentVersionId;
          const title = formatVersionTitle(ver);

          return (
            <button
              key={ver.id}
              type="button"
              disabled={busy}
              onClick={() => onSelectVersion(ver.id)}
              className={`group relative flex w-[112px] shrink-0 flex-col rounded-[3px] border p-1.5 text-left transition ${
                isSelected
                  ? "border-accent bg-accent/[0.08]"
                  : "border-chrome/12 bg-night/60 hover:border-chrome/30"
              }`}
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[2px] bg-night">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ver.imageUrl}
                  alt={title}
                  className="h-full w-full object-cover opacity-95 transition group-hover:scale-[1.02]"
                />
                {isCanonical ? (
                  <span className="absolute left-1.5 top-1.5 rounded-[2px] bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-accent-soft backdrop-blur">
                    Active
                  </span>
                ) : null}
              </div>

              <p className="mt-1.5 truncate text-[11px] font-medium text-ink">{title}</p>
              <p className="truncate text-[10px] text-muted">
                {ver.designState.primaryColor} · {ver.designState.hardwareColor}
              </p>
            </button>
          );
        })}
      </div>
    </DresslyGlass>
  );
}
