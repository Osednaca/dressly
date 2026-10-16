"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import type { DecisionRecord } from "@/lib/types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-chrome/10 py-3 first:border-t-0 first:pt-0">
      <p className="overline mb-2 text-muted">{label}</p>
      {children}
    </div>
  );
}

function actionLabel(decision: string | undefined): string {
  if (!decision) return "—";
  const words = decision.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Stylist notes.
 *
 * What the stylist understood, what it is doing next and why — in plain language.
 * Scores, distributions and engine provenance stay on the DecisionRecord and out of
 * the shopper-facing UI.
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
        <span className="overline text-muted">Stylist notes</span>
        <ChevronDown
          width={16}
          height={16}
          className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open ? (
        <div className="border-t border-chrome/10 px-5 py-4">
          {!latest ? (
            <p className="text-[13px] text-muted">
              Nothing yet. Tell Dressly where you&rsquo;re going and the stylist will explain each choice.
            </p>
          ) : (
            <div className="animate-fade">
              <Field label="What I understood">
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
                  ) : latest.consultationAction && latest.productEvaluation.length > 0 ? (
                    latest.productEvaluation.map((item) => (
                      <span
                        key={item.label}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-soft"
                      >
                        {item.label}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-muted">—</span>
                  )}
                </div>
              </Field>

              <Field label="Next step">
                <p className="text-[14px] font-semibold">
                  {actionLabel(latest.action?.decision ?? latest.consultationAction?.decision)}
                </p>
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
                Earlier steps ({decisions.length - 1})
              </summary>
              <ul className="mt-3 space-y-2">
                {decisions
                  .slice(0, -1)
                  .reverse()
                  .map((record) => (
                    <li key={record.id} className="flex items-baseline justify-between text-[12px]">
                      <span className="text-muted">#{record.iteration}</span>
                      <span className="text-ink-soft">
                        {actionLabel(
                          record.action?.decision ?? record.consultationAction?.decision,
                        )}
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
