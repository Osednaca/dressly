"use client";

import { Heart, X } from "@/components/icons";
import type { Look } from "@/lib/types";

interface LookHistoryProps {
  looks: Look[];
  activeLookId: string | null;
  busy: boolean;
  onRestore: (lookId: string) => void;
  onFeedback: (lookId: string, feedback: "liked" | "rejected") => void;
}

/**
 * Look history strip.
 *
 * History is navigation, not a gallery: tapping a look restores its outfit so the
 * session can continue from there, and like/reject feed straight back into scoring.
 */
export function LookHistory({
  looks,
  activeLookId,
  busy,
  onRestore,
  onFeedback,
}: LookHistoryProps) {
  if (looks.length === 0) return null;

  return (
    <section className="rounded-[3px] border border-line bg-card p-4">
      <p className="overline mb-3 text-muted">Look history</p>
      <div className="thin-scroll flex gap-3 overflow-x-auto pb-1">
        {looks.map((look) => {
          const active = look.id === activeLookId;
          return (
            <div key={look.id} className="group relative w-[92px] shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => onRestore(look.id)}
                className={`relative block aspect-[3/4] w-full overflow-hidden rounded-[2px] border bg-night transition ${
                  active ? "border-accent" : "border-line hover:border-line-strong"
                }`}
                title={`Restore ${look.label}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={look.imagePath}
                  alt={look.label}
                  className="h-full w-full object-cover opacity-95"
                />
              </button>
              <p className="mt-1.5 text-center text-[10px] uppercase tracking-[0.14em] text-muted">
                {look.label}
              </p>
              <div className="mt-1 flex justify-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onFeedback(look.id, "liked")}
                  aria-label={`Like ${look.label}`}
                  className={`rounded-full border p-1 transition ${
                    look.feedback === "liked"
                      ? "border-sage bg-sage/10 text-sage"
                      : "border-line text-muted hover:text-sage"
                  }`}
                >
                  <Heart width={12} height={12} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onFeedback(look.id, "rejected")}
                  aria-label={`Reject ${look.label}`}
                  className={`rounded-full border p-1 transition ${
                    look.feedback === "rejected"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-muted hover:text-accent"
                  }`}
                >
                  <X width={12} height={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
