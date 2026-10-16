import { EventEmitter } from "node:events";
import type { ConsultationSseEvent } from "@/lib/api-types";

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

export function publishConsultationEvent(
  sessionId: string,
  event: ConsultationSseEvent,
): void {
  getEmitter().emit(channelName(sessionId), event);
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
