"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { DecisionsPanel } from "@/components/DecisionsPanel";
import { FinalLook } from "@/components/FinalLook";
import { FittingRoom } from "@/components/FittingRoom";
import { LookHistory } from "@/components/LookHistory";
import { Masthead } from "@/components/Masthead";
import { Onboarding } from "@/components/Onboarding";
import { ProviderBanner } from "@/components/ProviderBanner";
import { Sparkle } from "@/components/icons";
import { api } from "@/lib/client/api";
import type { BlockedView, ChatResponse, JobView, SessionPayload, Suggestion } from "@/lib/api-types";
import type { StylingSession } from "@/lib/types";

const POLL_INTERVAL_MS = 1800;
const MAX_POLLS = 90;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The whole browser experience.
 *
 * It holds exactly one piece of authoritative information — the session the server
 * returned — and renders it. Every mutation is a request; every long provider call is
 * a job it polls. There is no optimistic state to drift from the truth.
 */
export function DresslyApp() {
  const [session, setSession] = useState<StylingSession | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [job, setJob] = useState<JobView | null>(null);
  const [blocked, setBlocked] = useState<BlockedView | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  const [mock, setMock] = useState(false);
  const [runwayAvailable, setRunwayAvailable] = useState(false);
  const [animationJob, setAnimationJob] = useState<JobView | null>(null);
  const [animationBlocked, setAnimationBlocked] = useState<BlockedView | null>(null);
  const [cartAdded, setCartAdded] = useState(false);
  const [finalDismissed, setFinalDismissed] = useState(false);

  const pollToken = useRef(0);

  useEffect(() => {
    api
      .providers()
      .then((providers) => {
        setMock(providers.mock);
        setRunwayAvailable(providers.statuses.some((s) => s.id === "runway" && s.active));
      })
      .catch(() => undefined);
  }, []);

  const applyPayload = useCallback((payload: SessionPayload) => {
    setSession(payload.session);
    setSuggestions(payload.suggestions);
  }, []);

  const pollJob = useCallback(async (initial: JobView) => {
    const token = ++pollToken.current;
    setJob(initial);
    for (let index = 0; index < MAX_POLLS; index += 1) {
      await delay(POLL_INTERVAL_MS);
      if (pollToken.current !== token) return;
      try {
        const result = await api.pollJob(initial.id);
        if (pollToken.current !== token) return;
        setJob(result.job);
        if (result.session) {
          setSession(result.session);
          if (result.suggestions) setSuggestions(result.suggestions);
        }
        if (result.job.status !== "pending") return;
      } catch (pollError) {
        if (pollToken.current !== token) return;
        setJob({
          ...initial,
          status: "failed",
          message: pollError instanceof Error ? pollError.message : "Lost contact with the server.",
          retryable: true,
        });
        return;
      }
    }
    if (pollToken.current === token) {
      setJob({
        ...initial,
        status: "failed",
        message: "This try-on is taking too long. Try again or choose another piece.",
        retryable: true,
      });
    }
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!session) return;
      setSending(true);
      setError(null);
      setBlocked(null);
      try {
        const response: ChatResponse = await api.chat(session.id, message);
        applyPayload(response);
        setBlocked(response.blocked);
        if (response.job) await pollJob(response.job);
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : "Something went wrong.");
      } finally {
        setSending(false);
      }
    },
    [applyPayload, pollJob, session],
  );

  const begin = useCallback(
    async ({ file, occasion }: { file: File | null; occasion: string }) => {
      setOnboardingBusy(true);
      setOnboardingError(null);
      try {
        const created = await api.createSession();
        let current = created.session;
        if (file) {
          const uploaded = await api.uploadPhoto(current.id, file);
          current = uploaded.session;
          setSuggestions(uploaded.suggestions);
        } else {
          setSuggestions(created.suggestions);
        }
        setSession(current);
        setFinalDismissed(false);
        setCartAdded(false);
        setOnboardingBusy(false);
        await sendMessage(occasion);
      } catch (beginError) {
        setOnboardingError(
          beginError instanceof Error ? beginError.message : "Could not start the session.",
        );
        setOnboardingBusy(false);
      }
    },
    [sendMessage],
  );

  const onRetry = useCallback(
    async (jobId: string) => {
      try {
        const result = await api.retryJob(jobId);
        setBlocked(result.blocked);
        if (result.job) await pollJob(result.job);
      } catch (retryError) {
        setError(retryError instanceof Error ? retryError.message : "Retry failed.");
      }
    },
    [pollJob],
  );

  const withSession = useCallback(
    async (action: (id: string) => Promise<SessionPayload>) => {
      if (!session) return;
      try {
        applyPayload(await action(session.id));
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Something went wrong.");
      }
    },
    [applyPayload, session],
  );

  const onAnimate = useCallback(async () => {
    if (!session) return;
    setAnimationBlocked(null);
    try {
      const result = await api.animate(session.id, session.activeLookId ?? undefined);
      setAnimationBlocked(result.blocked);
      if (!result.job) return;
      const token = ++pollToken.current;
      setAnimationJob(result.job);
      for (let index = 0; index < MAX_POLLS; index += 1) {
        await delay(2500);
        if (pollToken.current !== token) return;
        const polled = await api.pollJob(result.job.id);
        setAnimationJob(polled.job);
        if (polled.session) setSession(polled.session);
        if (polled.job.status !== "pending") return;
      }
    } catch (animateError) {
      setAnimationBlocked({
        code: "RUNWAY_FAILED",
        message: animateError instanceof Error ? animateError.message : "Animation failed.",
        retryable: true,
      });
    }
  }, [session]);

  const newLook = useCallback(() => {
    pollToken.current += 1;
    setSession(null);
    setSuggestions([]);
    setJob(null);
    setBlocked(null);
    setError(null);
    setCartAdded(false);
    setFinalDismissed(false);
    setAnimationJob(null);
    setAnimationBlocked(null);
    window.scrollTo({ top: 0 });
  }, []);

  const working = sending || job?.status === "pending";
  const completed = session?.status === "COMPLETED";
  const showFinal = Boolean(completed && !finalDismissed);

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead />
      <ProviderBanner />

      {error ? (
        <div className="relative z-10 border-b border-accent/30 bg-accent/5 px-6 py-2 text-center text-[12px] text-accent md:px-10">
          {error}
        </div>
      ) : null}

      {!session ? (
        <Onboarding busy={onboardingBusy} error={onboardingError} onBegin={begin} />
      ) : (
        <main className="relative z-10 mx-auto grid w-full max-w-[1500px] flex-1 gap-8 px-6 py-8 md:px-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)]">
          <FittingRoom
            session={session}
            job={job}
            mock={mock}
            blocked={blocked}
            onRetry={onRetry}
            onClearRejections={() => withSession(api.clearRejections)}
          />

          <div className="flex min-h-0 flex-col gap-4">
            <ChatPanel
              messages={session.messages}
              suggestions={suggestions}
              busy={working}
              onSend={sendMessage}
            />

            <LookHistory
              looks={session.looks}
              activeLookId={session.activeLookId}
              busy={working}
              onRestore={(lookId) => withSession((id) => api.restoreLook(id, lookId))}
              onFeedback={(lookId, feedback) =>
                withSession((id) => api.setFeedback(id, lookId, feedback))
              }
            />

            <div className="flex gap-3">
              <button
                type="button"
                disabled={working || session.looks.length === 0}
                onClick={() => withSession(api.finish)}
                className="flex flex-1 items-center justify-center gap-2 rounded-[2px] border border-line bg-card px-4 py-3 text-[12px] uppercase tracking-[0.16em] text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <Sparkle width={15} height={15} /> Finish the look
              </button>
              {completed ? (
                <button
                  type="button"
                  onClick={() => setFinalDismissed(false)}
                  className="rounded-[2px] bg-ink px-4 py-3 text-[12px] uppercase tracking-[0.16em] text-paper transition hover:bg-accent"
                >
                  View look
                </button>
              ) : null}
            </div>

            <DecisionsPanel decisions={session.decisions} />
          </div>
        </main>
      )}

      {showFinal && session ? (
        <FinalLook
          session={session}
          runwayAvailable={runwayAvailable}
          animationJob={animationJob}
          animationBlocked={animationBlocked}
          cartAdded={cartAdded}
          onAnimate={onAnimate}
          onAddToCart={() => setCartAdded(true)}
          onNewLook={newLook}
          onClose={() => setFinalDismissed(true)}
        />
      ) : null}
    </div>
  );
}
