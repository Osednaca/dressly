import { EventEmitter } from "node:events";
import type { ConsultationSseEvent } from "@/lib/api-types";
import type { StylingSession } from "@/lib/types";
import { isSupabaseStorage, supabaseRequest } from "@/lib/storage/supabase";
import { assertSafeName } from "@/lib/storage/files";

const GLOBAL_KEY = "__dresslyConsultationEventEmitter";

function getEmitter(): EventEmitter {
  const globalStore = globalThis as unknown as Record<string, EventEmitter | undefined>;
  if (!globalStore[GLOBAL_KEY]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalStore[GLOBAL_KEY] = emitter;
  }
  return globalStore[GLOBAL_KEY]!;
}

function channelName(sessionId: string): string {
  return `consultation:${sessionId}`;
}

export async function publishConsultationEvent(
  sessionId: string,
  event: ConsultationSseEvent,
): Promise<void> {
  if (isSupabaseStorage()) {
    await supabaseRequest("/rest/v1/dressly_consultation_events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ session_id: assertSafeName(sessionId), event }),
    });
    return;
  }
  getEmitter().emit(channelName(sessionId), event);
}

interface EventRow { id: number; event: ConsultationSseEvent }

/** Replay must never roll the UI back to the stale snapshot embedded in an old event. */
export function currentConsultationEvent(
  event: ConsultationSseEvent,
  session: StylingSession,
  pendingIds: Set<string>,
): ConsultationSseEvent {
  if (
    (event.type === "design.generation.started" && !pendingIds.has(event.job.id)) ||
    (event.type === "design.generation.completed" && event.version.id !== session.consultation?.currentDesignVersionId) ||
    (event.type === "consultation.ended" && session.consultation?.status !== "ENDED")
  ) return { type: "consultation.updated", session };
  return { ...event, session };
}

/** Use monotonically ordered IDs so SSE reconnects can resume without missing events. */
export async function readConsultationEvents(sessionId: string, afterId?: number): Promise<EventRow[]> {
  const filter = `session_id=eq.${encodeURIComponent(assertSafeName(sessionId))}`;
  const query = afterId === undefined
    ? `${filter}&select=id,event&order=id.desc&limit=1`
    : `${filter}&id=gt.${afterId}&select=id,event&order=id.asc&limit=100`;
  const response = await supabaseRequest(`/rest/v1/dressly_consultation_events?${query}`);
  return await response.json() as EventRow[];
}

export function subscribeConsultationEvents(
  sessionId: string,
  listener: (event: ConsultationSseEvent) => void,
): () => void {
  const emitter = getEmitter();
  const channel = channelName(sessionId);
  emitter.on(channel, listener);
  return () => {
    emitter.off(channel, listener);
  };
}
