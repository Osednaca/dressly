import assert from "node:assert/strict";
import test from "node:test";
import { getProduct } from "@/lib/catalog/products";
import {
  applyIntent,
  createSessionRecord,
  placeProduct,
  recordLook,
  restoreLook,
  setLookFeedback,
} from "@/lib/session/reducer";
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

function withLook(): { session: StylingSession; topId: string } {
  const top = getProduct("top_001")!;
  let session = createSessionRecord("ses_test", "/api/media/uploads/photo.png");
  session = placeProduct(session, top);
  session = recordLook(session, {
    id: "look_1",
    imagePath: "/api/media/results/look_1.png",
    previousImagePath: "/api/media/uploads/photo.png",
    items: session.currentLook,
    addedProductId: top.id,
    feedback: "pending",
    label: "Look 1",
  });
  return { session, topId: top.id };
}

test("applyIntent folds styles additively and removes avoided ones", () => {
  let session = createSessionRecord("ses_a", null);
  session = applyIntent(session, emptyIntent({ desiredStyles: ["evening", "smart_casual"] }));
  session = applyIntent(session, emptyIntent({ avoidedStyles: ["evening"] }));
  assert.deepEqual(session.targetStyles, ["smart_casual"]);
  assert.deepEqual(session.avoidedStyles, ["evening"]);
});

test("applyIntent never keeps a colour that was later avoided", () => {
  let session = createSessionRecord("ses_b", null);
  session = applyIntent(session, emptyIntent({ preferredColors: ["beige"] }));
  session = applyIntent(session, emptyIntent({ avoidedColors: ["beige"] }));
  assert.deepEqual(session.preferredColors, []);
  assert.deepEqual(session.avoidedColors, ["beige"]);
});

test("rejecting the active look removes the garment and records the rejection", () => {
  const { session, topId } = withLook();
  const next = applyIntent(session, emptyIntent({ feedbackOnCurrent: "rejected" }));
  assert.equal(next.currentLook.top, undefined);
  assert.ok(next.rejectedProducts.includes(topId));
  assert.equal(next.looks[0]?.feedback, "rejected");
  assert.equal(next.status, "REFINING");
  // The chain restarts from the original photo, so the rejected render is never reused.
  assert.equal(next.activeLookId, null);
});

test("rejecting a chained look restarts from the previous image, not the rejected one", () => {
  const top = getProduct("top_001")!;
  const bottom = getProduct("bottom_001")!;
  let session = createSessionRecord("ses_chain", "/api/media/uploads/p.png");
  session = placeProduct(session, top);
  session = recordLook(session, {
    id: "look_1",
    imagePath: "/api/media/results/l1.png",
    previousImagePath: "/api/media/uploads/p.png",
    items: session.currentLook,
    addedProductId: top.id,
    feedback: "pending",
    label: "Look 1",
  });
  session = placeProduct(session, bottom);
  session = recordLook(session, {
    id: "look_2",
    imagePath: "/api/media/results/l2.png",
    previousImagePath: "/api/media/results/l1.png",
    items: session.currentLook,
    addedProductId: bottom.id,
    feedback: "pending",
    label: "Look 2",
  });
  const next = applyIntent(session, emptyIntent({ feedbackOnCurrent: "rejected" }));
  assert.equal(next.activeLookId, "look_1");
  assert.equal(next.currentLook.bottom, undefined);
  assert.equal(next.currentLook.top?.id, top.id);
});

test("liking a look records the garment as liked", () => {
  const { session, topId } = withLook();
  const next = applyIntent(session, emptyIntent({ feedbackOnCurrent: "liked" }));
  assert.ok(next.likedProducts.includes(topId));
  assert.equal(next.looks[0]?.feedback, "liked");
});

test("placeProduct replaces the slot it belongs to", () => {
  const topA = getProduct("top_001")!;
  const topB = getProduct("top_002")!;
  let session = createSessionRecord("ses_c", null);
  session = placeProduct(session, topA);
  session = placeProduct(session, topB);
  assert.equal(session.currentLook.top?.id, topB.id);
  assert.ok(session.triedProducts.includes(topA.id));
  assert.ok(session.triedProducts.includes(topB.id));
});

test("restoreLook puts a previous outfit back on the body", () => {
  const { session } = withLook();
  const withSecond = placeProduct(session, getProduct("bottom_001")!);
  const restored = restoreLook(withSecond, session.looks[0]!.id);
  assert.equal(restored.currentLook.top?.id, "top_001");
  assert.equal(restored.currentLook.bottom, undefined);
  assert.equal(restored.activeLookId, "look_1");
});

test("setLookFeedback updates the like/reject sets from the history strip", () => {
  const { session, topId } = withLook();
  const liked = setLookFeedback(session, "look_1", "liked");
  assert.ok(liked.likedProducts.includes(topId));
  const rejected = setLookFeedback(liked, "look_1", "rejected");
  assert.ok(rejected.rejectedProducts.includes(topId));
  assert.ok(!rejected.likedProducts.includes(topId));
});
