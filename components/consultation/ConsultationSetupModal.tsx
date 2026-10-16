"use client";

import { useState } from "react";
import { Check, Sparkle, X } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import { DresslyGlow } from "@/components/shaders/DresslyGlow";
import type { StartConsultationRequest } from "@/lib/api-types";

const DEMO_MEET_URL = "https://meet.google.com/drs-live-bag";

export interface ConsultationSetupModalProps {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  initialMeetingUrl?: string;
  onClose: () => void;
  onStart: (request: StartConsultationRequest) => void;
}

export function ConsultationSetupModal({
  open,
  busy = false,
  error = null,
  initialMeetingUrl = DEMO_MEET_URL,
  onClose,
  onStart,
}: ConsultationSetupModalProps) {
  const [meetingUrl, setMeetingUrl] = useState(initialMeetingUrl);
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  const [autoApply, setAutoApply] = useState(false);
  const [autoTryOn, setAutoTryOn] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  const handleOpenNewMeet = () => {
    window.open("https://meet.google.com/new", "_blank", "noopener,noreferrer");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    const trimmed = meetingUrl.trim();
    if (!trimmed) {
      setLocalError("Please enter a Google Meet URL to join the consultation.");
      return;
    }
    if (!consentConfirmed) {
      setLocalError("Explicit participant listening consent is required before starting.");
      return;
    }

    onStart({
      meetingUrl: trimmed,
      consentConfirmed,
      autoApply,
      autoTryOn,
    });
  };

  const displayError = error ?? localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-fade"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consultation-modal-title"
    >
      <div className="w-full max-w-xl">
        <DresslyGlow active className="block">
          <DresslyGlass tone="strong" shaderSheen className="p-6 md:p-8">
            <div className="flex items-start justify-between gap-4 border-b border-chrome/12 pb-5">
              <div>
                <p className="overline text-accent-soft">Style it. Design it. Try it.</p>
                <h2
                  id="consultation-modal-title"
                  className="mt-1.5 text-2xl tracking-tight text-ink md:text-[28px]"
                >
                  Live Design Consultation
                </h2>
                <p className="mt-1 text-[13px] text-muted">
                  Invite Dressly into your Google Meet to listen, propose bespoke design revisions,
                  and visualize them in real time.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close consultation setup"
                className="rounded-full border border-chrome/15 p-2 text-muted transition hover:border-chrome/35 hover:text-ink"
              >
                <X width={15} height={15} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-5">
              {/* Option A: Create new Google Meet */}
              <div className="rounded-[3px] border border-chrome/12 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="overline text-ink-soft">Option A — Start a new Google Meet</p>
                    <p className="mt-1 text-[12px] text-muted">
                      Launch a fresh consultation room, then paste its meeting URL below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenNewMeet}
                    className="sheen rounded-[3px] border border-chrome/20 bg-white/[0.04] px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-ink transition hover:border-accent/60 hover:text-accent-soft"
                  >
                    Open Google Meet
                  </button>
                </div>
              </div>

              {/* Option B: Existing Google Meet URL */}
              <div className="rounded-[3px] border border-chrome/12 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label htmlFor="consultation-meet-url" className="overline text-ink-soft">
                    Option B — Join an existing Google Meet URL
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMeetingUrl(DEMO_MEET_URL);
                      setLocalError(null);
                    }}
                    className="text-[11px] text-accent-soft underline decoration-accent/40 underline-offset-4 transition hover:text-ink"
                  >
                    Use demo consultation room
                  </button>
                </div>

                <input
                  id="consultation-meet-url"
                  type="text"
                  value={meetingUrl}
                  onChange={(e) => {
                    setMeetingUrl(e.target.value);
                    setLocalError(null);
                  }}
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  disabled={busy}
                  className="mt-2.5 w-full rounded-[3px] border border-chrome/18 bg-night/80 px-3.5 py-2.5 font-mono text-[13px] text-ink placeholder:text-muted/50 focus:border-accent focus:outline-none"
                />

                <p className="mt-2.5 text-[12px] italic text-ink-soft/85">
                  Keep the consultation visible using Google Meet Picture-in-Picture while Dressly
                  serves as your design workspace.
                </p>
              </div>

              {/* Session Preferences */}
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAutoApply((v) => !v)}
                  className={`flex items-center justify-between rounded-[3px] border px-3.5 py-2.5 text-left transition ${
                    autoApply
                      ? "border-accent/60 bg-accent/10 text-ink"
                      : "border-chrome/12 bg-white/[0.02] text-muted hover:border-chrome/25"
                  }`}
                >
                  <span className="overline">Auto Apply</span>
                  <span className="font-mono text-[12px] text-accent-soft">
                    {autoApply ? "● ON" : "○ OFF"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setAutoTryOn((v) => !v)}
                  className={`flex items-center justify-between rounded-[3px] border px-3.5 py-2.5 text-left transition ${
                    autoTryOn
                      ? "border-accent/60 bg-accent/10 text-ink"
                      : "border-chrome/12 bg-white/[0.02] text-muted hover:border-chrome/25"
                  }`}
                >
                  <span className="overline">Auto Try-On</span>
                  <span className="font-mono text-[12px] text-accent-soft">
                    {autoTryOn ? "● ON" : "○ OFF"}
                  </span>
                </button>
              </div>

              {/* Mandatory Privacy & Consent Block */}
              <div className="rounded-[3px] border border-accent/30 bg-accent/[0.06] p-4">
                <p className="overline text-accent-soft">Participant Privacy &amp; AI Disclosure</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
                  Dressly AI Assistant will join this Google Meet and process the conversation to
                  detect fashion design requests. All participants should know the AI assistant is
                  listening.
                </p>

                <label className="mt-3 flex cursor-pointer items-center gap-3 select-none">
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    onChange={(e) => {
                      setConsentConfirmed(e.target.checked);
                      setLocalError(null);
                    }}
                    className="sr-only"
                  />
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border transition ${
                      consentConfirmed
                        ? "border-accent bg-accent text-night"
                        : "border-chrome/35 bg-night"
                    }`}
                  >
                    {consentConfirmed ? <Check width={12} height={12} /> : null}
                  </span>
                  <span className="text-[12px] font-medium text-ink">
                    All participants are informed that Dressly AI Assistant is listening
                  </span>
                </label>
              </div>

              {displayError ? (
                <p className="rounded-[3px] border border-accent/40 bg-accent/10 px-3.5 py-2 text-[12px] text-accent-soft">
                  {displayError}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3 border-t border-chrome/12 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-[3px] border border-chrome/18 bg-white/[0.03] px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-chrome/35 hover:text-ink disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !consentConfirmed}
                  className="sheen inline-flex items-center gap-2 rounded-[3px] border border-accent/60 bg-accent px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-night transition hover:bg-accent-soft disabled:opacity-50"
                >
                  <Sparkle width={14} height={14} />
                  {busy ? "Starting..." : "Start Consultation"}
                </button>
              </div>
            </form>
          </DresslyGlass>
        </DresslyGlow>
      </div>
    </div>
  );
}
