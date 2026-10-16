"use client";

import { useState } from "react";
import { Check, Sparkle, X } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import { DresslyGlow } from "@/components/shaders/DresslyGlow";
import type { DesignFieldDiff, ProposedDesignChange } from "@/lib/types";

export interface SuggestionCardProps {
  suggestion: ProposedDesignChange;
  busy?: boolean;
  onIgnore: (suggestionId: string) => void;
  onApply: (suggestionId: string) => void;
  onEdit: (suggestionId: string, editedChanges: DesignFieldDiff[]) => void;
}

export function SuggestionCard({
  suggestion,
  busy = false,
  onIgnore,
  onApply,
  onEdit,
}: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const diff of suggestion.changes) {
      initial[diff.field] = diff.proposedValue;
    }
    return initial;
  });

  const confidencePct = Math.round(suggestion.confidence * 100);

  const handleToggleEdit = () => {
    if (!editing) {
      const next: Record<string, string> = {};
      for (const diff of suggestion.changes) {
        next[diff.field] = diff.proposedValue;
      }
      setDraftValues(next);
    }
    setEditing((v) => !v);
  };

  const handleApplyEdited = () => {
    const editedChanges: DesignFieldDiff[] = suggestion.changes.map((diff) => {
      const custom = (draftValues[diff.field] ?? diff.proposedValue).trim();
      return {
        ...diff,
        proposedValue: custom.length > 0 ? custom : diff.proposedValue,
      };
    });
    setEditing(false);
    onEdit(suggestion.id, editedChanges);
  };

  return (
    <DresslyGlow active className="block animate-rise">
      <DresslyGlass tone="strong" shaderSheen className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-chrome/12 pb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
            <p className="overline text-accent-soft">Dressly detected a suggestion</p>
          </div>
          <span className="rounded-full border border-accent/35 bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-soft">
            Confidence {confidencePct}%
          </span>
        </div>

        <blockquote className="mt-3 border-l border-accent/40 pl-3 text-[13px] italic text-ink-soft">
          &ldquo;{suggestion.transcriptExcerpt}&rdquo;
        </blockquote>

        <div className="mt-3.5 space-y-2">
          {suggestion.changes.map((diff) => {
            const draftValue = draftValues[diff.field] ?? diff.proposedValue;
            return (
              <div
                key={diff.field}
                className="rounded-[3px] border border-chrome/12 bg-night/70 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="overline text-muted">{diff.label}</span>
                  {!editing ? (
                    <span className="text-[13px] text-ink">
                      <span className="text-muted">{diff.previousValue ?? "Current"}</span>
                      <span className="mx-1.5 text-accent">→</span>
                      <span className="font-medium text-accent-soft">{diff.proposedValue}</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted">
                      From: {diff.previousValue ?? "Current"}
                    </span>
                  )}
                </div>

                {editing ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-accent">→</span>
                    <input
                      type="text"
                      value={draftValue}
                      disabled={busy}
                      onChange={(e) =>
                        setDraftValues((prev) => ({
                          ...prev,
                          [diff.field]: e.target.value,
                        }))
                      }
                      aria-label={`Edit ${diff.label}`}
                      className="w-full rounded-[2px] border border-accent/40 bg-background px-2.5 py-1.5 text-[12px] text-ink focus:border-accent focus:outline-none"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!editing ? (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onIgnore(suggestion.id)}
              className="inline-flex items-center gap-1.5 rounded-[3px] border border-chrome/15 bg-white/[0.02] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-muted transition hover:border-chrome/35 hover:text-ink disabled:opacity-50"
            >
              <X width={13} height={13} /> Ignore
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleToggleEdit}
              className="inline-flex items-center gap-1.5 rounded-[3px] border border-chrome/20 bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-accent/60 hover:text-accent-soft disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onApply(suggestion.id)}
              className="sheen inline-flex items-center gap-1.5 rounded-[3px] border border-accent/60 bg-accent px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-night transition hover:bg-accent-soft disabled:opacity-50"
            >
              <Sparkle width={13} height={13} /> Apply
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={handleToggleEdit}
              className="rounded-[3px] border border-chrome/15 bg-white/[0.02] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-muted transition hover:border-chrome/35 hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleApplyEdited}
              className="sheen inline-flex items-center gap-1.5 rounded-[3px] border border-accent/60 bg-accent px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-night transition hover:bg-accent-soft disabled:opacity-50"
            >
              <Check width={13} height={13} /> Apply Edited
            </button>
          </div>
        )}
      </DresslyGlass>
    </DresslyGlow>
  );
}
