import { runAgentTurn } from "@/lib/agent/orchestrator";
import { jobView } from "@/lib/agent/jobs";
import { startTryOn } from "@/lib/agent/tryon";
import type { BlockedView, ChatResponse, JobView } from "@/lib/api-types";
import { lookItems } from "@/lib/catalog/query";
import { getProduct } from "@/lib/catalog/products";
import { sessionPayload } from "@/lib/server/session-payload";
import {
  applyIntent,
  markCompleted,
  placeProduct,
  pushMessage,
  recordDecision,
} from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import type { IntentDelta, StylingSession } from "@/lib/types";
import { understand, type SessionContext } from "@/services/gemini";

/**
 * One conversational turn, start to finish.
 *
 * Order matters and is deliberately explicit:
 *   1. understand the sentence (Gemini, or the keyword fallback);
 *   2. fold it into session state (deterministic);
 *   3. let the agent choose an action and a garment (JEV, or the deterministic ranker);
 *   4. submit the chained YouCam try-on and hand the browser a job to poll.
 *
 * Nothing here reasons with an LLM about arithmetic, and no provider ever sees the
 * whole catalog.
 */
function contextFor(session: StylingSession): SessionContext {
  return {
    occasion: session.occasion,
    targetStyles: session.targetStyles,
    avoidedStyles: session.avoidedStyles,
    preferredColors: session.preferredColors,
    avoidedColors: session.avoidedColors,
    budget: session.budget,
    currentLook: lookItems(session.currentLook)
      .map((item) => item.name)
      .join(", "),
    rejected: session.rejectedProducts.map((id) => getProduct(id)?.name ?? id),
    liked: session.likedProducts.map((id) => getProduct(id)?.name ?? id),
    lookCount: session.looks.length,
  };
}

function defaultReply(intent: IntentDelta): string {
  if (intent.interpreted.length > 0) return `Understood — ${intent.interpreted.join(", ")}.`;
  return "Let me refine the look.";
}

export async function chatTurn(session: StylingSession, message: string): Promise<ChatResponse> {
  const understanding = await understand(message, contextFor(session));
  const intent = understanding.intent;
  const reply = intent.assistantReply.trim() || defaultReply(intent);

  const afterIntent =
    (await mutateSession(session.id, (current) => {
      let next = applyIntent(current, intent);
      next = pushMessage(next, "user", message);
      next = pushMessage(next, "dressly", reply);
      return next;
    })) ?? session;

  const turn = await runAgentTurn(afterIntent, intent);

  let blocked: BlockedView | null = turn.blocked;
  let job: JobView | null = null;

  const withDecision =
    (await mutateSession(session.id, (current) => {
      let next = recordDecision(current, turn.decision);
      if (turn.selection && turn.selection.action === "ADD_ACCESSORY") {
        next = placeProduct(next, turn.selection.product);
      }
      if (turn.decision.action?.decision === "FINISH_LOOK") {
        next = markCompleted(next);
      }
      return next;
    })) ?? afterIntent;

  if (!blocked && turn.selection && turn.selection.action !== "ADD_ACCESSORY") {
    const started = await startTryOn(withDecision, turn.selection);
    if (started.job) {
      job = jobView(started.job, withDecision.looks.length + 1);
    } else {
      blocked = started.blocked;
    }
  }

  const refreshed = (await getSession(session.id)) ?? withDecision;
  return {
    ...sessionPayload(refreshed),
    decision: turn.decision,
    job,
    understanding: {
      provider: understanding.provider,
      model: understanding.model,
      note: understanding.note,
    },
    blocked,
  };
}
