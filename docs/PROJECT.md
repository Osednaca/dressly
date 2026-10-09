# Dressly — Project Document

**Agentic AI personal stylist and virtual try-on experience.**
Built for the **YouCam API Skin AI & eCommerce Hackathon**.

> Don't browse hundreds of products. Tell Dressly where you're going, what you want, or how you
> want to feel, and let the AI stylist build and visually try the outfit for you.

- **Status:** P0 complete and verified (build, typecheck, 32 tests, end-to-end smoke in mock mode);
  P1 and P2 implemented. Live provider calls await credentials.
- **Branch:** `feat/dressly-mvp`
- **Last updated:** 2026-10-06

---

## 1. The product

### The problem

Traditional online fashion shopping asks the shopper to do the hard work:

```
Browse → open product → imagine how it looks → go back → browse again
```

The shopper is the one deciding *what is worth trying*, using nothing but flat product photography
and hope. Return rates in fashion are the direct cost of that guesswork.

### The thesis

```
Describe what you need → AI selects → you wear it virtually → you give feedback → AI adapts → buy the look
```

> Traditional virtual try-on asks the shopper to decide what to try.
> **Dressly decides what is worth trying.**

Dressly turns product discovery, recommendation, virtual try-on, refinement and purchase intent
into a single conversational experience.

### What makes it agentic (and not a chat wrapper)

This is the claim the demo has to prove: the AI is not generating chat responses. It observes
state, evaluates explicit alternatives, makes a decision, calls a tool, sees the result, adapts,
and moves the session toward a completed outfit.

```
USER "rooftop dinner, elegant but not too formal"
  ↓
GEMINI       extract intent: occasion, styles, constraints
  ↓
SESSION      fold intent into explicit, observable state
  ↓
CANDIDATES   deterministic hard filters + metadata ranking → 3-6 products
  ↓
JEV          evaluate explicit alternatives → action + product + style distribution
  ↓
YOUCAM       chained virtual try-on on top of the previous result
  ↓
UI           show the look, the scores and the reasoning
  ↓
USER "too formal"
  ↓
GEMINI → STATE UPDATE → JEV → YOUCAM → repeat
  ↓
FINISH_LOOK  final outfit, products, total, cart
```

The loop is the product. Everything else is in service of it.

---

## 2. MVP definition

### Scope — P0, absolutely required

| # | Requirement | State |
| --- | --- | --- |
| 1 | Polished Next.js UI (editorial, fashion-oriented, not SaaS) | Not started |
| 2 | Photo upload | Not started |
| 3 | Fashion catalog with rich metadata | Data complete |
| 4 | Gemini intent parsing | Service complete |
| 5 | JEV decisions (action + product + style) | Service complete |
| 6 | YouCam Clothes VTO, full async lifecycle | Service complete |
| 7 | Iterative feedback loop | Not started |
| 8 | Explicit, observable session state | Core complete |
| 9 | Multiple try-on iterations | Not started |
| 10 | Final outfit screen | Not started |
| 11 | Simulated cart | Not started |
| 12 | Agent Decisions panel | Not started |
| 13 | Robust loading and error states | Not started |

### P1 — highly desirable

Voice input · outerwear · shoes · before/after comparison · look history strip.

### P2 — only after P0 is reliable

Runway "Bring this look to life" animation · accessories in VTO · sharing · extra polish.

### Definition of done

A user can: open the app → upload a photo → say what they are dressing for → receive an
automatically selected garment → see themselves wearing it via YouCam → give natural-language
feedback → watch JEV choose a new action and product → receive another **real** YouCam result →
iteratively build an outfit → inspect the agent's structured decisions → finalize → see every
product and the total → optionally animate the look with Runway.

---

## 3. Stack

Deliberately small. This is a hackathon submission, not an enterprise architecture demo.

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16.3.8** (App Router) | Server routes keep provider credentials off the client |
| Language | **TypeScript 5.9.3**, `strict` + `noUncheckedIndexedAccess` | The domain contract is the design |
| UI runtime | **React 19.2.0** | Ships with Next 16 |
| Styling | **Tailwind CSS 4.3.3** (`@tailwindcss/postcss`) | CSS-first config, no `tailwind.config.js` |
| Visual effects | **Shaders 4.0.0** (WebGPU, MIT) | Ambient depth, glass, transitions — always with a CSS fallback |
| Decisions | **JEV / TypeSafe System One** via `@typesafe-ai/sdk@0.6.0` | The mandated decision engine |
| Language | **Gemini** via REST `generateContent` | No SDK weight; version-tolerant structured output |
| Try-on | **YouCam / Perfect Corp** `cloth-v4` via REST | The mandated core VTO engine |
| Animation | **Runway** `gen4_turbo` (P2, flag-gated) | Optional final presentation layer |
| Persistence | JSON files under `data/` + in-process Map | One process, no database, no auth |
| Tests | `node --test` + native type stripping | No test framework dependency |

**Explicitly rejected:** Laravel, Flutter, microservices, Kafka, event buses, multiple databases,
authentication infrastructure, ORMs, state-management libraries.

### Dependencies

```json
"dependencies": {
  "@typesafe-ai/sdk": "0.6.0",
  "next": "16.3.8",
  "react": "19.2.0",
  "react-dom": "19.2.0",
  "shaders": "4.0.0"
}
```

Everything else is a devDependency (TypeScript, Tailwind, `@types/*`). YouCam, Gemini and Runway
are called over plain `fetch`; only JEV uses an official SDK, because its request/response
contract is the least forgiving and the SDK is the sanctioned integration route.

---

## 4. Architecture

### Layer separation

```
┌──────────────────────────────────────────────────────────────┐
│  app/                       Next.js App Router               │
│  pages + API routes. Owns HTTP, uploads, polling, SSE-free   │
│  job status. Never talks to a provider directly.             │
├──────────────────────────────────────────────────────────────┤
│  components/                Presentation only                │
│  Fitting room viewer, chat panel, decisions panel, history,  │
│  final look, cart. No provider knowledge.                    │
├──────────────────────────────────────────────────────────────┤
│  lib/agent/                 The agent loop                   │
│  candidate builder → JEV evaluation → action execution →     │
│  session update. Orchestration and nothing else.             │
├──────────────────────────────────────────────────────────────┤
│  lib/session/               State                            │
│  Pure reducer + server store with disk mirror and            │
│  per-session write lock.                                     │
├──────────────────────────────────────────────────────────────┤
│  lib/catalog/               Deterministic reasoning          │
│  Hard filters, metadata scoring, occasion inference.         │
├──────────────────────────────────────────────────────────────┤
│  services/                  Provider adapters                │
│  youcam/  jev/  gemini/  runway/                             │
│  Each is a thin, honest translation of one external          │
│  contract, plus a mock and a fallback where required.        │
└──────────────────────────────────────────────────────────────┘
```

### Deterministic code vs AI

This split is the architectural spine of the project. Asking a language model to do arithmetic is
how agentic demos become unreliable.

| Use plain code for | Use AI for |
| --- | --- |
| Category mapping to YouCam's enum | Understanding a free-form request |
| Excluding rejected product ids | Interpreting vague feedback ("too formal") |
| Budget filtering and cart totals | Choosing between explicit style alternatives |
| Candidate shortlisting (3–6 items) | Choosing between explicit product candidates |
| Session state transitions | Choosing the next agent action |
| Occasion keyword → catalog tag | Short, user-safe explanation phrasing |
| Compatible-product counts | — |

**No AI call ever sees the whole catalog.** Filtering happens first, in code.

### The chained try-on decision

The single most important product decision in the codebase:

> Each new garment is applied **on top of the previous try-on result**, not on the original photo.

```
photo → [YouCam + top] → result1 → [YouCam + bottom] → result2 → [YouCam + outer] → result3
```

This is what makes iterative outfit building coherent: the shopper watches one continuous look
evolve, rather than seeing unrelated single-garment renders. It is also faithful to the documented
YouCam API, which takes a source image and a garment reference image.

---

## 5. Provider contracts

### YouCam — the core try-on engine

**Verified against official documentation, not assumed.**

- Host: `https://yce-api-01.makeupar.com`, header `Authorization: Bearer <key>`

| Step | Call |
| --- | --- |
| 1 | `POST /s2s/v2.0/file` — body `{files:[{content_type,file_name,file_size}]}` → `data.files[0].file_id` + `data.files[0].requests[0].{method,url,headers}` |
| 2 | `PUT <presigned url>` — raw bytes with the returned headers |
| 3 | `POST /s2s/v2.0/task/cloth-v4` — body `{src_file_id, ref_file_id, garment_category, change_shoes?, filter_multi_person?}` → `data.task_id` |
| 4 | `GET /s2s/v2.0/task/cloth-v4/{task_id}` — `data.task_status`, `data.results.url`, `data.error` |

- `garment_category` enum: `full_body | lower_body | upper_body | shoes | auto | outer`
- `filter_multi_person`: `off | normal | strict` — Dressly uses `normal` (ignores obvious
  bystanders without the false rejections `strict` produces on phone photos)
- `change_shoes`: only honoured for `full_body` and `lower_body`, so it is only sent for those

Status normalization maps `queued|running|processing|*` → pending, `success|succeeded|done|completed`
→ success, `error|failed|failure` → failed. Results are downloaded and re-hosted locally so an
expiring signed URL can never break the look history.

**Rule: YouCam is never replaced by another image generator.** No other provider produces a
garment worn by the user.

### JEV — the decision engine

Uses the official `@typesafe-ai/sdk`, which posts to `POST /v1/systemone`. One request carries
three named `choice` questions:

| Question | Alternatives | Produces |
| --- | --- | --- |
| `style_profile` | the 8 style tags, each with its formality value | the probability distribution shown in the panel |
| `next_action` | the actions that are actually available in this state | the chosen action + confidence + distribution |
| `product_choice` | the 3–6 filtered catalog candidates, each described by its metadata | the chosen product id + distribution |

JEV is **not** used as a text classifier. It evaluates explicit, code-generated alternatives and
returns probabilities over them. Every answer is validated against the offered set; a choice
outside the offered set is treated as a contract violation, not as a decision.

### Gemini — language and multimodal understanding

`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with
`responseMimeType: "application/json"`, `temperature: 0.3`, and the required JSON shape stated in
the prompt. The response is parsed and **normalized locally** into `IntentDelta` — sentinel values
(`"NONE"`, `0`, `"none"`) become `undefined`, unknown enum values are dropped, colours are
lowercased.

Deliberate choice: **the user's photograph is never sent to Gemini.** It contains a person and adds
nothing to intent parsing. Only YouCam receives it. Structured output is validated by our own
normalizer rather than a provider-side JSON schema, which keeps the integration tolerant across
Gemini API versions.

### Gemini Live — the spoken stylist

The mic opens a real-time voice conversation (`gemini-3.8-live`, override with
`GEMINI_LIVE_MODEL`). `POST /api/sessions/{id}/live` mints a single-use **ephemeral token**
(`POST v1beta/auth_tokens` with `bidiGenerateContentSetup`) that locks the model, system
instruction, tools and transcription server-side; the browser then connects straight to
`BidiGenerateContentConstrained` and never holds the API key.

Live is only the voice. It has two tools: `style_request(message)` runs the normal chat turn
(intent → JEV → YouCam try-on) and `finish_look()` finishes the session. The tool returns as soon
as the try-on is submitted; when the job resolves, the browser sends a `[fitting room]` note so
the stylist can react. Audio: mic → AudioWorklet → 16 kHz PCM16 in, 24 kHz PCM16 out, with
barge-in. Typed messages during a live session go to the live stylist. Only microphone audio
is streamed to Gemini — the photo still goes only to YouCam.

### Runway — optional (P2)

Image-to-video via `POST /v1/image_to_video`, behind `RUNWAY_ENABLED`. `RUNWAY_MODEL` selects any
image-to-video model Runway hosts — including Google's **Gemini Omni Flash** (`gemini_omni_flash`
/ `gemini_omni_flash_1.1`) alongside Runway's own `gen4_turbo`, `veo3.1`, `seedance2` and others.
`RUNWAY_RATIO` and `RUNWAY_DURATION_SECONDS` must be values the chosen model accepts (for
`gemini_omni_flash_1.1`: `720:1280` or `1280:720`, 3–10s). Restrained prompt: natural confident
fashion movement, subtle body motion, realistic fabric movement, preserve person and outfit
exactly, cinematic fashion editorial. Never alters the outfit. Never critical to the demo.

---

## 6. Data model

The contract in `lib/types.ts` is the design. Everything the UI shows comes from it.

```ts
interface StylingSession {
  id: string;
  userPhotoPath: string | null;

  occasion?: string;
  targetStyles: StyleTag[];
  preferredColors: string[];
  avoidedStyles: StyleTag[];
  avoidedColors: string[];
  budget?: number;

  currentLook: { top?, bottom?, outer?, shoes?, accessories: Product[] };

  triedProducts: string[];
  rejectedProducts: string[];
  likedProducts: string[];

  looks: Look[];              // history strip, with local re-hosted images
  activeLookId: string | null;

  decisions: DecisionRecord[]; // what the Agent Decisions panel renders
  messages: ChatMessage[];
  metrics: SessionMetrics;

  conversationSummary: string;
  status: "DISCOVERY" | "STYLING" | "REFINING" | "COMPLETED";
}
```

Key supporting types:

- **`Product`** — `id, name, brand, category, subcategory, styles[], occasions[], colors[], price,
  image, vtoCategory, formality (0–1), warmth (0–1), description`. `formality` and `warmth` are
  numeric precisely so deterministic code can score cohesion without an AI call.
- **`IntentDelta`** — the language layer's entire output: styles, colours, budget,
  `requestedAction`, `feedbackOnCurrent` (`liked|rejected|closer`), `targetCategory`, a one-sentence
  `assistantReply`, and 2–4 short `interpreted` chips.
- **`DecisionRecord`** — one agent iteration: the intent, the style distribution, the action with
  its distribution, the product evaluation, the selected product, a short user-safe `reason`, and
  `provider: "jev" | "fallback"` so the panel never over-claims.
- **`Look`** — one generated try-on: `imagePath`, `previousImagePath` (for before/after),
  a snapshot of the outfit, the garment just added, feedback, and an index for "Look 1/2/3".

`CatalogCategory` (ours) and `YouCamGarmentCategory` (the provider's) are separate types on
purpose, so a provider change can never leak into the UI naming.

---

## 7. Catalog

`lib/catalog/products.ts` — **35 products**, all fictitious, richly tagged.

| Category | Count | Examples |
| --- | --- | --- |
| `upper_body` | 12 | Linen Resort Shirt, Oxford Dress Shirt, Knitted Polo, Silk Camisole Blouse |
| `lower_body` | 8 | Tailored Black Trousers, Straight-Leg Denim, Pleated Wide Trousers, Midi A-Line Skirt |
| `outer` | 6 | Lightweight Bomber, Tailored Wool Blazer, Unlined Linen Overshirt, Longline Trench |
| `shoes` | 6 | Minimal Leather Sneakers, Leather Derby, Suede Chelsea Boots, Canvas Slip-Ons |
| `accessory` | 3 | Structured Leather Tote, Silk Neck Scarf, Minimal Leather Belt |

Every garment carries `vtoCategory` for YouCam; accessories carry `null` and are catalog-only
(they appear in the final look and the cart, never as a try-on reference image).

### Product-selection strategy

The catalog is never passed blindly to a model:

```
category match
  ↓  availability (vtoCategory != null for try-on categories)
  ↓  exclude rejected ids
  ↓  exclude items already worn
  ↓  budget window
  ↓  deterministic metadata scoring
  ↓  top 3–6 candidates  →  JEV
```

Scoring weights (`SCORE_WEIGHTS` in `lib/catalog/query.ts`):

| Signal | Weight | Meaning |
| --- | --- | --- |
| `occasionFit` | 0.28 | product occasion tags vs. inferred occasion |
| `styleFit` | 0.26 | target styles, with a hard penalty for avoided styles |
| `colorCompatibility` | 0.16 | preferred colours boost, avoided colours collapse |
| `userPreferenceFit` | 0.12 | affinity learned from liked garments |
| `cohesion` | 0.12 | formality distance and colour harmony with what is already worn |
| `budgetFit` | 0.06 | price against the stated budget |

Ties break on `id`, so identical state always produces an identical shortlist — the agent is
reproducible and debuggable.

---

## 8. Reliability model

The demo must not die because one provider had a bad minute. Every provider has a defined
degradation path, and every degradation is **visible** rather than silent.

| Failure | Behaviour |
| --- | --- |
| **Gemini** fails or key missing | Deterministic keyword parser (`services/gemini/fallback.ts`) handles the demo's real commands: "less formal", "add a jacket", "try sneakers", "I don't like beige", "perfect" |
| **JEV** fails or key missing | Deterministic ranking of the same explicit alternatives via softmax over metadata scores; record marked `provider: "fallback"` |
| **YouCam** fails | Explicit error, previous image preserved, retry offered. No substitute image generator |
| **YouCam** key missing | Fail closed with `YOUCAM_API_KEY is not configured`. Never fabricate a try-on |
| **Runway** fails | Cannot affect the completed outfit |
| Network hang | Hard per-request deadline (`AbortController`) normalized to a retryable error |
| Rate limit / 5xx | Bounded exponential-backoff retries; 4xx never retried |
| Slow generation | Multi-step loading experience, never a bare spinner |

### Mock mode

`DRESSLY_MOCK_EXTERNAL_APIS=true` is **development only**. It returns a composite image with a
large `MOCK RESULT` watermark and the env var name printed on it, so a simulated result can never
be mistaken for a real one. The UI shows a provider banner whenever mock mode is on, driven by
`providerStatuses()` in `lib/env.ts`, which reports truthful per-provider state.

`DRESSLY_DEMO_MODE=true` is different: it preloads a reliable curated flow but **still uses real
provider calls**.

---

## 9. Environment variables

```env
# YouCam / Perfect Corp — the core try-on engine (required for a real demo)
YOUCAM_API_KEY=
YOUCAM_API_URL=https://yce-api-01.makeupar.com
YOUCAM_POLL_INTERVAL_MS=3000
YOUCAM_TIMEOUT_MS=120000

# JEV / TypeSafe System One — the decision engine (required for a real demo)
TYPESAFE_API_KEY=
TYPESAFE_API_URL=https://api.typesafe.ai
JEV_MODEL=jev-1.13.0
JEV_TIMEOUT_MS=20000

# Gemini — language and multimodal understanding (required for a real demo)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=30000

# Runway — optional P2 animation only. Any image-to-video model Runway hosts,
# e.g. gemini_omni_flash_1.1 (Google Gemini Omni), gen4_turbo, veo3.1.
RUNWAY_API_KEY=
RUNWAY_API_URL=https://api.dev.runwayml.com
RUNWAY_MODEL=gemini_omni_flash_1.1
RUNWAY_RATIO=720:1280
RUNWAY_DURATION_SECONDS=5
RUNWAY_ENABLED=false

# Development only. Never for a recorded or judged demo.
DRESSLY_MOCK_EXTERNAL_APIS=false

# Preloads a reliable curated flow. Still uses real provider calls.
DRESSLY_DEMO_MODE=false
```

`TYPESAFE_API_URL` is an **origin only** — the SDK appends its own fixed `/v1/systemone` path.

Credentials are read exclusively in `lib/env.ts`, which is imported only by server modules. No key
ever reaches the browser.

---

## 10. Repository layout

### Present

```
app/
  layout.tsx  page.tsx  globals.css   Editorial shell + Tailwind 4 design tokens
  api/
    providers/  sessions/  sessions/[id]/{photo,chat,finish,clear-rejections,runway}
    sessions/[id]/looks/[lookId]/{feedback,restore}  jobs/[id]{,/retry}  media/[...segments]
components/
  DresslyApp.tsx  Onboarding.tsx  FittingRoom.tsx  BeforeAfter.tsx  LoadingSteps.tsx
  ChatPanel.tsx  DecisionsPanel.tsx  LookHistory.tsx  FinalLook.tsx  ProductCard.tsx
  Masthead.tsx  ProviderBanner.tsx  Logo.tsx  icons.tsx
  shaders/  DresslyAmbient.tsx  DresslyLoadingShader.tsx  DresslyGlass.tsx
            DresslyGlow.tsx  LookStage.tsx
lib/
  types.ts  env.ts  api-types.ts
  visual/   config.ts  hooks.ts
  agent/    plan.ts  orchestrator.ts  tryon.ts  jobs.ts  runway.ts  suggestions.ts
  catalog/  products.ts  query.ts  occasion.ts
  session/  reducer.ts  store.ts
  storage/  files.ts  media.ts
  server/   chat-turn.ts  session-payload.ts  respond.ts
  client/   api.ts
  util/     http.ts  id.ts
services/
  contracts.ts  youcam/{client,mock,index}  jev/{client,fallback,index}
  gemini/{client,fallback,index}  runway/{contract,client,index}
scripts/
  gen-catalog-images.ts  loader.mjs  register.mjs
public/catalog/            35 generated garment renders
tests/                     32 deterministic behaviour tests
docs/                      PROJECT.md  DEMO.md
README.md  .env.example
```

### Not created (deliberately)

```
data/                      Runtime artifacts (gitignored, created on first request)
```

There is no database, no auth, no ORM and no state-management library: the server owns session
state in memory with a JSON disk mirror, and the browser renders what the server returns.

---

## 11. Task status

Source of truth: `odd/tasks/dressly.md`.

### Completed

| # | Task | Evidence |
| --- | --- | --- |
| T2 | Catalog: 35 products, full metadata, YouCam category mapping | `lib/catalog/products.ts` |
| T4a | Domain types + `StylingSession` | `lib/types.ts` |
| T4b | Deterministic reducer (intent fold, placement, rejection, like, restore, metrics) | `lib/session/reducer.ts` |
| T4c | Session store: disk mirror, per-session write lock | `lib/session/store.ts` |
| T4d | Catalog query engine: filters, 6-signal scoring, shortlisting, occasion inference | `lib/catalog/query.ts`, `lib/catalog/occasion.ts` |
| T5a | YouCam engine: full async lifecycle, category mapping, status normalization, result re-hosting | `services/youcam/client.ts` |
| T5b | JEV engine: official SDK, 3-question evaluation, strict answer validation | `services/jev/client.ts` |
| T5c | Gemini engine: structured intent extraction + local normalization | `services/gemini/client.ts` |
| T5d | Fallback layer for Gemini and JEV, plus the visible YouCam mock | `services/gemini/fallback.ts`, `services/jev/fallback.ts`, `services/youcam/mock.ts` |
| T14a | HTTP reliability primitives: deadlines, retries, normalized provider errors | `lib/util/http.ts` |
| T15a | Toolchain hygiene: `.gitignore` covering `node_modules/`, `.next/`, `.env`, `data/`; feature branch | `.gitignore`, `feat/dressly-mvp` |

### Completed (this session)

| # | Task | Evidence |
| --- | --- | --- |
| T5e | Completed `npm install`; verified `next` + `tsc` | `package-lock.json`, `node_modules/.bin/next` |
| T1 | App shell: Tailwind 4 tokens, editorial layout, fonts | `app/globals.css`, `app/layout.tsx`, `app/page.tsx` |
| T3 | Catalog imagery pipeline → 35 PNG renders | `scripts/gen-catalog-images.ts`, `public/catalog/` |
| T6 | Agent core: planning, orchestration, chained try-on, jobs | `lib/agent/*` |
| T7 | API routes: sessions, photo, chat, jobs, retry, media, providers, finish, feedback, restore, runway | `app/api/**` |
| T8–T13 | Full UI: onboarding, fitting room, chat, decisions, history, final look | `components/*` |
| T14 | Reliability wiring end to end | `lib/util/http.ts`, provider fallbacks, job retry |
| T15 | P2 Runway animation behind its flag | `services/runway/*`, `lib/agent/runway.ts` |
| T16 | 32 deterministic tests | `tests/*.test.ts` |
| T17 | README, `.env.example`, demo script | `README.md`, `.env.example`, `docs/DEMO.md` |
| T18 | Final verification | typecheck clean, build clean, 32/32 tests, mock-mode smoke |

### Remaining (blocked only on credentials / environment)

| # | Item | Note |
| --- | --- | --- |
| — | Exercise the live YouCam / JEV / Gemini path | needs keys in `.env.local` |
| — | Engram mirror of the task document | Engram binary not installed; file is source of truth |

### Commit log

_Work is committed as reviewable work units on `feat/dressly-mvp`. See `git log`._

---

## 12. Blockers and risks

| # | Blocker | Impact | Resolution |
| --- | --- | --- | --- |
| B1 | ~~`npm install` never completed~~ | Resolved | Re-ran `npm install`; `next` + `tsc` verified |
| B2 | **No provider credentials.** No `YOUCAM_API_KEY`, `TYPESAFE_API_KEY` or `GEMINI_API_KEY`. | Real integrations are implemented and gated but unexercised. Mock mode verified end to end. | Owner supplies keys in `.env.local` |
| B3 | ~~No catalog imagery~~ | Resolved | T3: `scripts/gen-catalog-images.ts` generated 35 flat-lay PNGs |
| B4 | **Engram memory is not installed** (`engram` binary missing). | The ODD memory mirror cannot be created; the file task document remains the single source of truth. | Install Engram, or accept the file-only workflow |

| # | Risk | Mitigation already in place |
| --- | --- | --- |
| R1 | Mock results mistaken for real YouCam output in a judged demo | Large watermark, env var printed on the image, provider banner from `providerStatuses()`, `provider: "fallback"` recorded on every non-JEV decision |
| R2 | YouCam garment reference requirements differ from our SVG/placeholder imagery | `TryOnRequest` carries content type and bytes; the imagery pipeline is isolated in T3 and swappable without touching the engine |
| R3 | Chained try-on accumulates artifacts across iterations | The chain is deliberate and documented; a look can always be rebuilt from the original photo if quality degrades |
| R4 | Agent loop latency (Gemini + JEV + YouCam sequentially) | Polling architecture with a real multi-step loading state, so the wait is legible rather than frozen |

---

## 13. Target demo flow

The application must reliably support this scenario end to end.

> **User:** "I have a rooftop dinner tonight. Build me something elegant but not too formal."

Dressly infers smart-casual/evening, filters the catalog, lets JEV evaluate the candidates, selects a
top, runs YouCam, and shows the result.

> **User:** "That's too formal."

The current product is marked rejected, the formal preference is lowered, JEV re-evaluates the
remaining alternatives, and a new YouCam result is generated.

> **User:** "That's better. Add a jacket."

`ADD_OUTER` → compatible outerwear → the correct YouCam workflow → updated result.

> **User:** "Try sneakers instead."

Footwear is replaced and visualized.

> **User:** "Perfect."

**Your Dressly Look** — large final image, product cards with name, category, price and thumbnail,
a total, and **Add complete look to cart** (simulated, no payment integration).

Alongside it, the **Agent Decisions** panel shows only structured, safe material — never raw
chain-of-thought:

```
USER INTENT          Rooftop dinner · Elegant · Not too formal
STYLE EVALUATION     Smart Casual 0.72 · Evening 0.18 · Casual 0.08 · Formal 0.02
CURRENT ACTION       CHANGE_TOP
PRODUCT EVALUATION   Linen Resort Shirt 0.84 · Knitted Polo 0.79 · Oxford Shirt 0.52
SELECTED             Linen Resort Shirt
WHY                  "It keeps the outfit relaxed while still fitting an evening dinner."
```

Closing value summary:

```
Dressly helped you narrow:  18 compatible products → 4 virtual try-ons → 1 final outfit
```

---

## 14. Visual direction

Editorial fashion and luxury eCommerce, explicitly **not** generic SaaS dashboard.

- large photography, minimal interface, generous whitespace
- strong typography, elegant cards, subtle gradients where they earn their place
- smooth transitions between looks; crossfade before/after
- polished loading states with named steps:

```
Understanding your style       ✓
Choosing the right piece       ✓
Generating your virtual fit    …
```

- clean AI chat; the Agent Decisions panel is optional and collapsible
- **Dressly** — *Your AI personal stylist.*
- Before/after labelled **Original** and **Dressly**

---

## 15. Next steps, in order

1. **Supply credentials** in `.env.local` (`YOUCAM_API_KEY`, `TYPESAFE_API_KEY`, `GEMINI_API_KEY`)
   and run one live end-to-end pass. This is the only step that cannot be done without the owner.
2. **Rehearse the demo** from `docs/DEMO.md` against the live providers.
3. Optionally enable Runway (`RUNWAY_ENABLED=true` + key) for the P2 animation.
4. Optionally swap the generated flat-lay imagery for real garment photography — the pipeline is
   isolated in `scripts/gen-catalog-images.ts` and does not touch the engine.

---

## 16. Document map

| Document | Purpose |
| --- | --- |
| `docs/PROJECT.md` | This document — product, MVP, stack, architecture, status |
| `docs/DEMO.md` | The scripted demo flow and expected behaviour |
| `odd/tasks/dressly.md` | ODD task source of truth, provider decisions, verified API contracts, commit log |
| `README.md` | Setup, running locally, required keys, architecture summary |
