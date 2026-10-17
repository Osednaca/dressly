"use client";

import { useState } from "react";
import { ChevronDown, Sparkle } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import type {
  ConsultationDiagnosticAction,
  ConsultationDiagnosticRequest,
  ConsultationDiagnosticResponse,
} from "@/lib/api-types";

const DIAGNOSTIC_BUTTONS: ReadonlyArray<{
  action: ConsultationDiagnosticAction;
  label: string;
}> = [
  { action: "test_bot_join", label: "[ Test Bot Join ]" },
  { action: "test_audio_capture", label: "[ Test Audio Capture ]" },
  { action: "test_gemini_stream", label: "[ Test Gemini Stream ]" },
  { action: "simulate_transcript", label: "[ Simulate Transcript ]" },
  { action: "simulate_suggestion", label: "[ Simulate Suggestion ]" },
  { action: "test_runway_revision", label: "[ Test Runway Revision ]" },
  { action: "test_youcam_vto", label: "[ Test YouCam VTO ]" },
];

export interface ConsultationDiagnosticsProps {
  busy?: boolean;
  onRunDiagnostic: (
    req: ConsultationDiagnosticRequest,
  ) => Promise<ConsultationDiagnosticResponse | null>;
}

export function ConsultationDiagnostics({
  busy = false,
  onRunDiagnostic,
}: ConsultationDiagnosticsProps) {
  const [open, setOpen] = useState(false);
  const [runningAction, setRunningAction] = useState<ConsultationDiagnosticAction | null>(
    null,
  );
  const [lastResult, setLastResult] = useState<ConsultationDiagnosticResponse | null>(
    null,
  );

  const handleAction = async (action: ConsultationDiagnosticAction) => {
    if (busy || runningAction) return;
    setRunningAction(action);
    try {
      const res = await onRunDiagnostic({ action });
      if (res) {
        setLastResult(res);
      }
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <DresslyGlass className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="inline-flex items-center gap-2 overline text-muted">
          <Sparkle width={12} height={12} className="text-accent-soft" />
          Developer &amp; Demo Layer Diagnostics
        </span>
        <ChevronDown
          width={14}
          height={14}
          className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open ? (
        <div className="mt-3.5 space-y-3 border-t border-chrome/10 pt-3">
          <p className="text-[11px] leading-relaxed text-muted">
            Verify each layer of the consultation pipeline independently without requiring
            a live Google Meet participant.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {DIAGNOSTIC_BUTTONS.map(({ action, label }) => {
              const isRunning = runningAction === action;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={busy || runningAction !== null}
                  onClick={() => void handleAction(action)}
                  className="rounded-[3px] border border-chrome/18 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[10px] tracking-[0.08em] text-ink-soft transition hover:border-accent/60 hover:text-accent-soft disabled:opacity-50"
                >
                  {isRunning ? `Running ${action}...` : label}
                </button>
              );
            })}
          </div>

          {lastResult ? (
            <div className="rounded-[3px] border border-chrome/14 bg-night/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-soft">
                  {lastResult.action}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase ${
                    lastResult.ok ? "text-accent-soft" : "text-accent"
                  }`}
                >
                  {lastResult.ok ? "PASS" : "CHECK"}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
                {lastResult.summary}
              </p>
              {lastResult.details && Object.keys(lastResult.details).length > 0 ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-chrome/10 pt-2 font-mono text-[10px] text-muted">
                  {Object.entries(lastResult.details).map(([key, value]) => (
                    <div key={key} className="truncate">
                      <dt className="inline text-muted/80">{key}: </dt>
                      <dd className="inline text-ink-soft">
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </DresslyGlass>
  );
}
