"use client";

import { useState } from "react";
import { ConsultationDiagnostics } from "@/components/consultation/ConsultationDiagnostics";
import { SuggestionCard } from "@/components/consultation/SuggestionCard";
import { ChevronDown, Mic, Send, Sparkle } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import type {
  ConsultationDiagnosticRequest,
  ConsultationDiagnosticResponse,
} from "@/lib/api-types";
import type {
  ConsultationStatus,
  DesignFieldDiff,
  LiveConsultationSession,
} from "@/lib/types";

const FLAGSHIP_SCENARIO_CHIPS = [
  "I like it, but can we make the hardware silver?",
  "That's better. Maybe make it a little smaller.",
  "Could we make the strap longer so I can wear it crossbody?",
  "Can I see how that looks on me?",
] as const;

function formatStatusLabel(status: ConsultationStatus): {
  symbol: string;
  label: string;
  pulse: boolean;
} {
  switch (status) {
    case "OFFLINE":
      return { symbol: "○", label: "Consultation offline", pulse: false };
    case "STARTING":
      return { symbol: "◌", label: "Dressly bot joining", pulse: true };
    case "WAITING_FOR_ADMISSION":
      return { symbol: "◌", label: "Waiting for host approval", pulse: true };
    case "LIVE":
      return { symbol: "●", label: "Dressly is listening", pulse: true };
    case "GENERATING_DESIGN":
      return { symbol: "◌", label: "Generating design", pulse: true };
    case "GENERATING_TRYON":
      return { symbol: "◌", label: "Creating virtual try-on", pulse: true };
    case "RECONNECTING":
      return { symbol: "◌", label: "Dressly bot joining", pulse: true };
    case "ENDED":
    case "FAILED":
      return { symbol: "■", label: "Consultation ended", pulse: false };
  }
}

function formatTimeHhMm(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export interface ConsultationPanelProps {
  consultation: LiveConsultationSession;
  busy?: boolean;
  onUpdateSettings: (patch: { autoApply?: boolean; autoTryOn?: boolean }) => void;
  onSendTranscript: (text: string) => void;
  onApplySuggestion: (suggestionId: string) => void;
  onIgnoreSuggestion: (suggestionId: string) => void;
  onEditSuggestion: (suggestionId: string, editedChanges: DesignFieldDiff[]) => void;
  onEndConsultation: () => void;
  onRejoinConsultation: () => void;
  onRunDiagnostic: (
    req: ConsultationDiagnosticRequest,
  ) => Promise<ConsultationDiagnosticResponse | null>;
}

export function ConsultationPanel({
  consultation,
  busy = false,
  onUpdateSettings,
  onSendTranscript,
  onApplySuggestion,
  onIgnoreSuggestion,
  onEditSuggestion,
  onEndConsultation,
  onRejoinConsultation,
  onRunDiagnostic,
}: ConsultationPanelProps) {
  const [utterance, setUtterance] = useState("");
  const [copied, setCopied] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const statusInfo = formatStatusLabel(consultation.status);
  const isEndedOrFailed =
    consultation.status === "ENDED" || consultation.status === "FAILED";
  const showRejoinButton =
    isEndedOrFailed ||
    consultation.botStatus === "FAILED" ||
    consultation.botStatus === "STOPPED";

  const handleCopyMeetLink = async () => {
    try {
      await navigator.clipboard.writeText(consultation.meetingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleOpenMeet = () => {
    const url = consultation.meetingUrl.startsWith("http")
      ? consultation.meetingUrl
      : "https://meet.google.com";
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSubmitUtterance = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = utterance.trim();
    if (!trimmed || busy) return;
    setUtterance("");
    onSendTranscript(trimmed);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Status & Google Meet Toolbar */}
      <DresslyGlass tone="strong" shaderSheen className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-chrome/12 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`font-mono text-[13px] ${
                statusInfo.pulse ? "animate-pulse text-accent" : "text-muted"
              }`}
              aria-hidden="true"
            >
              {statusInfo.symbol}
            </span>
            <span className="overline text-ink">{statusInfo.label}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenMeet}
              className="rounded-[3px] border border-chrome/18 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-accent/60 hover:text-accent-soft"
            >
              Open Meet
            </button>
            <button
              type="button"
              onClick={() => void handleCopyMeetLink()}
              className="rounded-[3px] border border-chrome/18 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-accent/60 hover:text-accent-soft"
            >
              {copied ? "Copied" : "Copy Meet Link"}
            </button>
            {showRejoinButton ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRejoinConsultation}
                className="rounded-[3px] border border-accent/50 bg-accent/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-accent-soft transition hover:bg-accent hover:text-night disabled:opacity-50"
              >
                Rejoin
              </button>
            ) : null}
            {!isEndedOrFailed ? (
              <button
                type="button"
                disabled={busy}
                onClick={onEndConsultation}
                className="rounded-[3px] border border-chrome/18 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-muted transition hover:border-accent/60 hover:text-accent disabled:opacity-50"
              >
                End Consultation
              </button>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-[12px] text-muted">
          Keep the consultation visible using Google Meet Picture-in-Picture
          <span className="ml-2 font-mono text-[11px] text-ink-soft/75">
            ({consultation.meetingUrl})
          </span>
        </p>

        {/* Session Toggles Bar */}
        <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onUpdateSettings({ autoApply: !consultation.autoApply })}
            className={`flex items-center justify-between rounded-[3px] border px-3 py-2 text-left transition ${
              consultation.autoApply
                ? "border-accent/60 bg-accent/12 text-ink"
                : "border-chrome/12 bg-white/[0.02] text-muted hover:border-chrome/25"
            }`}
          >
            <span className="overline">AUTO APPLY</span>
            <span className="font-mono text-[12px] text-accent-soft">
              {consultation.autoApply ? "●" : "○"}
            </span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onUpdateSettings({ autoTryOn: !consultation.autoTryOn })}
            className={`flex items-center justify-between rounded-[3px] border px-3 py-2 text-left transition ${
              consultation.autoTryOn
                ? "border-accent/60 bg-accent/12 text-ink"
                : "border-chrome/12 bg-white/[0.02] text-muted hover:border-chrome/25"
            }`}
          >
            <span className="overline">AUTO TRY-ON AFTER GENERATION</span>
            <span className="font-mono text-[12px] text-accent-soft">
              {consultation.autoTryOn ? "●" : "○"}
            </span>
          </button>
        </div>

        {consultation.autoApply ? (
          <p className="mt-2.5 rounded-[2px] border border-accent/30 bg-accent/[0.07] px-3 py-1.5 text-[11px] text-accent-soft">
            Auto Apply active — high-confidence modifications (≥90%) apply automatically.
          </p>
        ) : null}
      </DresslyGlass>

      {/* Detected Suggestions Stack */}
      <div className="space-y-3">
        {consultation.pendingSuggestions.length > 0 ? (
          consultation.pendingSuggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              busy={busy}
              onIgnore={onIgnoreSuggestion}
              onApply={onApplySuggestion}
              onEdit={onEditSuggestion}
            />
          ))
        ) : (
          <DresslyGlass className="p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent-soft">
                <Mic width={14} height={14} />
              </span>
              <div>
                <p className="overline text-ink-soft">Human-in-the-loop creative assistant</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  Customer speaks → Dressly hears → Designer approves → Runway creates → YouCam
                  visualizes
                </p>
              </div>
            </div>
          </DresslyGlass>
        )}
      </div>

      {/* Live / Demo Utterance Input & Flagship Scenario Chips */}
      <DresslyGlass className="p-4">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="consultation-utterance-input" className="overline text-muted">
            Simulate or enter meeting speech
          </label>
          <span className="inline-flex items-center gap-1 text-[11px] text-accent-soft">
            <Sparkle width={12} height={12} /> Gemini + JEV
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {FLAGSHIP_SCENARIO_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={busy || isEndedOrFailed}
              onClick={() => onSendTranscript(chip)}
              className="rounded-full border border-chrome/15 bg-white/[0.025] px-3 py-1 text-left text-[11px] text-ink-soft transition hover:border-accent/60 hover:text-accent-soft disabled:opacity-50"
            >
              &ldquo;{chip}&rdquo;
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmitUtterance} className="mt-3 flex items-center gap-2">
          <input
            id="consultation-utterance-input"
            type="text"
            value={utterance}
            disabled={busy || isEndedOrFailed}
            onChange={(e) => setUtterance(e.target.value)}
            placeholder="Speak in Meet or type a client request (e.g. 'Make the hardware silver')..."
            className="w-full rounded-[3px] border border-chrome/15 bg-night/80 px-3 py-2 text-[13px] text-ink placeholder:text-muted/50 focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || isEndedOrFailed || utterance.trim().length === 0}
            aria-label="Send meeting utterance"
            className="sheen inline-flex shrink-0 items-center justify-center rounded-[3px] border border-accent/60 bg-accent px-3.5 py-2 text-night transition hover:bg-accent-soft disabled:opacity-40"
          >
            <Send width={15} height={15} />
          </button>
        </form>
      </DresslyGlass>

      {/* Design Activity Stream */}
      <DresslyGlass className="p-4">
        <div className="flex items-center justify-between">
          <p className="overline text-muted">Design activity</p>
          <span className="font-mono text-[11px] text-muted">
            {consultation.activity.length} events
          </span>
        </div>

        {consultation.activity.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">No activity recorded yet.</p>
        ) : (
          <ul className="thin-scroll mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
            {[...consultation.activity].reverse().map((entry) => (
              <li
                key={entry.id}
                className="flex items-baseline gap-2.5 border-b border-chrome/8 pb-1.5 text-[12px] last:border-b-0 last:pb-0"
              >
                <span className="shrink-0 font-mono text-[10px] text-muted">
                  {formatTimeHhMm(entry.timestamp)}
                </span>
                <span className="text-ink-soft">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Secondary Collapsible Transcript */}
        <div className="mt-3 border-t border-chrome/10 pt-3">
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-expanded={transcriptOpen}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="overline text-muted">
              View transcript ({consultation.transcript.length})
            </span>
            <ChevronDown
              width={14}
              height={14}
              className={`text-muted transition-transform ${transcriptOpen ? "" : "-rotate-90"}`}
            />
          </button>

          {transcriptOpen ? (
            <div className="thin-scroll mt-2.5 max-h-36 space-y-1.5 overflow-y-auto rounded-[3px] border border-chrome/10 bg-night/60 p-3">
              {consultation.transcript.length === 0 ? (
                <p className="text-[12px] text-muted">
                  Waiting for spoken phrases from the consultation...
                </p>
              ) : (
                consultation.transcript.map((segment) => (
                  <p key={segment.id} className="text-[12px] leading-relaxed text-ink-soft">
                    <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-soft">
                      {segment.speaker}:
                    </span>
                    &ldquo;{segment.text}&rdquo;
                  </p>
                ))
              )}
            </div>
          ) : null}
        </div>
      </DresslyGlass>

      {/* Developer & Demo Layer Diagnostics Drawer */}
      <ConsultationDiagnostics busy={busy} onRunDiagnostic={onRunDiagnostic} />
    </div>
  );
}
