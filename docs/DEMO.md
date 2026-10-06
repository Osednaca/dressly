# Dressly — demo script

The scenario below is the one the application is built to support reliably. It is written for a
real run (YouCam + JEV + Gemini keys present). When a key is missing, the deterministic fallbacks
produce the same *shape* of behaviour and the Agent Decisions panel labels the record `fallback`.

Before you start: `npm run dev`, open the app, and confirm the provider banner shows the providers
you expect. If it says **Simulation**, mock mode is on — do not record or judge that run.

---

## 1. Onboarding

- Upload a **full-body, well-lit photo**.
- In the brief, type:

  > I have a rooftop dinner tonight. Build me something elegant but not too formal.

- Press **Begin styling**.

**What to point out:** the photo is used only for try-on; it is never sent to the language model.
The deterministic occasion inference maps "rooftop dinner" to the `dinner` tag, and "not too
formal" lowers formality without rejecting the current look.

## 2. First look

Dressly extracts the intent, folds it into session state, filters the catalog, and lets JEV choose
both the next action and the garment. YouCam generates the try-on **from your photo**.

Expected: **CHANGE_TOP → Linen Resort Shirt** (or another smart-casual top), rendered on your photo.
The Fitting Room shows a drag-to-compare **Original / Dressly** view.

## 3. Feedback loop — "too formal"

Type:

> That's too formal.

Expected: the top is removed from the body and marked rejected, the formal preference is lowered,
JEV re-evaluates the remaining alternatives, and a new real YouCam result appears. The rejected
garment now scores to zero in future turns.

## 4. Add a layer

Type:

> That's better. Add a jacket.

Expected: **ADD_OUTER** → a compatible outer layer, applied **on top of the previous result** — the
chained try-on. The before/after still compares against the original photo.

## 5. Shoes

Type:

> Try sneakers instead.

Expected: **CHANGE_SHOES** → footwear replaced and visualised.

## 6. Finish

Type:

> Perfect.

Expected: **FINISH_LOOK** → **Your Dressly Look**: the final image, every product with name,
category and price, the total, and **Add complete look to cart** (simulated).

The value summary reads something like:

```
18 compatible pieces → 4 virtual try-ons → 1 final outfit
```

## 7. The Agent Decisions panel

Open it during any turn. It shows **only structured, safe material** — never raw chain-of-thought:

```
USER INTENT          Rooftop dinner · Elegant · Not too formal
STYLE EVALUATION     Smart Casual 0.72 · Evening 0.18 · Casual 0.08 · Formal 0.02
CURRENT ACTION       CHANGE_TOP
PRODUCT EVALUATION   Linen Resort Shirt 0.84 · Knitted Polo 0.79 · Oxford Shirt 0.52
SELECTED             Linen Resort Shirt
WHY                  "A fresh top — Linen Resort Shirt lands closest to the brief for dinner."
```

The badge on the panel states which engine produced the decision (`JEV` or `deterministic
fallback`) so a fallback is never hidden.

## 8. Optional — P2 animation

With `RUNWAY_ENABLED=true` and a key, **Bring this look to life** animates the finished look. It is
strictly additive: it can never change the outfit, and its failure never affects the final look.

---

## Failure behaviour to show (optional)

- Delete `YOUCAM_API_KEY` (keep mock mode off) and start a try-on: Dressly **fails closed** with an
  explicit error and preserves the previous image. It never substitutes another image generator.
- Point `TYPESAFE_API_URL` at an unreachable host: JEV degrades to deterministic ranking, the
  session keeps moving, and the panel records `fallback`.
- Turn on `DRESSLY_MOCK_EXTERNAL_APIS=true`: the banner warns, and every try-on is watermarked
  `MOCK RESULT` with the env var name printed on it.
