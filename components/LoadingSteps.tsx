"use client";

import { Check } from "@/components/icons";

/**
 * Named loading steps.
 *
 * The wait for a virtual try-on is real, so it is shown as a sequence of legible
 * stages rather than a bare spinner. The active stage is the only one that moves.
 */
export function LoadingSteps({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li key={step} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                done
                  ? "border-accent bg-accent text-white"
                  : current
                    ? "border-accent text-accent"
                    : "border-line-strong text-muted"
              }`}
            >
              {done ? (
                <Check width={13} height={13} />
              ) : current ? (
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-line-strong" />
              )}
            </span>
            <span className={done ? "text-muted line-through" : current ? "text-ink" : "text-muted"}>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
