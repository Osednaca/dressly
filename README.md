# Dressly

**Agentic AI personal stylist + YouCam virtual try-on.**
Built for the **YouCam API Skin AI & eCommerce Hackathon**.

> Don't browse hundreds of products. Tell Dressly where you're going, what you want, or how
> you want to feel, and let the AI stylist build and visually try the outfit for you.

Dressly is not a chat wrapper. It observes session state, evaluates explicit alternatives,
decides, calls a tool, sees the result, adapts to feedback, and drives the session to a
completed outfit:

```
describe → understand → filter (code) → decide (JEV) → try on (YouCam) → show → feedback → repeat → finish
```

## Quick start

```bash
npm install
npm run gen:catalog     # one-time: generates the deterministic catalog imagery
cp .env.example .env.local   # then fill in your keys
npm run dev
```

Open http://localhost:3000.

### Running without credentials

Set `DRESSLY_MOCK_EXTERNAL_APIS=true` in `.env.local`. The app runs fully offline: Gemini and
JEV fall back to deterministic parsers, and YouCam is replaced by a **visibly watermarked**
simulation. This is for development only — mock results are never acceptable for a judged demo,
and the UI banner says so.

To rehearse the demo with real providers but a preloaded brief, use `DRESSLY_DEMO_MODE=true`
instead. That still makes real provider calls.

## Required keys

| Provider | Role | Env var |
| --- | --- | --- |
| YouCam (Perfect Corp) | Core virtual try-on — every worn visual | `YOUCAM_API_KEY` |
| JEV (TypeSafe System One) | Decision engine | `TYPESAFE_API_KEY` |
| Gemini | Language understanding | `GEMINI_API_KEY` |
| Runway | Optional P2 animation | `RUNWAY_API_KEY`, `RUNWAY_ENABLED` |

YouCam is never replaced by another image generator: no other provider produces a garment
worn by the user. With no YouCam key and mock mode off, Dressly fails closed with an explicit
error rather than fabricating an image.

## The demo

See [`docs/DEMO.md`](docs/DEMO.md) for the scripted flow and the expected behaviour at each
step.

## Architecture

```
app/          Next.js App Router — pages and API routes (HTTP only)
components/   Presentation — no provider knowledge
lib/agent/    The agent loop: plan → decide → act
lib/session/  Pure reducer + server store with disk mirror
lib/catalog/  Deterministic filtering and scoring
services/     Provider adapters: youcam, jev, gemini, runway (+ mocks/fallbacks)
```

Two ideas carry the project:

1. **Chained try-on.** Each garment is applied on top of the *previous* result, not the original
   photo, so the outfit evolves as one continuous look.
2. **Deterministic first, AI second.** Filtering, budgets, totals, category mapping and state
   transitions are plain code. Gemini understands language; JEV judges between explicit
   alternatives. No AI call ever sees the whole catalog.

Full design rationale: [`docs/PROJECT.md`](docs/PROJECT.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Deterministic behaviour tests (`node --test`) |
| `npm run gen:catalog` | Regenerate `public/catalog/` (35 flat-lay renders) |

Tests load the TypeScript source directly under Node's native type stripping via
`scripts/register.mjs`, a tiny resolver for the `@/` alias. No test framework dependency.

## Reliability

Every provider has a defined, visible degradation path: Gemini falls back to a keyword parser,
JEV to deterministic metadata ranking (records are marked `fallback`), YouCam fails closed with
a retry. Requests have hard deadlines and bounded retries; 4xx is never retried.
