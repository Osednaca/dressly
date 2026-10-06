"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import type { DecisionRecord, ScoredAlternative } from "@/lib/types";

function Bars({ items, max = 4 }: { items: ScoredAlternative[]; max?: number }) {
  if (items.length === 0) return <p className="text-[12px] text-muted">—</p>;
  return (
    <ul className="space-y-1.5">
      {items.slice(0, max).map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-champagne to-accent-soft"
              style={{ width: `${Math.max(2, Math.round(item.probability * 100))}%` }}
            />
          </span>
          <span className="flex items-baseline gap-2 whitespace-nowrap text-[12px]">
            <span className="text-ink-soft">{item.label}</span>
            <span className="tabular-nums text-muted">{item.probability.toFixed(2)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-chrome/10 py-3 first:border-t-0 first:pt-0">
      <p className="overline mb-2 text-muted">{label}</p>
      {children}
    </div>
  );
}

/**
 * Agent Decisions panel.
 *
 * Structured material only: the alternatives the agent considered and the scores it
 * assigned. Never raw chain-of-thought, and always labelled with the engine that
 * actually produced the decision so a fallback is visible rather than hidden.
 */
export function DecisionsPanel({ decisions }: { decisions: DecisionRecord[] }) {
  const [open, setOpen] = useState(true);
  const latest = decisions.at(-1);

  return (
    <section className="glass rounded-[4px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-5 py-3"
        aria-expanded={open}
      >
        <span className="overline text-muted">Agent decisions</span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {latest ? (
            <span
              className={`rounded-full border px-2 py-0.5 ${
                latest.provider === "jev"
                  ? "border-sage/50 text-sage"
                  : "border-line-strong text-muted"
              }`}
            >
              {latest.provider === "jev" ? `JEV · ${latest.model ?? ""}` : "deterministic fallback"}
            </span>
          ) : null}
          <ChevronDown
            width={16}
            height={16}
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </span>
      </button>

      {open ? (
        <div className="border-t border-chrome/10 px-5 py-4">
          {!latest ? (
            <p className="text-[13px] text-muted">
              No decisions yet. Send the first message to see the agent evaluate alternatives.
            </p>
          ) : (
            <div className="animate-fade">
              <Field label="User intent">
                <div className="flex flex-wrap gap-1.5">
                  {latest.intent?.interpreted.length ? (
                    latest.intent.interpreted.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-soft"
                      >
                        {chip}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-muted">—</span>
                  )}
                </div>
              </Field>

              <Field label="Style evaluation">
                <Bars items={latest.styleDistribution} />
              </Field>

              <Field label="Current action">
                <p className="text-[14px]">
                  <span className="font-semibold">{latest.action?.decision.replace(/_/g, " ")}</span>
                  {latest.action ? (
                    <span className="ml-2 text-muted">
                      confidence {latest.action.confidence.toFixed(2)}
                    </span>
                  ) : null}
                </p>
                <div className="mt-2">
                  <Bars items={latest.action?.distribution ?? []} max={4} />
                </div>
              </Field>

              <Field label="Product evaluation">
                <Bars items={latest.productEvaluation} max={5} />
              </Field>

              <Field label="Selected">
                <p className="text-[14px]">{latest.selectedProductName ?? "No garment selected"}</p>
              </Field>

              <Field label="Why">
                <p className="text-[13px] italic text-ink-soft">&ldquo;{latest.reason}&rdquo;</p>
              </Field>
            </div>
          )}

          {decisions.length > 1 ? (
            <details className="mt-4 border-t border-chrome/10 pt-3">
              <summary className="overline cursor-pointer text-muted">
                Earlier iterations ({decisions.length - 1})
              </summary>
              <ul className="mt-3 space-y-2">
                {decisions
                  .slice(0, -1)
                  .reverse()
                  .map((record) => (
                    <li key={record.id} className="flex items-baseline justify-between text-[12px]">
                      <span className="text-muted">#{record.iteration}</span>
                      <span className="text-ink-soft">
                        {record.action?.decision.replace(/_/g, " ")}
                        {record.selectedProductName ? ` · ${record.selectedProductName}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
