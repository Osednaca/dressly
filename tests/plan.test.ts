import assert from "node:assert/strict";
import test from "node:test";
import { getProduct } from "@/lib/catalog/products";
import { actionScores, gapCategory, planTurn } from "@/lib/agent/plan";
import { createSessionRecord, placeProduct } from "@/lib/session/reducer";
import type { IntentDelta, StylingSession } from "@/lib/types";

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

function dressed(): StylingSession {
  let session = createSessionRecord("ses_plan", null);
  session = placeProduct(session, getProduct("top_001")!);
  return session;
}

test("the first gap is the top, then bottom, then shoes, then outer", () => {
  const fresh = createSessionRecord("ses_gap", null);
  assert.equal(gapCategory(fresh), "upper_body");
  const withTop = placeProduct(fresh, getProduct("top_001")!);
  assert.equal(gapCategory(withTop), "lower_body");
  const withBottom = placeProduct(withTop, getProduct("bottom_001")!);
  assert.equal(gapCategory(withBottom), "shoes");
  const withShoes = placeProduct(withBottom, getProduct("shoes_001")!);
  assert.equal(gapCategory(withShoes), "outer");
});

test("an explicit request drives the focus and is offered", () => {
  const session = dressed();
  const plan = planTurn(
    session,
    emptyIntent({ requestedAction: "ADD_OUTER", targetCategory: "outer" }),
  );
  assert.equal(plan.focus, "outer");
  assert.ok(plan.actions.some((action) => action.id === "ADD_OUTER"));
  assert.ok(plan.candidates.some((candidate) => candidate.product.category === "outer"));
});

test("an explicit requested action always scores highest for the fallback", () => {
  const session = dressed();
  const plan = planTurn(session, emptyIntent({ requestedAction: "ADD_OUTER" }));
  const scores = actionScores(session, plan);
  assert.equal(scores.ADD_OUTER, 1);
  const max = Math.max(...Object.values(scores));
  assert.equal(max, scores.ADD_OUTER);
});

test("a FINISH request offers no garment alternatives", () => {
  const session = dressed();
  const plan = planTurn(session, emptyIntent({ requestedAction: "FINISH_LOOK" }));
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.products, []);
  assert.ok(plan.actions.some((action) => action.id === "FINISH_LOOK"));
});

test("planning is deterministic for identical state", () => {
  const session = dressed();
  const intent = emptyIntent({ desiredStyles: ["smart_casual"] });
  assert.deepEqual(planTurn(session, intent), planTurn(session, intent));
});
