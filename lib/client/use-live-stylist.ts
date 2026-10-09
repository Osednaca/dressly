"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { LiveStylist, type LiveStatus, type LiveToolCall } from "@/lib/client/live";

export interface LiveCaptions {
  user: string;
  dressly: string;
}

const GREETING =
  "[fitting room] The shopper just started a voice session. Greet them in one short sentence and, if no occasion is known yet, ask what they are dressing for.";

/**
 * React ownership of one Gemini Live conversation.
 *
 * The tool handler is read through a ref so the session always calls the latest app
 * state without reconnecting on every render.
 */
export function useLiveStylist(
  sessionId: string | undefined,
  onToolCall: (call: LiveToolCall) => Promise<Record<string, unknown>>,
) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<LiveCaptions>({ user: "", dressly: "" });
  const liveRef = useRef<LiveStylist | null>(null);
  const toolRef = useRef(onToolCall);
  toolRef.current = onToolCall;

  const stop = useCallback(() => {
    liveRef.current?.stop();
    liveRef.current = null;
    setStatus("idle");
    setCaptions({ user: "", dressly: "" });
  }, []);

  const start = useCallback(async () => {
    if (!sessionId || liveRef.current) return;
    setError(null);
    const live = new LiveStylist({
      onStatus: (next, detail) => {
        setStatus(next);
        if (next === "error" || next === "idle") liveRef.current = null;
        if (detail) setError(detail);
      },
      onTranscript: (role, text) =>
        setCaptions((current) =>
          role === "user" ? { user: text, dressly: "" } : { ...current, dressly: text },
        ),
      onToolCall: (call) => toolRef.current(call),
    });
    liveRef.current = live;
    try {
      const { token, model } = await api.liveToken(sessionId);
      if (liveRef.current !== live) return;
      await live.start(token, model, GREETING);
    } catch (startError) {
      live.stop();
      liveRef.current = null;
      setStatus("error");
      setError(startError instanceof Error ? startError.message : "Could not start the live stylist.");
    }
  }, [sessionId]);

  const sendText = useCallback((text: string) => liveRef.current?.sendText(text), []);
  const notify = useCallback((text: string) => liveRef.current?.notify(text), []);

  useEffect(() => stop, [sessionId, stop]);

  return { status, error, captions, active: status === "connecting" || status === "live", start, stop, sendText, notify };
}
