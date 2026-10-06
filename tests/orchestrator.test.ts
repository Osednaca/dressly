import assert from "node:assert/strict";
import test from "node:test";
import { getProduct } from "@/lib/catalog/products";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { applyIntent, createSessionRecord, placeProduct } from "@/lib/session/reducer";
import { parseIntentDeterministic } from "@/services/gemini/fallback";
import type { SessionContext } from "@/services/gemini/client";
import type { IntentDelta } from "@/lib/types";

function emptyIntent(overrides: Partial<IntentDelta> = {}): IntentDelta {
  return {
    desiredStyles: [],
    avoidedStyles: [],
    preferredColors: [],
    avoidedColors: [],
    assistantReply: "",
    interpreted: [],
    ...overrides,
  };
}

test("with no credentials the agent decides deterministically and says so", async () => {
  const session = createSessionRecord("ses_orch", "/api/media/uploads/p.png");
  const turn = await runAgentTurn(session, emptyIntent({ desiredStyles: ["smart_casual"] }));
  assert.equal(turn.decision.provider, "fallback");
  assert.equal(turn.selection?.product.category, "upper_body");
  assert.ok(turn.decision.productEvaluation.length > 0);
  assert.ok(turn.decision.reason.length > 0);
  assert.equal(turn.blocked, null);
});

test("an explicit 'add a jacket' selects outerwear", async () => {
  let session = createSessionRecord("ses_orch2", "/api/media/uploads/p.png");
  session = placeProduct(session, getProduct("top_001")!);
  const turn = await runAgentTurn(
    session,
    emptyIntent({ requestedAction: "ADD_OUTER", targetCategory: "outer" }),
  );
  assert.equal(turn.selection?.product.category, "outer");
  assert.equal(turn.selection?.action, "ADD_OUTER");
});

test("a finish request produces no selection and completes the intent", async () => {
  let session = createSessionRecord("ses_orch3", "/api/media/uploads/p.png");
  session = placeProduct(session, getProduct("top_001")!);
  session = placeProduct(session, getProduct("bottom_001")!);
  const turn = await runAgentTurn(session, emptyIntent({ requestedAction: "FINISH_LOOK" }));
  assert.equal(turn.selection, null);
  assert.equal(turn.decision.action?.decision, "FINISH_LOOK");
});

test("the scripted opening brief yields an evening-appropriate top", async () => {
  const context: SessionContext = {
    targetStyles: [],
    avoidedStyles: [],
    preferredColors: [],
    avoidedColors: [],
    currentLook: "",
    rejected: [],
    liked: [],
    lookCount: 0,
  };
  const intent = parseIntentDeterministic(
    "I have a rooftop dinner tonight. Build me something elegant but not too formal.",
    context,
  );
  let session = createSessionRecord("ses_orch5", "/api/media/uploads/p.png");
  session = applyIntent(session, intent);
  const turn = await runAgentTurn(session, intent);
  assert.equal(turn.selection?.product.id, "top_001");
});

test("a request with every candidate rejected is blocked, not fabricated", async () => {
  let session = createSessionRecord("ses_orch4", "/api/media/uploads/p.png");
  const tops = ["top_001", "top_002", "top_003", "top_004", "top_005", "top_006", "top_007", "top_008", "top_009", "top_010", "top_011", "top_012"];
  session = { ...session, rejectedProducts: tops };
  const turn = await runAgentTurn(session, emptyIntent({}));
  assert.equal(turn.selection, null);
  assert.equal(turn.blocked?.code, "NO_CANDIDATES");
});
