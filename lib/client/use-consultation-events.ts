"use client";

import { useEffect, useRef } from "react";
import type { ConsultationSseEvent } from "@/lib/api-types";
import type { StylingSession } from "@/lib/types";

export interface UseConsultationEventsOptions {
  sessionId?: string | null;
  enabled?: boolean;
  onSessionUpdate?: (session: StylingSession) => void;
  onEvent?: (event: ConsultationSseEvent) => void;
}

/**
 * Subscribes via browser EventSource to `/api/sessions/${sessionId}/consultation/events`
 * whenever `enabled && sessionId` is truthy.
 */
export function useConsultationEvents({
  sessionId,
  enabled = true,
  onSessionUpdate,
  onEvent,
}: UseConsultationEventsOptions): void {
  const onSessionUpdateRef = useRef(onSessionUpdate);
  onSessionUpdateRef.current = onSessionUpdate;

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !sessionId || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const url = `/api/sessions/${encodeURIComponent(sessionId)}/consultation/events`;
    const source = new EventSource(url);

    const handleMessage = (messageEvent: MessageEvent<string>) => {
      if (!messageEvent.data) return;
      try {
        const parsed = JSON.parse(messageEvent.data) as ConsultationSseEvent;
        if ("session" in parsed && parsed.session) {
          onSessionUpdateRef.current?.(parsed.session);
        }
        onEventRef.current?.(parsed);
        if (parsed.type === "consultation.ended") {
          source.close();
        }
      } catch {
        // Ignore malformed SSE frames
      }
    };

    source.addEventListener("message", handleMessage);

    return () => {
      source.removeEventListener("message", handleMessage);
      source.close();
    };
  }, [enabled, sessionId]);
}
