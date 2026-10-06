import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG, getProduct } from "@/lib/catalog/products";
import {
  bestByMetadata,
  candidateProducts,
  eligibleProducts,
  lookTotal,
} from "@/lib/catalog/query";
import { inferOccasions } from "@/lib/catalog/occasion";
import { createSessionRecord, placeProduct, recompute } from "@/lib/session/reducer";

test("catalog stays at 35 products with valid YouCam categories", () => {
  assert.equal(CATALOG.length, 35);
  for (const product of CATALOG) {
    if (product.category === "accessory") {
      assert.equal(product.vtoCategory, null);
    } else {
      assert.notEqual(product.vtoCategory, null);
    }
  }
});

test("occasion inference maps free text to catalog tags", () => {
  assert.ok(inferOccasions("rooftop dinner").includes("dinner"));
  assert.ok(inferOccasions("a day at the office").includes("work"));
  assert.deepEqual(inferOccasions(""), ["everyday"]);
});

test("eligibleProducts excludes rejected and already-worn garments", () => {
  let session = createSessionRecord("ses_q", null);
  session = placeProduct(session, getProduct("top_001")!);
  session = recompute({ ...session, rejectedProducts: ["top_002"] });
  const eligible = eligibleProducts("upper_body", session).map((p) => p.id);
  assert.ok(!eligible.includes("top_001"));
  assert.ok(!eligible.includes("top_002"));
  assert.ok(eligible.includes("top_003"));
});

test("candidateProducts is deterministic and never leaks the whole category", () => {
  const session = createSessionRecord("ses_r", null);
  const first = candidateProducts("upper_body", session, 5);
  const second = candidateProducts("upper_body", session, 5);
  assert.deepEqual(
    first.map((c) => c.product.id),
    second.map((c) => c.product.id),
  );
  assert.ok(first.length <= 5);
});

test("budget filtering keeps results within a sane window", () => {
  const session = recompute({ ...createSessionRecord("ses_s", null), budget: 60 });
  const candidates = candidateProducts("upper_body", session, 5);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((c) => c.product.price <= 60 * 1.35));
});

test("lookTotal sums every worn piece", () => {
  let session = createSessionRecord("ses_t", null);
  session = placeProduct(session, getProduct("top_001")!);
  session = placeProduct(session, getProduct("bottom_001")!);
  assert.equal(lookTotal(session.currentLook), 64 + 78);
});

test("bestByMetadata returns the top deterministic candidate", () => {
  const session = createSessionRecord("ses_u", null);
  const best = bestByMetadata("upper_body", session);
  const ranked = candidateProducts("upper_body", session, 5);
  assert.equal(best?.product.id, ranked[0]?.product.id);
});
