# Feature: Dressly — agentic AI personal stylist + YouCam virtual try-on

Hackathon: **YouCam API Skin AI & eCommerce Hackathon**
Status: **IN PROGRESS**

## Product thesis

> Don't browse hundreds of products. Tell Dressly where you're going, what you want, or how
> you want to feel, and let the AI stylist build and visually try the outfit for you.

Core claim to demonstrate: the AI is not generating chat. It observes state, evaluates explicit
alternatives, decides, calls tools, sees results, adapts to feedback, and drives the session to a
completed outfit.

## Authorized scope

Owner authorized full P0 implementation, then P1, then P2 only after P0 is reliable.
No push, no PR, no merge, no deployment without explicit instruction.

## Provider decisions (owner-selected)

| Provider | Role | Credential route | Env var |
| --- | --- | --- | --- |
| YouCam (Perfect Corp) | **Core VTO engine** — every worn visual | Official REST, owner pastes key | `YOUCAM_API_KEY` |
| JEV (TypeSafe System One) | **Decision engine** | Direct endpoint `https://api.typesafe.ai/v1/systemone` | `TYPESAFE_API_KEY` |
| Gemini | Language + multimodal understanding | Direct official API (`@google/genai`) | `GEMINI_API_KEY` |
| Runway | Optional final animation (P2) | Official API | `RUNWAY_API_KEY` |

Verified during exploration:
- Vercel AI Gateway key present on machine works for `google/gemini-2.5-flash` but **rejects**
  `typesafe-ai/jev` on the free tier -> gateway is NOT the JEV route; owner selected direct TypeSafe.
- No YouCam credential exists yet; mock mode is dev-only and must never back a recorded demo.

## Verified YouCam API contract (from official docs, not assumed)

Host: `https://yce-api-01.makeupar.com` — `Authorization: Bearer <key>`

1. `POST /s2s/v2.0/file` body `{files:[{content_type,file_name,file_size}]}`
   -> `data.files[0].file_id`, `data.files[0].requests[0].{method,url,headers}`
2. `PUT` raw bytes to that presigned url with the returned headers.
3. `POST /s2s/v2.0/task/cloth-v4`
   body `{src_file_id|src_file_url, ref_file_id|ref_file_url|template_id, garment_category,
   change_shoes?, filter_multi_person?}`
   -> `data.task_id`
4. `GET /s2s/v2.0/task/cloth-v4/{task_id}` -> `data.task_status`, `data.results.url`, `data.error`

`garment_category` enum: `full_body | lower_body | upper_body | shoes | auto | outer`
`filter_multi_person`: `off | normal | strict` (default `off`) — Dressly uses `normal`.
`change_shoes`: effective when category is `full_body` or `lower_body` (default `true`).

## Key architectural decisions

1. **Chained VTO (the agentic core).** Each new garment is applied on top of the *previous*
   try-on result, not the original photo: `src = previous result`, `ref = new garment`,
   `garment_category` derived from the garment. This is how iterative outfit building stays
   coherent and is faithful to the documented API.
2. **Two-stage JEV.** Stage 1 = `choice` over candidate *actions*; Stage 2 = `choice` over
   filtered *product ids*. Style classification is a third `choice` yielding the probability
   distribution shown in the Agent Decisions panel.
3. **Deterministic first, AI second.** Filtering, rejected-id exclusion, budget, totals, category
   mapping and state transitions are plain code. Gemini only understands language; JEV only
   judges between explicit alternatives.
4. **Server owns state.** Session lives server-side keyed by id, mirrored to disk; generated
   images persist to disk. Client is a thin, observable view.
5. **Mock mode is dev-only** and visibly flagged in the UI. Real providers are the default.

## Tasks

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| T1 | Scaffold Next.js 16 + TS + Tailwind 4; design tokens, fonts, layout shell | DONE | `app/layout.tsx`, `app/globals.css` (@theme tokens), `app/page.tsx`; build passes |
| T2 | Catalog: 30+ products, full metadata, YouCam category mapping | DONE | `lib/catalog/products.ts` — 35 products |
| T3 | Catalog imagery pipeline (VTO-compatible garment images) | DONE | `scripts/gen-catalog-images.ts` → `public/catalog/*.png` (35 PNGs) |
| T4 | Domain types + `StylingSession` + deterministic reducer | DONE | `lib/types.ts`, `lib/session/reducer.ts`, `lib/session/store.ts`, `lib/catalog/query.ts`, `lib/catalog/occasion.ts` |
| T5 | Provider services: YouCam, JEV, Gemini, Runway + mock layer | DONE | `services/youcam/*`, `services/jev/*`, `services/gemini/*`, `services/runway/*`, `services/contracts.ts` |
| T6 | Agent core: candidate builder, JEV action + product eval, orchestrator | DONE | `lib/agent/plan.ts`, `lib/agent/orchestrator.ts`, `lib/agent/tryon.ts`, `lib/agent/jobs.ts`, `lib/agent/runway.ts` |
| T7 | API routes: orchestrate, tryon submit/poll, media, runway | DONE | `app/api/**` — sessions, photo, chat, jobs, retry, media, providers, finish, feedback, restore, clear-rejections, runway |
| T8 | UI: onboarding (photo upload + "what are you dressing for") | DONE | `components/Onboarding.tsx` |
| T9 | UI: fitting room viewer, before/after, loading steps | DONE | `components/FittingRoom.tsx`, `components/BeforeAfter.tsx`, `components/LoadingSteps.tsx` |
| T10 | UI: stylist chat panel, suggested actions, voice input | DONE | `components/ChatPanel.tsx` (Web Speech API, graceful fallback) |
| T11 | UI: Agent Decisions panel (collapsible, structured only) | DONE | `components/DecisionsPanel.tsx` |
| T12 | UI: look history strip (restore / like / reject) | DONE | `components/LookHistory.tsx` + feedback/restore routes |
| T13 | UI: final look screen, cart, analytics summary | DONE | `components/FinalLook.tsx`, `components/ProductCard.tsx` |
| T14 | Reliability: fallbacks, timeout, retry, explicit errors | DONE | `lib/util/http.ts`, provider fallbacks, job retry route, explicit blocked states |
| T15 | P2: Runway "Bring this look to life" behind feature flag | DONE | `services/runway/*`, `lib/agent/runway.ts`, `POST /api/sessions/[id]/runway`, flag-gated UI |
| T16 | Lightweight tests for critical deterministic behavior | DONE | `tests/*.test.ts` — 32 tests, `npm test` green |
| T17 | README, env example, demo script | DONE | `README.md`, `.env.example`, `docs/DEMO.md` |
| T18 | Final verification: build, typecheck, lint, demo rehearsal | DONE | `tsc --noEmit` clean, `next build` clean, 32/32 tests, end-to-end smoke in mock mode |

## Verification evidence

- `npm run typecheck` → no errors.
- `npm test` → 32 tests, 32 pass, 0 fail.
- `npm run build` → compiled successfully; 15 routes (1 static page + API routes).
- End-to-end smoke (mock mode, no credentials): create session → upload photo → "rooftop dinner,
  elegant but not too formal" → **CHANGE_TOP / Linen Resort Shirt** → mock try-on success → "too
  formal" → rejection restarts the chain from the original photo → "add a jacket" chains onto the
  previous result → "finish the look" → **COMPLETED**, cart total computed.
- Chained try-on verified: Look 2 `previousImagePath` = Look 1 result for an additive turn, and =
  the original photo after a rejection.


## Commit log

_See `git log` on `feat/dressly-mvp`. Work is committed as reviewable work units (toolchain +
imagery, agent core, API, UI, tests, docs). No push, PR, merge or deployment was performed._

## Known limitations / open items

- **Credentials are still absent.** Real provider paths are fully implemented and gated; the
  end-to-end run above was verified in mock mode. Supply `YOUCAM_API_KEY`, `TYPESAFE_API_KEY` and
  `GEMINI_API_KEY` in `.env.local` to exercise the live path.
- Engram memory is NOT installed in this environment (`engram` binary missing), so the ODD memory
  mirror cannot be created. The file-based task document is the single source of truth. Mirror
  status: **pending**.
- Catalog imagery is a deterministic flat-lay render set, not photography. The pipeline is
  isolated in `scripts/gen-catalog-images.ts` and swappable without touching the engine.
- `@typesafe-ai/sdk@0.6.0` install is complete and typechecks; the live JEV call is unexercised
  without a key.
- Jobs are memory-only by design (short-lived, single process); a server restart drops an
  in-flight try-on, which surfaces as a retryable failure.
