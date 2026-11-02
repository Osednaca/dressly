export const dynamic = "force-dynamic";

import { currentConsultationEvent, readConsultationEvents, subscribeConsultationEvents } from "@/lib/server/consultation-events";
import { listPendingJobsForSession } from "@/lib/agent/jobs";
import { isSupabaseStorage } from "@/lib/storage/supabase";
import { getSession } from "@/lib/session/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (isSupabaseStorage()) {
    return cloudEvents(request, id);
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      safeEnqueue(": connected\n\n");

      const unsubscribe = subscribeConsultationEvents(id, (event) => {
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        safeEnqueue(": keep-alive\n\n");
      }, 15_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      request.signal.addEventListener("abort", () => {
        cleanup?.();
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/** A bounded SSE stream polls durable events and resumes using Last-Event-ID. */
async function cloudEvents(request: Request, id: string): Promise<Response> {
  const previous = request.headers.get("last-event-id");
  const validPrevious = previous && /^\d{1,15}$/.test(previous) ? Number(previous) : null;
  // Capture a boundary before loading the snapshot so mutations during startup are replayed.
  const latest = validPrevious === null ? await readConsultationEvents(id) : [];
  let cursor = validPrevious ?? latest[0]?.id ?? 0;
  const snapshot = await getSession(id);
  if (!snapshot) return Response.json({ error: "Session not found" }, { status: 404 });
  const pending = await listPendingJobsForSession(id);
  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: string) => { if (!cancelled) controller.enqueue(encoder.encode(value)); };
      const stop = () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        wake?.();
      };
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        send(`retry: 1000\ndata: ${JSON.stringify({ type: "consultation.updated", session: snapshot })}\n\n`);
        // A new subscriber can resume an existing voice-started generation even if it missed the start event.
        for (const job of pending) {
          if (job.kind === "consultation_design") {
            send(`data: ${JSON.stringify({ type: "design.generation.started", job, session: snapshot })}\n\n`);
          }
        }
        const deadline = Date.now() + 20_000;
        while (!cancelled && Date.now() < deadline) {
          const rows = await readConsultationEvents(id, cursor);
          // Historical event payloads contain old session snapshots. Refresh the
          // authoritative state before replay so reconnect never rolls it back.
          const current = rows.length ? await getSession(id) : null;
          const currentPending = current ? await listPendingJobsForSession(id) : [];
          const pendingIds = new Set(currentPending.map((job) => job.id));
          for (const row of rows) {
            if (cancelled) break;
            const event = current ? currentConsultationEvent(row.event, current, pendingIds) : row.event;
            send(`id: ${row.id}\ndata: ${JSON.stringify(event)}\n\n`);
            cursor = row.id;
          }
          if (!cancelled) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, 1_000);
            });
          }
        }
        if (!cancelled) controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      } finally {
        stop();
        request.signal.removeEventListener("abort", stop);
      }
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      wake?.();
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  } });
}
