# Feature: Dressly — agentic AI personal stylist + YouCam virtual try-on

Hackathon: **YouCam API Skin AI & eCommerce Hackathon**
Status: **P0/P1/P2 COMPLETE + SHADERS VISUAL REDESIGN** — build, typecheck, 32 tests green; live
Gemini 3.8 / JEV / YouCam verified end to end.

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

## Visual redesign — Shaders integration

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| V1 | Install and verify the official `shaders` package in Next 16 | DONE | `shaders@4.0.0`; `next build` clean with `shaders/react` |
| V2 | Central visual config + capability hooks | DONE | `lib/visual/config.ts`, `lib/visual/hooks.ts` |
| V3 | Dark "midnight atelier" design tokens | DONE | `app/globals.css` — semantic + legacy tokens, glass utilities |
| V4 | Ambient environment (global / hero / cinematic) | DONE | `components/shaders/DresslyAmbient.tsx` |
| V5 | Styling-state shader tied to progress | DONE | `components/shaders/DresslyLoadingShader.tsx` |
| V6 | Outfit transition (ripple wipe between results) | DONE | `components/shaders/LookStage.tsx` |
| V7 | Glass panel + selection glow | DONE | `components/shaders/DresslyGlass.tsx`, `DresslyGlow.tsx` |
| V8 | Integrate across onboarding, fitting room, chat, decisions, final look | DONE | `Onboarding.tsx`, `FittingRoom.tsx`, `ChatPanel.tsx`, `DecisionsPanel.tsx`, `FinalLook.tsx`, `Masthead.tsx`, `ProviderBanner.tsx`, `ProductCard.tsx` |
| V9 | WebGPU fallback + reduced-motion + mobile degradation | DONE | capability gate in `lib/visual/hooks.ts`; CSS gradients in `config.ts`; `prefers-reduced-motion` in `globals.css` |
| V10 | Fix live Gemini model (`gemini-2.5-flash` retired) | DONE | `lib/env.ts` default → `gemini-3.8-flash`; verified live |

## Verification evidence

- `npm run typecheck` → no errors.
- `npm test` → 32 tests, 32 pass, 0 fail (unchanged — no backend/AI logic touched).
- `npm run build` → compiled successfully; 15 routes.
- End-to-end smoke (mock mode): full loop verified (see commit history).
- **Live provider run (real keys in `.env.local`):** Gemini `gemini-3.8-flash` → live,
  JEV `jev-1.13.0` → live, YouCam → live. A real try-on produced
  `data/results/look_*.jpg`. Understanding parsed by Gemini (not fallback) after the model fix.
- Visual integration verified by build + SSR render of the redesigned dark onboarding
  (`chrome-text`, `glass-strong`, ambient fallback present; no server errors).

## Commit log

_See `git log` on `feat/dressly-mvp`. Work is committed as reviewable work units (toolchain +
imagery, agent core, API, UI, tests, docs, and the Shaders visual system). No push, PR, merge or
deployment was performed._

## Known limitations / open items

- **Credentials are present in `.env.local`** (gitignored): live Gemini, JEV and YouCam verified.
  `.env.local` is not committed.
- The live JEV action for the opening brief is `SHOW_ALTERNATIVE` (a valid "show me an option"
  decision); it still produces the Linen Resort Shirt look via the effective-action mapping.
- Engram memory is NOT installed in this environment (`engram` binary missing), so the ODD memory
  mirror cannot be created. The file-based task document is the single source of truth. Mirror
  status: **pending**.
- Catalog imagery is a deterministic flat-lay render set, not photography. The pipeline is
  isolated in `scripts/gen-catalog-images.ts` and swappable without touching the engine.
- GPU shader output cannot be visually asserted in this headless environment; correctness relies on
  the library contract, the build, and the CSS fallback path. A browser pass is recommended before
  recording.
- Jobs are memory-only by design (short-lived, single process); a server restart drops an
  in-flight try-on, which surfaces as a retryable failure.
