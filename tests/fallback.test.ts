import assert from "node:assert/strict";
import test from "node:test";
import { parseIntentDeterministic } from "@/services/gemini/fallback";
import type { SessionContext } from "@/services/gemini/client";

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

test("the opening brief is not misread as a rejection", () => {
  const intent = parseIntentDeterministic(
    "I have a rooftop dinner tonight. Build me something elegant but not too formal.",
    context,
  );
  assert.notEqual(intent.feedbackOnCurrent, "rejected");
  assert.ok(intent.desiredStyles.includes("smart_casual"));
  assert.ok(intent.avoidedStyles.includes("formal"));
});

test("'too formal' on a later turn is a rejection that shifts the direction", () => {
  const intent = parseIntentDeterministic("That's too formal.", { ...context, lookCount: 1 });
  assert.equal(intent.feedbackOnCurrent, "rejected");
  assert.ok(intent.avoidedStyles.includes("formal"));
  assert.ok(intent.desiredStyles.includes("casual"));
});

test("explicit garment requests map to the right action and category", () => {
  const jacket = parseIntentDeterministic("That's better. Add a jacket.", context);
  assert.equal(jacket.requestedAction, "ADD_OUTER");
  assert.equal(jacket.targetCategory, "outer");

  const shoes = parseIntentDeterministic("Try sneakers instead.", context);
  assert.equal(shoes.requestedAction, "CHANGE_SHOES");
  assert.equal(shoes.targetCategory, "shoes");

  const bottom = parseIntentDeterministic("Can I see different trousers?", context);
  assert.equal(bottom.requestedAction, "CHANGE_BOTTOM");
  assert.equal(bottom.targetCategory, "lower_body");
});

test("finish and alternative intents are recognised", () => {
  assert.equal(parseIntentDeterministic("Finish the look.", context).requestedAction, "FINISH_LOOK");
  assert.equal(
    parseIntentDeterministic("Show me another option.", context).requestedAction,
    "SHOW_ALTERNATIVE",
  );
});

test("colour avoidance captures the colour and likes are recorded", () => {
  const avoided = parseIntentDeterministic("I don't like beige.", context);
  assert.deepEqual(avoided.avoidedColors, ["beige"]);

  const liked = parseIntentDeterministic("I love it.", { ...context, lookCount: 1 });
  assert.equal(liked.feedbackOnCurrent, "liked");
});

test("budget is extracted from natural language", () => {
  assert.equal(parseIntentDeterministic("Keep it under $120 please.", context).budget, 120);
});

test("Spanish input is understood and answered in Spanish", () => {
  const intent = parseIntentDeterministic("Demasiado formal, ¿algo más casual?", context);
  assert.equal(intent.feedbackOnCurrent, "rejected");
  assert.match(intent.assistantReply, /[áéíóúñ¿¡]|entendido/i);
});
