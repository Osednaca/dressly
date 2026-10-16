# Dressly Live Consultation — Technical Architecture & 4-Phase Implementation Plan

**Style it. Design it. Try it.**  
An AI-assisted collaborative fashion design experience integrated natively into Dressly's Midnight Atelier workspace.

- **Document:** `docs/LIVE_CONSULTATION_PLAN.md`
- **Target Branch:** `feat/dressly-mvp`
- **Status:** Detailed Technical Specification & 4-Phase Plan (Pre-Implementation)

---

## Table of Contents

1. [Executive Summary & System Topology](#1-executive-summary--system-topology)
2. [Technology Stack & Runtime Matrix](#2-technology-stack--runtime-matrix)
3. [Architectural Decision Records (ADRs)](#3-architectural-decision-records-adrs)
4. [Complete Repository File Map (Modified vs. New Files)](#4-complete-repository-file-map-modified-vs-new-files)
5. [Domain Data Model & Type Contracts](#5-domain-data-model--type-contracts)
6. [Internal API Specification (Next.js App Router, SSE & Bot Worker)](#6-internal-api-specification-nextjs-app-router-sse--bot-worker)
7. [External AI Provider API Specification (Gemini, JEV, Runway, YouCam)](#7-external-ai-provider-api-specification-gemini-jev-runway-youcam)
8. [Phase 1 — Domain State, AI Decision Engine (Gemini + JEV) & Human-in-the-Loop UI](#8-phase-1--domain-state-ai-decision-engine-gemini--jev--human-in-the-loop-ui)
9. [Phase 2 — Iterative Design Generation (`nano_banana_2.1`) & YouCam Virtual Try-On Loop](#9-phase-2--iterative-design-generation-nano_banana_21--youcam-virtual-try-on-loop)
10. [Phase 3 — Isolated Playwright Meeting Bot Worker & Replaceable Audio Capture Pipeline](#10-phase-3--isolated-playwright-meeting-bot-worker--replaceable-audio-capture-pipeline)
11. [Phase 4 — Flagship Demo Scenario, Dev Diagnostics, Failure Isolation & Documentation](#11-phase-4--flagship-demo-scenario-dev-diagnostics-failure-isolation--documentation)
12. [Environment Variables Reference](#12-environment-variables-reference)
13. [Definition of Done Checklist (25 Criteria)](#13-definition-of-done-checklist-25-criteria)

---

## 1. Executive Summary & System Topology

Dressly currently provides an **AI Personal Stylist** experience (`Gemini Intent → JEV Decision → YouCam Chained VTO → Runway Video Animation`). **Dressly Live Consultation** adds a second, native mode: **Live Design Consultation**.

During a live **Google Meet** call between a fashion designer/stylist and a client, an isolated Playwright + Chromium bot joins the meeting visibly as **`Dressly AI Assistant`**, captures the remote meeting audio output (never the designer's physical microphone), streams `16 kHz mono PCM` audio to **Gemini Live (`gemini-3.8-live`)**, aggregates and deduplicates spoken utterances, extracts candidate garment/accessory modifications via **Gemini (`gemini-3.8-flash`)**, and evaluates the next agentic action via **JEV (`jev-1.13.0`)**.

All proposed modifications require **human-in-the-loop approval** (`[ Ignore ]`, `[ Edit ]`, `[ Apply ]`, or an explicit opt-in `AUTO APPLY ●` toggle). Once approved, Dressly updates its canonical `BagDesignState`, builds a deterministic drift-controlled prompt, generates the revised studio product image with **Runway (`nano_banana_2.1`)** using `@latest_design` and `@original_design` reference images, records a restorable **Design Version (`V1 → V2 → V3 → V4`)**, and optionally passes the generated product to **YouCam Virtual Try-On** so the client immediately sees the updated piece on themselves.

### End-to-End Architecture Diagram

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ DESIGNER BROWSER                                                                              │
│  ┌──────────────────────────────┐     ┌────────────────────────────────────────────────────┐  │
│  │ Google Meet Tab + Native PiP │     │ Dressly Next.js Client (components/DresslyApp.tsx) │  │
│  │ (Video, Mic, Participants)   │     │  • FittingRoom + LookStage (Shaders.com RippleWipe)│  │
│  └──────────────┬───────────────┘     │  • ConsultationPanel ([Ignore] [Edit] [Apply])     │  │
│                 │                     │  • DesignVersionStrip (V1 → V2 → V3 → V4)          │  │
└─────────────────┼─────────────────────┴─────────▲──────────────────────────────┬───────────┘  │
                  │ WebRTC Audio/Video            │ SSE Event Stream             │ REST Calls   │
                  ▼                               │ GET /consultation/events     ▼              │
┌──────────────────────────────────┐    ┌─────────┴─────────────────────────────────────────────┤
│ GOOGLE MEET ROOM                 │    │ DRESSLY NEXT.JS 16 SERVER (App Router, Port 3000)     │
│  • Designer                      │    │  • Session Store + Mutex (lib/session/store.ts)       │
│  • Customer                      │    │  • Conversation Aggregator & Deduplicator             │
│  • "Dressly AI Assistant" (Bot)  │    │  • Gemini Extractor (services/gemini/consultation.ts) │
└─────────────────┬────────────────┘    │  • JEV Decision Engine (services/jev/client.ts)       │
                  │ Remote Audio        │  • Prompt Builder (lib/agent/consultation-prompt.ts)  │
                  ▼                     │  • Async Job Orchestrator (lib/agent/jobs.ts)         │
┌──────────────────────────────────┐    └─────────▲──────────────┬───────────────┬──────────────┤
│ ISOLATED BOT WORKER (Port 4100)  │              │              │               │              │
│  services/meeting-bot/worker.ts  │              │ Webhook      │ HTTPS REST    │ HTTPS REST   │
│  • Playwright + Chromium         │              │ POST         ▼               ▼              │
│  • ConsultationAudioSource       │              │ /bot-event ┌──────────────┐ ┌──────────────┐│
│    ├─ WebRTC AudioWorklet Tap    │              │ (x-meeting │ RUNWAY API   │ │ YOUCAM API   ││
│    └─ PulseAudio Sink + FFmpeg   │              │  -bot-     │ POST /v1/    │ │ POST /s2s/   ││
│  • 16kHz Mono s16le PCM Stream   │              │  secret)   │ text_to_image│ │ v2.0/task/   ││
│  • Gemini Live Bidi WebSocket ───┴──────────────┘            │ nano_banana  │ │ bag &        ││
│    (wss://...BidiGenerateContent)                            │ _2.1         │ │ cloth-v4     ││
└──────────────────────────────────────────────────────────────┴──────────────┴─┴──────────────┘
```

---

## 2. Technology Stack & Runtime Matrix

Every technology choice adheres strictly to Dressly's existing stack without adding databases, message brokers, or duplicate SDKs.

| Layer | Technology / Package | Version | Exact Role in Live Consultation |
| :--- | :--- | :--- | :--- |
| **Web Framework** | `next` (App Router) | `16.3.8` | Server Route Handlers (`app/api/sessions/[id]/consultation/**`), SSE streaming (`ReadableStream`), and static/media serving. |
| **UI Runtime** | `react` / `react-dom` | `19.2.0` | Client state orchestration, consultation panel, inline suggestion editor, and version history strip. |
| **Language** | `typescript` | `5.9.3` | `strict: true`, `noUncheckedIndexedAccess: true`, `@/*` root path alias. Node 22 native `--experimental-strip-types` execution for worker and tests. |
| **Styling** | `tailwindcss` / `@tailwindcss/postcss` | `4.3.3` | Midnight Atelier CSS-first `@theme` tokens (`--color-background: #0b0a09`, `--color-accent: #c8845a`, `.glass`, `.overline`, `.hairline`). |
| **Visual Shaders** | `shaders` (`shaders/react`) | `^4.0.0` | `LookStage` (`RippleWipe` between `V1 → V2 → V3`), `DresslyLoadingShader` (progress-driven `ChromaFlow`), `DresslyGlass` (`FlutedGlass`), `DresslyGlow` (`RadialGradient`), `DresslyAmbient`. |
| **Decision Engine** | `@typesafe-ai/sdk` | `0.6.0` | `TypeSafeClient.systemOne()` + `choice()` evaluating the 6 `CONSULTATION_ACTIONS` with model `jev-1.13.0` at `https://api.typesafe.ai`. |
| **Speech & Understanding** | Google Gemini REST & Live WS | `v1beta` | Native `fetch` to `models/gemini-3.8-flash:generateContent` (structured modification extraction) + `WebSocket` to `BidiGenerateContent` with `models/gemini-3.8-live` (real-time meeting audio transcription). |
| **Product Generation** | RunwayML REST API | `2024-11-06` | Native `fetch` to `POST https://api.dev.runwayml.com/v1/text_to_image` (`model: "nano_banana_2.1"`) and `GET /v1/tasks/{id}`. |
| **Virtual Try-On** | Perfect Corp YouCam S2S API | `v2.0` | Native `fetch` to `POST /s2s/v2.0/file`, presigned S3 `PUT`, `POST /s2s/v2.0/task/bag` (and `/s2s/v2.0/task/cloth-v4`), and `GET /s2s/v2.0/task/{kind}/{task_id}`. |
| **Image Processing** | `sharp` | `0.35.5` | Already installed in `devDependencies`; used to generate the high-resolution V1 canonical burgundy leather handbag asset and deterministic mock renders. |
| **Browser Automation** | `playwright-core` | `^1.52.0` | Drives the isolated Chromium meeting bot process (`services/meeting-bot/worker.ts`), attaching to pre-installed Playwright Chromium (`chromium-1248`) or system Chrome. |
| **Audio Pipeline** | WebAudio `AudioWorklet` + `ffmpeg` / `PulseAudio` | System / Playwright `ffmpeg-1013` | Captures Chromium's meeting audio output as `16 kHz, mono, 16-bit signed PCM (s16le)` behind `ConsultationAudioSource`. |
| **Test Runner** | `node:test` + `node:assert/strict` | Node `v22.22.3` | Zero-dependency TypeScript test execution via `--experimental-strip-types --import ./scripts/register.mjs`. |

---

## 3. Architectural Decision Records (ADRs)

### ADR-01: Extend `StylingSession` In-Place Instead of Creating a Separate Store
- **Context:** Dressly stores sessions in memory and mirrors them to `data/sessions/{id}.json` with a per-session promise mutex (`mutateSession(id, mutator)` in `lib/session/store.ts`).
- **Decision:** Attach `consultation?: LiveConsultationSession | null` directly onto `StylingSession`.
- **Why:**
  1. Preserves atomic serialization through the existing `locks` map in `lib/session/store.ts` so concurrent SSE events, bot transcript webhooks, Runway polls, and YouCam polls never race or overwrite each other.
  2. Allows Live Consultation to reuse `session.userPhotoPath` (uploaded during Onboarding), `session.looks` (LookHistory & BeforeAfter comparison), and `session.decisions` (JEV `DecisionsPanel`) with zero duplication.

### ADR-02: Server-Sent Events (SSE) + Existing Job Poller for Real-Time UI Updates
- **Context:** The consultation UI must react immediately when the bot changes status, when speech is transcribed, or when a suggestion is detected, without manual refresh and without introducing Redis or a custom Next.js HTTP server.
- **Decision:**
  1. Implement `GET /api/sessions/[id]/consultation/events` returning a standard Web `ReadableStream` (`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`) backed by an in-process `EventEmitter` singleton (`lib/server/consultation-events.ts`) keyed by `sessionId`.
  2. Reuse Dressly's existing `AgentJob` poller (`GET /api/jobs/[id]` in `app/api/jobs/[id]/route.ts`) extended with `kind: "design" | "tryon" | "runway"`, while also broadcasting `design.generation.*` and `vto.*` events over SSE.
- **Why:** Works natively in Next.js 16 App Router Route Handlers (`export const dynamic = "force-dynamic"`), auto-reconnects in browser `EventSource`, and keeps async Runway/YouCam polling consistent with the existing `DresslyApp.tsx` architecture.

### ADR-03: Isolated Node.js HTTP Worker for Playwright + Chromium (`services/meeting-bot/worker.ts`)
- **Context:** A Google Meet call lasts minutes to hours. Running Playwright + Chromium + live audio streaming inside a Next.js API route handler would block serverless/route lifecycles and leak processes on hot-reload.
- **Decision:** Run the meeting bot as a standalone Node.js process (`node --experimental-strip-types --import ./scripts/register.mjs services/meeting-bot/worker.ts`) listening on `127.0.0.1:4100` (configurable via `MEETING_BOT_PORT`), authenticated via a shared header `X-Meeting-Bot-Secret`.
- **Why:**
  1. Isolates Chromium memory/CPU and audio streams from the Next.js server.
  2. Enables deterministic process lifecycle management (`SIGINT`, `SIGTERM`, `End Consultation`, crash cleanup) so orphan Chromium processes never accumulate.
  3. If the bot worker is not running, the Next.js server degrades gracefully and keeps manual/simulated consultation controls working.

### ADR-04: Dual-Strategy Browser Output Audio Capture Behind `ConsultationAudioSource`
- **Context:** Dressly must capture the **browser's meeting audio output** (not the physical microphone) so it hears the remote customer even when the designer wears headphones, and the architecture must work on both **Linux/Docker** and **Windows (`win32`) local development** while remaining replaceable by a future official `GoogleMeetMediaApiAudioSource`.
- **Decision:** Define `ConsultationAudioSource` in `services/meeting-bot/audio-source.ts` and implement `ChromeMeetAudioSource` (`services/meeting-bot/audio-capture.ts`) with two selectable capture backends (`MEETING_AUDIO_BACKEND="webrtc-tap" | "pulseaudio" | "auto"`):
  1. **`webrtc-tap` (Default cross-platform — Linux, Docker, macOS, Windows):** Uses `page.addInitScript()` to hook `RTCPeerConnection.prototype` (`ontrack` / `getReceivers()`) and `HTMLMediaElement.prototype.play` inside the bot's Chromium page. Every remote audio `MediaStreamTrack` from Google Meet is routed into a dedicated `AudioContext({ sampleRate: 16000 })` + `AudioWorkletNode`, converted into `16 kHz mono s16le PCM` frames (`3200 bytes` = `100ms` per chunk), and passed to Node via `page.exposeBinding("__dresslyAudioChunk")`.
  2. **`pulseaudio` (Linux / Docker native OS sink):** Creates an isolated PulseAudio/PipeWire null sink (`pactl load-module module-null-sink sink_name=dressly_meet_<id>`), sets `PULSE_SINK=dressly_meet_<id>` on the Chromium child process, and spawns `ffmpeg -f pulse -i dressly_meet_<id>.monitor -ac 1 -ar 16000 -f s16le pipe:1` to read `16 kHz mono s16le PCM` from `stdout`.
- **Why:** `webrtc-tap` requires zero OS audio driver setup on Windows/macOS/Linux and captures strictly the remote Google Meet audio streams inside Chromium, while `pulseaudio` satisfies the Linux/Docker virtual sink + `ffmpeg` monitor pipeline. Both emit identical `Buffer` chunks through `ConsultationAudioSource`.

### ADR-05: Two-Stage AI Pipeline (Gemini Live Transcription → Aggregator → Gemini Flash Extraction → JEV Choice)
- **Context:** Live meetings contain fragmented thoughts, pauses, repeated phrases, and irrelevant small talk.
- **Decision:** Separate **real-time speech transcription** from **semantic modification extraction and decision-making**:
  1. **Stage 1 (Live Speech-to-Text):** The bot worker streams `16 kHz PCM` to Gemini Live (`gemini-3.8-live`, `inputAudioTranscription: {}`) and forwards partial/final transcript segments (`speaker: "MEETING"`) to Next.js.
  2. **Stage 2 (Conversation Aggregator & Deduplicator):** Buffers finalized segments over a `1800ms` silence debounce window (`0ms` when `immediate: true` in manual/test calls) and suppresses normalized transcript duplicates (`Jaccard >= 0.85` within `15s`).
  3. **Stage 3 (Gemini Semantic Extraction):** `services/gemini/consultation.ts` calls `gemini-3.8-flash` (`responseMimeType: "application/json"`) with the current `BagDesignState` to extract structured `DesignFieldDiff[]` and classify `speechKind`.
  4. **Stage 4 (JEV Agentic Evaluation):** `services/jev/client.ts` calls `@typesafe-ai/sdk` `systemOne` (`choice` over `IGNORE`, `PROPOSE_CHANGE`, `ASK_CLARIFICATION`, `TRY_ON_CURRENT_DESIGN`, `RETURN_TO_PREVIOUS_VERSION`, `FINALIZE_DESIGN`).
- **Why:** Prevents chatty or premature generations, ensures irrelevant speech (*"How was your weekend?"*, *"Can you hear me?"*) is deterministically and agentically filtered out (`IGNORE`), and records every JEV consultation decision in `session.decisions`.

### ADR-06: Drift-Controlled Runway `nano_banana_2.1` Generation via Dual Reference Images
- **Context:** Regenerating a product from text alone across multiple edits (`V1 → V2 → V3 → V4`) causes unrelated attributes (silhouette, camera angle, texture, lighting) to drift.
- **Decision:** Use Runway's official `POST /v1/text_to_image` endpoint with `model: "nano_banana_2.1"`, `ratio: "896:1200"`, `thinkingLevel: "medium"`, `outputCount: 1`, and up to 2 tagged `referenceImages`:
  - `{ uri: <current version data URI>, tag: "latest_design" }` (always included for `V2+`)
  - `{ uri: <V1 original version data URI>, tag: "original_design" }` (included for `V3+` as a structural/framing anchor)
  Paired with a programmatic prompt builder (`lib/agent/consultation-prompt.ts`) that explicitly lists `CURRENT PRODUCT`, `REQUESTED MODIFICATION`, `STRICT PRESERVATION CONSTRAINTS`, and `OUTPUT FORMAT`.

### ADR-07: YouCam S2S v2.0 Bag VTO (`POST /s2s/v2.0/task/bag`) & Honest Fallback
- **Context:** Perfect Corp's `/s2s/v2.0/task/cloth-v4` only accepts `garment_category` in `["full_body", "lower_body", "upper_body", "shoes", "auto", "outer"]` and rejects bags with HTTP `400`. YouCam S2S v2.0 provides a dedicated bag endpoint at `POST /s2s/v2.0/task/bag` (`GET /s2s/v2.0/task/bag/{task_id}`).
- **Decision:** Extend `services/youcam/client.ts` to support a `taskKind: "cloth-v4" | "bag"` discriminator:
  - When `taskKind === "bag"`, reuse `uploadAsset()` for `src_file_id` (customer image) and `ref_file_id` (Runway generated handbag image) and call `POST /s2s/v2.0/task/bag` with `{ src_file_id, ref_file_id, gender: "female", style: "style_parisian_chic" }`.
  - If the active YouCam API key/subscription or uploaded photo rejects `/s2s/v2.0/task/bag` (e.g. `400`/`403`), surface an honest `BlockedView` (`code: "BAG_VTO_UNAVAILABLE"`) in the UI while keeping the generated Runway design intact and placing the custom bag into `session.currentLook.accessories` — never fabricating a fake VTO image when `DRESSLY_MOCK_EXTERNAL_APIS=false`.

---

## 4. Complete Repository File Map (Modified vs. New Files)

All paths are relative to the repository root `E:\programacion\dressly` (`@/*` -> `./*`).

### 4.1 Existing Files to Modify

| File Path | Specific Changes |
| :--- | :--- |
| `package.json` | Add `"playwright-core": "^1.52.0"` to `dependencies`; add scripts `"bot:worker": "node --no-warnings --experimental-strip-types --import ./scripts/register.mjs services/meeting-bot/worker.ts"` and `"gen:consultation-seed": "node --no-warnings --experimental-strip-types --import ./scripts/register.mjs scripts/gen-consultation-seed.ts"`. |
| `.env.example` | Document `RUNWAY_IMAGE_MODEL`, `RUNWAY_IMAGE_RATIO`, `DRESSLY_CONSULTATION_DEMO_MODE`, `CONSULTATION_AUTO_APPLY_THRESHOLD`, `MEETING_BOT_URL`, `MEETING_BOT_PORT`, `MEETING_BOT_SECRET`, `MEETING_BOT_PROFILE_DIR`, `MEETING_AUDIO_BACKEND`, `FFMPEG_PATH`. |
| `lib/env.ts` | Parse and export the new consultation, Runway image (`nano_banana_2.1`), and meeting-bot environment variables. |
| `lib/types.ts` | Add `ConsultationStatus`, `MeetingBotStatus`, `CONSULTATION_ACTIONS`, `ConsultationAction`, `BagDesignState`, `DesignFieldKey`, `DesignFieldDiff`, `ProposedDesignChange`, `DesignVersion`, `TranscriptSegment`, `ConsultationActivityEntry`, `LiveConsultationSession`, and `consultation?: LiveConsultationSession \| null` on `StylingSession`. |
| `lib/api-types.ts` | Extend `JobKind` to `"tryon" \| "runway" \| "consultation_design" \| "consultation_tryon"`; add request/response wire interfaces for all `/api/sessions/[id]/consultation/**` routes and `ConsultationSseEvent`. |
| `lib/session/reducer.ts` | Add pure state reducers: `initConsultation`, `setConsultationStatus`, `setMeetingBotStatus`, `appendTranscriptSegment`, `addProposedSuggestion`, `updateSuggestionStatus`, `applyApprovedChangesToState`, `recordDesignVersion`, `restoreDesignVersion`, `attachTryOnToVersion`, `appendConsultationActivity`, `endConsultation`. |
| `lib/agent/jobs.ts` | Extend `AgentJob` union fields (`versionId?: string`, `suggestionId?: string`, `tryOnTaskKind?: "cloth-v4" \| "bag"`) to track async `nano_banana_2.1` image generation jobs and bag VTO jobs. |
| `app/api/jobs/[id]/route.ts` | Route `"consultation_design"` jobs to `pollConsultationDesign(id)` and `"consultation_tryon"` jobs to `pollConsultationTryOn(id)`. |
| `app/api/jobs/[id]/retry/route.ts` | Support retrying failed `"consultation_design"` and `"consultation_tryon"` jobs. |
| `services/contracts.ts` | Extend `TryOnRequest` with optional `taskKind?: "cloth-v4" \| "bag"`, `gender?: "female" \| "male"`, and `bagStyle?: string`. |
| `services/runway/contract.ts` | Add `RunwayReferenceImage`, `RunwayImageRequest`, `RunwayImageState`, and `submitImage` / `pollImage` methods on `RunwayEngine`. |
| `services/runway/client.ts` | Implement `POST /v1/text_to_image` (`model: "nano_banana_2.1"`, `ratio`, `thinkingLevel`, `outputCount`, `referenceImages`) and image output downloading in `pollImage()` reusing `/v1/tasks/{id}`. |
| `services/runway/index.ts` | Add `mockRunwayImageEngine` fallback when `env.mockExternalApis === true` so offline tests can exercise `nano_banana_2.1` flows deterministically. |
| `services/youcam/client.ts` | Add `POST /s2s/v2.0/task/bag` + `GET /s2s/v2.0/task/bag/{id}` support when `request.taskKind === "bag"` (or `handle.taskKind === "bag"`). |
| `services/jev/client.ts` | Add `evaluateConsultationWithJev(request: JevConsultationRequest): Promise<JevConsultationResult>` using `@typesafe-ai/sdk` `choice` over `CONSULTATION_ACTIONS`. |
| `services/jev/fallback.ts` | Add `evaluateConsultationDeterministic(request, signals)` softmax evaluator over `CONSULTATION_ACTIONS`. |
| `services/jev/index.ts` | Export `decideConsultation(request, signals): Promise<JevConsultationOutcome>`. |
| `lib/client/api.ts` | Add typed client methods: `startConsultation`, `updateConsultationSettings`, `endConsultation`, `sendConsultationTranscript`, `actOnSuggestion`, `restoreDesignVersion`, `startConsultationTryOn`, `triggerBotDiagnostic`. |
| `components/Masthead.tsx` | Add workspace mode switcher (`AI Stylist` / `● Live Consultation`) and `"Start Consultation"` button in the sticky editorial header. |
| `components/FittingRoom.tsx` | Support rendering the active `DesignVersion` isolated studio render (`Current Design` tab vs `Virtual Try-On` tab), attribute chips from `BagDesignState`, and version comparison with `<BeforeAfter />`. |
| `components/DresslyApp.tsx` | Wire consultation state, SSE subscription (`useConsultationEvents`), `ConsultationSetupModal`, `ConsultationPanel`, and `DesignVersionStrip` alongside the existing AI Stylist view. |
| `README.md` | Document the Live Consultation architecture, Playwright/Chromium/audio setup, env vars, worker startup, diagnostics, and production roadmap. |

### 4.2 New Files to Create

```text
E:\programacion\dressly
├── app/api/sessions/[id]/consultation/
│   ├── route.ts                                  # POST (start/init), GET (state), PATCH (toggles/viewMode)
│   ├── end/route.ts                              # POST (stop bot, cleanup, mark ENDED)
│   ├── events/route.ts                           # GET (Server-Sent Events stream)
│   ├── bot-event/route.ts                        # POST (webhook from bot worker: status/transcript/errors)
│   ├── transcript/route.ts                       # POST (manual/simulated/worker transcript ingestion)
│   ├── suggestions/[suggestionId]/route.ts       # POST (human-in-the-loop: apply | edit | ignore)
│   ├── versions/[versionId]/restore/route.ts     # POST (restore DesignVersion as active state & reference)
│   ├── tryon/route.ts                            # POST (trigger YouCam VTO for active/given DesignVersion)
│   └── diagnostics/route.ts                      # POST (dev tools: simulate suggestion, test runway, test bot)
├── components/consultation/
│   ├── ConsultationSetupModal.tsx                # Consent dialog, Meet URL input/create, PiP instructions
│   ├── ConsultationPanel.tsx                     # Status header, [Ignore][Edit][Apply] cards, activity, transcript
│   ├── SuggestionCard.tsx                        # Human-in-the-loop diff card + inline parameter editor
│   ├── DesignVersionStrip.tsx                    # V1..Vn horizontal history strip (inspect, compare, restore, VTO)
│   └── ConsultationDiagnostics.tsx               # Collapsible dev/demo toolkit for testing every layer
├── lib/agent/
│   ├── consultation-aggregator.ts                # 1800ms debounce window + Jaccard & fingerprint deduplication
│   ├── consultation-orchestrator.ts              # Transcript → Gemini → JEV → Suggestion / AutoApply / VTO
│   ├── consultation-prompt.ts                    # Deterministic drift-controlled Runway prompt builder
│   ├── consultation-runway.ts                    # Start & poll Runway nano_banana_2.1 design version jobs
│   └── consultation-tryon.ts                     # Start & poll YouCam VTO jobs for generated DesignVersions
├── lib/client/
│   └── use-consultation-events.ts                # React hook subscribing to /api/sessions/[id]/consultation/events
├── lib/server/
│   └── consultation-events.ts                    # In-process EventEmitter pub/sub bus for SSE streams
├── services/gemini/
│   └── consultation.ts                           # Gemini JSON extraction + deterministic fallback for design edits
├── services/meeting-bot/
│   ├── contract.ts                               # Bot worker HTTP & event payload contracts
│   ├── audio-source.ts                           # ConsultationAudioSource interface (replaceable abstraction)
│   ├── audio-capture.ts                          # ChromeMeetAudioSource (WebRTC tap + Linux PulseAudio/FFmpeg)
│   ├── gemini-stream.ts                          # Worker-side Gemini Live 16kHz PCM WebSocket client
│   ├── playwright-bot.ts                         # Playwright Chromium Google Meet controller ("Dressly AI Assistant")
│   ├── worker.ts                                 # Standalone HTTP server (port 4100) + process lifecycle cleanup
│   └── client.ts                                 # Next.js server client for talking to the bot worker
├── public/catalog/
│   └── consultation-bag-v1.png                   # High-res V1 studio burgundy leather handbag seed image
├── scripts/
│   └── gen-consultation-seed.ts                  # Generates public/catalog/consultation-bag-v1.png via sharp
└── tests/
    ├── consultation-reducer.test.ts              # Unit tests for state, versions, restore, and human approval
    ├── consultation-aggregator.test.ts           # Unit tests for debounce aggregation & duplicate suppression
    ├── consultation-prompt.test.ts               # Unit tests for drift-controlled prompt & reference tags
    └── consultation-orchestrator.test.ts         # End-to-end pipeline test (V1 → V2 → V3 → V4 → VTO)
```

---

## 5. Domain Data Model & Type Contracts

### 5.1 Canonical `BagDesignState` Default Seed (Flagship V1)

```ts
export const DEFAULT_BAG_DESIGN_STATE: BagDesignState = {
  category: "bag",
  name: "Atelier Structured Shoulder Bag",
  silhouette: "structured rectangular shoulder bag",
  size: "medium",
  primaryColor: "burgundy",
  secondaryColor: "tonal burgundy edge paint",
  material: "full-grain calfskin leather",
  texture: "smooth",
  hardwareColor: "silver",
  hardwareStyle: "minimal geometric clasp and D-rings",
  strapType: "shoulder",
  strapLength: "standard shoulder drop",
  closure: "front flap with magnetic clasp",
  structure: "rigid box-gusset construction",
  pattern: "solid",
  pockets: ["interior zip compartment", "back slip pocket"],
  decorativeDetails: ["tonal saddle stitching"],
  branding: "none (unbranded clean front)",
  notes: [],
};
```

### 5.2 Supported Modifiable Fields & Human-Readable Labels

| `DesignFieldKey` | UI Label | Example Previous → Proposed |
| :--- | :--- | :--- |
| `size` | `SIZE` | `medium` → `small` |
| `hardwareColor` | `HARDWARE` | `silver` → `gold` |
| `hardwareStyle` | `HARDWARE STYLE` | `minimal clasp` → `sculpted buckle` |
| `strapType` | `STRAP` | `shoulder` → `crossbody` |
| `strapLength` | `STRAP LENGTH` | `standard shoulder drop` → `longer adjustable crossbody` |
| `primaryColor` | `COLOR` | `burgundy` → `espresso brown` |
| `secondaryColor` | `ACCENT COLOR` | `tonal burgundy` → `contrast cream stitching` |
| `material` | `MATERIAL` | `full-grain calfskin leather` → `suede` |
| `texture` | `TEXTURE` | `smooth` → `pebbled` |
| `silhouette` | `SILHOUETTE` | `structured rectangular` → `east-west baguette` |
| `closure` | `CLOSURE` | `front flap clasp` → `top zipper` |
| `structure` | `STRUCTURE` | `rigid box-gusset` → `soft slouched` |
| `pattern` | `PATTERN` | `solid` → `woven intrecciato` |

---

## 6. Internal API Specification (Next.js App Router, SSE & Bot Worker)

All Next.js routes live under `app/api/` with `export const dynamic = "force-dynamic"` and return standardized JSON via `lib/server/respond.ts`.

### 6.1 `POST /api/sessions/[id]/consultation` — Start / Initialize Consultation

Starts a Live Consultation on an existing `StylingSession` (creating V1 if not already initialized) and instructs the isolated Meeting Bot Worker to join `meetingUrl`.

- **Request Body (`StartConsultationRequest`):**
  ```json
  {
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "consentConfirmed": true,
    "autoApply": false,
    "autoTryOn": false,
    "initialDesignState": {
      "primaryColor": "burgundy",
      "hardwareColor": "silver",
      "size": "medium",
      "strapType": "shoulder"
    }
  }
  ```
- **Validation:**
  - Rejects with `400 Bad Request` if `consentConfirmed !== true`.
  - Validates `meetingUrl` matches `^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}` (or allows `"demo://local-consultation"` when testing without a live Meet call).
- **Response (`200 OK`, `ConsultationResponse`):**
  ```json
  {
    "session": { "...StylingSession with consultation populated..." },
    "bot": {
      "status": "STARTING",
      "workerConnected": true,
      "message": "Launching Dressly AI Assistant..."
    }
  }
  ```

### 6.2 `PATCH /api/sessions/[id]/consultation` — Update Session Controls

Toggles `autoApply`, `autoTryOn`, or switches the stage between `"design"` and `"tryon"`.

- **Request Body (`UpdateConsultationRequest`):**
  ```json
  {
    "autoApply": true,
    "autoTryOn": false,
    "activeViewMode": "design"
  }
  ```
- **Response (`200 OK`):** `{ "session": StylingSession }`

### 6.3 `GET /api/sessions/[id]/consultation/events` — Server-Sent Events Stream

Pushes real-time consultation events to the browser so the UI updates without manual refresh.

- **Response Headers:**
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
- **Wire Format (`data: <JSON>\n\n`):**
  ```ts
  export type ConsultationSseEvent =
    | { type: "bot.status"; status: MeetingBotStatus; consultationStatus: ConsultationStatus; message?: string; timestamp: string }
    | { type: "transcript.partial"; segment: TranscriptSegment }
    | { type: "transcript.final"; segment: TranscriptSegment }
    | { type: "suggestion.created"; suggestion: ProposedDesignChange; decision: DecisionRecord; session: StylingSession }
    | { type: "suggestion.updated"; suggestion: ProposedDesignChange; session: StylingSession }
    | { type: "design.generation.started"; job: JobView; suggestionId?: string; session: StylingSession }
    | { type: "design.generation.completed"; version: DesignVersion; job: JobView; session: StylingSession }
    | { type: "design.generation.failed"; job: JobView; message: string; session: StylingSession }
    | { type: "vto.started"; job: JobView; versionId: string; session: StylingSession }
    | { type: "vto.completed"; look: Look; versionId: string; job: JobView; session: StylingSession }
    | { type: "vto.failed"; job?: JobView; blocked?: BlockedView; message: string; session: StylingSession }
    | { type: "consultation.ended"; session: StylingSession };
  ```

### 6.4 `POST /api/sessions/[id]/consultation/transcript` — Ingest Spoken Transcript Segment

Used both by the Meeting Bot Worker and by the UI's manual/simulated transcript controls.

- **Request Headers:** Optional `X-Meeting-Bot-Secret: <MEETING_BOT_SECRET>` when called from the worker.
- **Request Body (`IngestTranscriptRequest`):**
  ```json
  {
    "text": "I like it, but can we make the hardware gold?",
    "isFinal": true,
    "immediate": true
  }
  ```
  *(When `immediate: false` from live bot audio, passes through the `1800ms` conversational aggregation debounce window; when `immediate: true` from UI/tests, processes immediately).*
- **Response (`200 OK`, `TranscriptTurnResponse`):**
  ```json
  {
    "session": { "...updated StylingSession..." },
    "duplicated": false,
    "extraction": {
      "isRelevantFashionSpeech": true,
      "speechKind": "design_modification",
      "confidence": 0.95,
      "changes": [{ "field": "hardwareColor", "proposedValue": "gold" }],
      "summary": "Change hardware color from silver to gold."
    },
    "decision": { "...DecisionRecord from JEV..." },
    "suggestion": {
      "id": "sug_9f8a7b6c5d4e",
      "transcriptExcerpt": "I like it, but can we make the hardware gold?",
      "confidence": 0.95,
      "jevAction": "PROPOSE_CHANGE",
      "changes": [
        {
          "field": "hardwareColor",
          "label": "HARDWARE",
          "previousValue": "silver",
          "proposedValue": "gold"
        }
      ],
      "status": "PENDING",
      "timestamp": "2026-10-16T19:32:10.000Z"
    },
    "autoJob": null,
    "blocked": null
  }
  ```

### 6.5 `POST /api/sessions/[id]/consultation/suggestions/[suggestionId]` — Human-in-the-Loop Decision

Handles the designer clicking **`[ Ignore ]`**, **`[ Edit ]`**, or **`[ Apply ]`**.

- **Request Body (`SuggestionActionRequest`):**
  ```json
  {
    "action": "apply",
    "editedChanges": [
      {
        "field": "primaryColor",
        "label": "COLOR",
        "previousValue": "burgundy",
        "proposedValue": "espresso brown"
      }
    ]
  }
  ```
  - `action: "ignore"`: Marks suggestion `IGNORED`, logs activity, returns updated `session`.
  - `action: "apply"` (without `editedChanges`): Marks suggestion `APPROVED`, commits `suggestion.changes` to `session.consultation.designState`, starts a Runway `nano_banana_2.1` generation job (`kind: "consultation_design"`), and returns `{ session, job, blocked }`.
  - `action: "edit"` (or `"apply"` with `editedChanges`): Replaces `suggestion.changes` with `editedChanges`, marks suggestion `EDITED`, commits `editedChanges` to `session.consultation.designState`, starts the Runway `nano_banana_2.1` generation job, and returns `{ session, job, blocked }`.
- **Response (`200 OK`):**
  ```json
  {
    "session": { "...updated StylingSession..." },
    "job": {
      "id": "job_a1b2c3d4e5f6",
      "kind": "consultation_design",
      "status": "pending",
      "provider": "runway",
      "step": "Rendering revised design with Runway Nano Banana 2.1"
    },
    "blocked": null
  }
  ```

### 6.6 `POST /api/sessions/[id]/consultation/versions/[versionId]/restore` — Restore Prior Version

Restores any `DesignVersion` (`V1..Vn`) so its `designState` and `imageUrl` become the current canonical state and the `@latest_design` reference for subsequent Runway generations.

- **Response (`200 OK`):** `{ "session": StylingSession }`

### 6.7 `POST /api/sessions/[id]/consultation/tryon` — Virtual Try-On for Design Version

Sends the active (or specified `versionId`) isolated product image to YouCam Virtual Try-On.

- **Request Body:** `{ "versionId"?: string }`
- **Response (`200 OK`):** `{ "session": StylingSession, "job": JobView | null, "blocked": BlockedView | null }`

### 6.8 `POST /api/sessions/[id]/consultation/end` — End Consultation & Cleanup

Stops the bot worker session, terminates Chromium/FFmpeg/Gemini Live resources, and marks `consultation.status = "ENDED"`.

- **Response (`200 OK`):** `{ "session": StylingSession }`

### 6.9 Isolated Meeting Bot Worker Internal HTTP API (`127.0.0.1:4100`)

All requests between Next.js (`services/meeting-bot/client.ts`) and the worker (`services/meeting-bot/worker.ts`) carry header `X-Meeting-Bot-Secret: <MEETING_BOT_SECRET>`.

| Method & Path | Request Payload | Response Payload | Purpose |
| :--- | :--- | :--- | :--- |
| `GET /bot/health` | — | `{ ok: true, activeSessions: number, audioBackend: string, chromiumFound: boolean, ffmpegFound: boolean }` | Worker readiness & binary diagnostics. |
| `POST /bot/sessions` | `{ consultationSessionId, meetingUrl, botDisplayName: "Dressly AI Assistant", callbackUrl, audioBackend }` | `{ status: MeetingBotStatus, pid?: number }` | Launches Chromium context, navigates to Google Meet, mutes mic/camera, requests admission, and begins audio capture + Gemini Live stream. |
| `GET /bot/sessions/:id` | — | `{ consultationSessionId, status: MeetingBotStatus, chunksCaptured: number, lastError?: string }` | Inspects bot state. |
| `POST /bot/sessions/:id/reconnect` | — | `{ status: "RECONNECTING" }` | Triggers manual rejoin if the bot was disconnected. |
| `POST /bot/sessions/:id/stop` | — | `{ status: "STOPPED" }` | Closes Gemini WS, stops audio capture, leaves Meet, closes Chromium context. |
| `POST /bot/diagnostics/audio` | `{ durationMs?: number, injectTestTone?: boolean }` | `{ ok: true, chunksEmitted: number, sampleRate: 16000, bytesTotal: number }` | Verifies `ConsultationAudioSource` emits valid 16 kHz PCM without requiring a live human speaker. |

---

## 7. External AI Provider API Specification (Gemini, JEV, Runway, YouCam)

### 7.1 Runway Nano Banana 2.1 (`POST /v1/text_to_image` & `GET /v1/tasks/{id}`)

- **Submit Endpoint:** `POST https://api.dev.runwayml.com/v1/text_to_image`
- **Headers:**
  ```http
  Authorization: Bearer <RUNWAY_API_KEY>
  X-Runway-Version: 2024-11-06
  Content-Type: application/json
  ```
- **Request Body (`RunwayImageSubmissionBody`):**
  ```json
  {
    "model": "nano_banana_2.1",
    "promptText": "CURRENT PRODUCT\nStructured medium burgundy full-grain calfskin leather shoulder bag (@latest_design)...\n\nREQUESTED MODIFICATION\nApply ONLY the following approved change(s) to @latest_design:\n- Hardware color: change from \"silver\" to \"gold\".\n\nSTRICT PRESERVATION CONSTRAINTS\nPreserve @latest_design and @original_design exactly except for the requested modification...",
    "ratio": "896:1200",
    "thinkingLevel": "medium",
    "outputCount": 1,
    "referenceImages": [
      {
        "uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
        "tag": "latest_design"
      },
      {
        "uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
        "tag": "original_design"
      }
    ]
  }
  ```
  - **Constraints Verified Against Official Runway `2024-11-06` Schema:**
    - `model`: `"nano_banana_2.1"` (configurable via `RUNWAY_IMAGE_MODEL`).
    - `ratio`: `"896:1200"` (1K 3:4 portrait for fast interactive consultation turns) or `"1792:2400"` (2K 3:4 portrait for finalized render).
    - `referenceImages[].tag`: Matches `^[a-zA-Z][a-zA-Z0-9_]{2,15}$` (`latest_design`, `original_design`).
    - `promptText`: Always `<= 5500` characters.
- **Submit Response (`200 OK`):** `{ "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08" }`
- **Poll Endpoint:** `GET https://api.dev.runwayml.com/v1/tasks/{id}`
  - When `status === "SUCCEEDED"`, downloads `output[0]` image bytes, saves to `data/results/design_<12hex>.png`, and exposes `/api/media/results/design_<12hex>.png`.

### 7.2 Gemini Semantic Modification Extractor (`POST /v1beta/models/gemini-3.8-flash:generateContent`)

- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`
- **Headers:** `x-goog-api-key: <GEMINI_API_KEY>`, `Content-Type: application/json`
- **Request Payload:**
  ```json
  {
    "systemInstruction": {
      "parts": [{ "text": "<strict JSON schema instructions for fashion consultation design extraction>" }]
    },
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "Current BagDesignState JSON + recent versions + spoken meeting transcript excerpt" }]
      }
    ],
    "generationConfig": {
      "temperature": 0.15,
      "maxOutputTokens": 700,
      "responseMimeType": "application/json"
    }
  }
  ```

### 7.3 Gemini Live Audio Stream (`wss://generativelanguage.googleapis.com/.../BidiGenerateContent`)

- **Endpoint:** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${env.geminiApiKey}` (server-to-server from the isolated bot worker; the API key never leaves the server).
- **Initial Setup Frame:**
  ```json
  {
    "setup": {
      "model": "models/gemini-3.8-live",
      "generationConfig": {
        "responseModalities": ["AUDIO"]
      },
      "inputAudioTranscription": {},
      "systemInstruction": {
        "parts": [
          {
            "text": "You are Dressly AI Assistant, a silent passive listener in a fashion design consultation. Never speak unless explicitly asked. Listen so input audio transcription captures the conversation accurately."
          }
        ]
      }
    }
  }
  ```
- **Streaming Audio Frame:**
  ```json
  {
    "realtimeInput": {
      "audio": {
        "mimeType": "audio/pcm;rate=16000",
        "data": "<base64-encoded 16kHz mono s16le PCM chunk>"
      }
    }
  }
  ```
- **Incoming Transcription Events:** Reads `serverContent.inputTranscription.text` and `serverContent.turnComplete` to emit partial and finalized `TranscriptSegment`s (`speaker: "MEETING"`).

### 7.4 JEV Consultation Action Decision (`POST https://api.typesafe.ai/v1/systemone`)

- **SDK Call (`@typesafe-ai/sdk` in `services/jev/client.ts`):**
  ```ts
  const response = await client().systemOne({
    state: {
      mode: "live_consultation",
      transcriptExcerpt: request.transcriptExcerpt,
      speechKind: request.extraction.speechKind,
      extractionConfidence: request.extraction.confidence,
      proposedChanges: request.extraction.changes,
      currentDesignState: request.designState,
      versionCount: request.versionCount,
      hasUserPhoto: request.hasUserPhoto,
    },
    questions: {
      consultation_action: choice(
        request.alternatives.map((alt) => ({
          action: alt.action,
          description: alt.description,
          priorScore: alt.priorScore,
        })),
        "Given the live fashion consultation utterance and extracted design attributes, which action should Dressly take right now?",
      ),
    },
  });
  ```
- **Evaluated Alternatives (`CONSULTATION_ACTIONS`):**
  1. `IGNORE` — Irrelevant conversation, technical check, retracted thought (*"Actually never mind"*), or zero state change.
  2. `PROPOSE_CHANGE` — Actionable modification to one or more `BagDesignState` fields (`size`, `hardwareColor`, `strapType`, `primaryColor`, etc.).
  3. `ASK_CLARIFICATION` — Vague preference without a concrete direction (*"I don't know, maybe something different"*).
  4. `TRY_ON_CURRENT_DESIGN` — Client asks to see the current design on themselves (*"Can I see how that looks on me?"*, *"Can you try it on me now?"*).
  5. `RETURN_TO_PREVIOUS_VERSION` — Client prefers an earlier iteration (*"I liked the previous version better"*, *"Go back to V2"*).
  6. `FINALIZE_DESIGN` — Client and designer confirm the design is complete (*"This is the one, let's finalize it"*).

### 7.5 YouCam Virtual Try-On (`POST /s2s/v2.0/task/bag` & `POST /s2s/v2.0/task/cloth-v4`)

- **Step 1 & 2 (Asset Upload — Reused from `services/youcam/client.ts`):**
  - `POST https://yce-api-01.makeupar.com/s2s/v2.0/file` -> `PUT <presigned S3 URL>` for `personImage` (`src_file_id`) and `garmentImage` (`ref_file_id` = current `DesignVersion.imageUrl`).
- **Step 3 (Task Submission):**
  - For bag consultation designs (`taskKind === "bag"`):
    - `POST https://yce-api-01.makeupar.com/s2s/v2.0/task/bag`
    - Payload:
      ```json
      {
        "src_file_id": "<uploaded customer photo file_id>",
        "ref_file_id": "<uploaded Runway handbag render file_id>",
        "gender": "female",
        "style": "style_parisian_chic"
      }
      ```
  - Step 4 (Task Polling):
    - `GET https://yce-api-01.makeupar.com/s2s/v2.0/task/bag/{task_id}` every `1800ms`.
    - When `data.task_status === "success"`, downloads `data.results.url`, writes `data/results/look_<12hex>.jpg`, creates a `Look` record linked via `version.tryOnLookId`, and sets `consultation.activeViewMode = "tryon"`.

---

## 8. Phase 1 — Domain State, AI Decision Engine (Gemini + JEV) & Human-in-the-Loop UI

### Goal of Phase 1
Build the complete consultation data model, conversational aggregator/deduplicator, Gemini modification extractor, JEV consultation decision engine, Next.js API + SSE routes, and the Midnight Atelier consultation workspace UI. Verify the entire human-in-the-loop workflow (`[ Ignore ]`, `[ Edit ]`, `[ Apply ]`, `AUTO APPLY`, collapsible transcript, activity stream) with automated tests and simulated transcript events before adding Runway/YouCam/Playwright.

### Step-by-Step Implementation Breakdown
1. **Seed Asset & Env Config (`scripts/gen-consultation-seed.ts`, `lib/env.ts`):**
   - Generate a crisp `896×1200` (3:4 portrait) studio product image of the V1 burgundy structured leather shoulder bag with silver hardware at `public/catalog/consultation-bag-v1.png` using `sharp`.
   - Extend `lib/env.ts` and `.env.example` with consultation configuration.
2. **Types & Session Reducer (`lib/types.ts`, `lib/api-types.ts`, `lib/session/reducer.ts`):**
   - Add all consultation types and pure reducer functions.
   - Ensure `initConsultation` seeds `V1 Original` (`version: 1`, `label: "V1 Original"`, `designState: DEFAULT_BAG_DESIGN_STATE`) and logs `"Consultation started"`.
3. **Conversation Aggregator & Deduplicator (`lib/agent/consultation-aggregator.ts`):**
   - Implement text normalization, token Jaccard similarity (`>= 0.85`), `DesignFieldDiff` fingerprint hashing (`field:value|...`), redundant-field pruning (ignoring changes where `proposedValue === currentDesignState[field]`), and the `1800ms` conversational debounce collector.
4. **Gemini Extraction + JEV Decision (`services/gemini/consultation.ts`, `services/jev/client.ts`, `services/jev/fallback.ts`):**
   - Implement `extractConsultationCandidate(utterance, designState, versions)` with Gemini `gemini-3.8-flash` JSON mode and deterministic regex fallback.
   - Implement `decideConsultation(request, signals)` with JEV `systemOne` `choice` over the 6 `CONSULTATION_ACTIONS` and softmax deterministic fallback.
5. **Orchestrator, SSE Bus & Next.js API Routes (`lib/agent/consultation-orchestrator.ts`, `lib/server/consultation-events.ts`, `app/api/sessions/[id]/consultation/**`):**
   - Wire `processConsultationUtterance(sessionId, text, options)` under `mutateSession()`.
   - Implement `/consultation`, `/consultation/end`, `/consultation/events` (SSE), `/consultation/transcript`, `/consultation/suggestions/[suggestionId]`, and `/consultation/versions/[versionId]/restore`.
6. **Editorial UI Components (`components/consultation/*`, `Masthead.tsx`, `FittingRoom.tsx`, `DresslyApp.tsx`):**
   - Build `ConsultationSetupModal.tsx` (explicit listening consent notice, Option A new Meet helper, Option B existing Meet URL input, external Google Meet PiP guidance with `Open Meet` and `Copy Meet Link`).
   - Build `SuggestionCard.tsx` (`MEETING` quote, `HARDWARE: Silver → Gold` diff rows, confidence percentage, `[ Ignore ]`, `[ Edit ]` inline parameter editor, `[ Apply ]`).
   - Build `ConsultationPanel.tsx` (status indicator `● DRESSLY IS LISTENING`, `AUTO APPLY ○/●`, `AUTO TRY-ON ○/●`, pending suggestion stack, timestamped Design Activity stream, collapsible `View transcript` drawer, and `[ End Consultation ]`).
   - Build `DesignVersionStrip.tsx` (`V1 Original`, `V2 Gold hardware`, etc., with `Inspect`, `Compare` slider, `Restore`, and `Try this version`).

### Phase 1 Verification
- `npm run typecheck` passes with zero errors.
- Unit tests `tests/consultation-reducer.test.ts` and `tests/consultation-aggregator.test.ts` verify:
  - Split sentences (*"Let's make it smaller…"* + *"…and perhaps use gold hardware"*) merge into one `ProposedDesignChange` (`size: small`, `hardwareColor: gold`).
  - Near-duplicate phrases (*"make the strap longer"* and *"yeah, make that strap longer"*) produce only one pending suggestion.
  - Irrelevant speech (*"How was your weekend?"*, *"Can you hear me?"*, *"I like coffee"*) resolves to `IGNORE` and creates zero suggestions.
  - `[ Ignore ]`, `[ Edit ]` (`"dark brown"` → `"espresso brown"`), and `[ Apply ]` transition `BagDesignState` accurately.

---

## 9. Phase 2 — Iterative Design Generation (`nano_banana_2.1`) & YouCam Virtual Try-On Loop

### Goal of Phase 2
Connect human-approved modifications (`[ Apply ]`, `[ Apply Edited ]`, or `AUTO APPLY ●`) to the existing Runway integration using `model: "nano_banana_2.1"` with reference-image preservation (`@latest_design` + `@original_design`), create restorable `DesignVersion` records (`V1 → V2 → V3 → V4`), and wire the resulting product renders into YouCam Virtual Try-On (`[ Try this version ]`, `AUTO TRY-ON ●`, and JEV's `TRY_ON_CURRENT_DESIGN`).

### Step-by-Step Implementation Breakdown
1. **Programmatic Prompt Builder (`lib/agent/consultation-prompt.ts`):**
   - Implement `buildNanoBananaPrompt({ currentState, previousState, changes, hasOriginalReference, highResFinal })`.
   - Explicitly lists:
     - `CURRENT PRODUCT`: Full canonical description of the bag post-change.
     - `REQUESTED MODIFICATION`: Exact field-by-field diff (`change hardwareColor from "silver" to "gold"`).
     - `STRICT PRESERVATION CONSTRAINTS`: Every unchanged attribute (`silhouette`, `size`, `primaryColor`, `material`, `texture`, `strapType`, `closure`, `structure`) that must match `@latest_design` (and `@original_design`).
     - `OUTPUT FORMAT`: Isolated ecommerce studio photograph, neutral background, front three-quarter view, no hands, no model, no text, no watermark.
2. **Runway `nano_banana_2.1` Client Extension (`services/runway/contract.ts`, `services/runway/client.ts`, `services/runway/index.ts`):**
   - Add `submitImage(request: RunwayImageRequest): Promise<RunwayHandle>` calling `POST /v1/text_to_image` with `X-Runway-Version: "2024-11-06"`.
   - Encode the current `DesignVersion.imageUrl` via `readMediaBytes()` / `readPublicAsset()` as a `data:image/png;base64,...` URI with `tag: "latest_design"`.
   - When generating `V3+` (where `currentDesignVersionId !== originalVersionId`), also include `V1`'s image with `tag: "original_design"` so silhouette and framing never drift across iterations.
   - Add `pollImage(handle: RunwayHandle): Promise<RunwayImageState>` reusing `GET /v1/tasks/{id}` to download `output[0]` into a `Buffer`.
   - Implement `mockRunwayImageEngine` (active only when `DRESSLY_MOCK_EXTERNAL_APIS=true`) using `sharp` to render a realistic color/hardware/size/strap-accurate studio handbag PNG for deterministic offline tests.
3. **Consultation Runway Orchestrator (`lib/agent/consultation-runway.ts`):**
   - `startConsultationDesignJob(session, suggestion, options)` submits to Runway `nano_banana_2.1`, creates an `AgentJob` (`kind: "consultation_design"`), sets `consultation.status = "GENERATING_DESIGN"`, and emits `design.generation.started`.
   - `pollConsultationDesignJob(jobId)` polls Runway, saves the resulting PNG to `data/results/design_${versionId}.png`, appends the new `DesignVersion` (`V2`, `V3`, `V4`), logs `"V2 ready"` in the activity stream, emits `design.generation.completed`, and — if `consultation.autoTryOn === true` and `session.userPhotoPath` exists — automatically starts `startConsultationTryOnJob()`.
4. **Consultation YouCam VTO Orchestrator (`services/youcam/client.ts`, `lib/agent/consultation-tryon.ts`):**
   - Extend `services/youcam/client.ts` to support `POST /s2s/v2.0/task/bag` and `GET /s2s/v2.0/task/bag/{id}` alongside `cloth-v4`.
   - `startConsultationTryOnJob(session, versionId)` reads the customer photo (`activeLook?.imagePath ?? session.userPhotoPath`) and the target `DesignVersion.imageUrl`, submits to YouCam, creates an `AgentJob` (`kind: "consultation_tryon"`), and emits `vto.started`.
   - `pollConsultationTryOnJob(jobId)` writes the VTO image to `data/results/look_${lookId}.jpg`, records a `Look` on the session, links `version.tryOnLookId = look.id`, switches `activeViewMode = "tryon"`, and emits `vto.completed`.
   - If YouCam returns an upstream capability error on `/s2s/v2.0/task/bag`, catches `ProviderError`, preserves the Runway `DesignVersion`, places the bag in `session.currentLook.accessories`, and returns an honest `BlockedView` (`code: "BAG_VTO_UNAVAILABLE"`).

### Phase 2 Verification
- `tests/consultation-prompt.test.ts` and `tests/consultation-orchestrator.test.ts` verify:
  - Prompt generation includes exact diff, preservation constraints, `@latest_design`, and `@original_design` tags.
  - `V1 → V2 → V3 → V4` version creation, inspection, and restoration (restoring `V2` makes `V2` the `@latest_design` reference for the next generation).
  - Voice command *"Can I see how that looks on me?"* triggers JEV `TRY_ON_CURRENT_DESIGN` and starts YouCam VTO.

---

## 10. Phase 3 — Isolated Playwright Meeting Bot Worker & Replaceable Audio Capture Pipeline

### Goal of Phase 3
Implement the standalone Playwright + Chromium meeting bot worker (`services/meeting-bot/worker.ts`), the replaceable `ConsultationAudioSource` abstraction (`ChromeMeetAudioSource` + `MeetingAudioCapture`), and the worker-to-Gemini Live `16 kHz PCM` streaming client so Dressly can join a real Google Meet call visibly as **`Dressly AI Assistant`**, wait for host admission, capture meeting audio output, stream live transcriptions into Dressly, reconnect on transient drops, and clean up all resources on exit.

### Step-by-Step Implementation Breakdown
1. **Install `playwright-core` & Binary Resolver (`package.json`, `services/meeting-bot/playwright-bot.ts`):**
   - Add `playwright-core` and resolve the Chromium executable automatically across environments:
     1. `process.env.CHROMIUM_EXECUTABLE_PATH` (Docker/custom Linux path)
     2. Pre-installed Playwright cache (`%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe` or `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`)
     3. System Google Chrome (`/usr/bin/google-chrome`, `/usr/bin/chromium-browser`, `C:\Program Files\Google\Chrome\Application\chrome.exe`).
   - Support persistent browser profile directory (`MEETING_BOT_PROFILE_DIR`, default `data/bot-profile`) so a Google account can be authenticated once manually when Google Meet requires sign-in.
2. **Replaceable Audio Source & Capture (`services/meeting-bot/audio-source.ts`, `services/meeting-bot/audio-capture.ts`):**
   - Define `ConsultationAudioSource` interface (`start()`, `stop()`, `onAudioChunk()`, `onStatusChange()`).
   - Implement `ChromeMeetAudioSource` supporting:
     - **WebRTC / MediaStream Output Tap (`webrtc-tap`):** Injects an `AudioContext({ sampleRate: 16000 })` + `AudioWorkletProcessor` into the bot's Chromium page that intercepts remote WebRTC audio tracks and `<audio>`/`<video>` elements inside Google Meet, downsamples to `16 kHz mono s16le PCM`, and forwards chunks via `page.exposeBinding("__dresslyPushAudioChunk")`.
     - **Linux / Docker Virtual Audio Sink (`pulseaudio`):** Creates `module-null-sink` (`dressly_meet_<sessionId>`), routes Chromium audio output to that sink, and spawns `ffmpeg -f pulse -i dressly_meet_<sessionId>.monitor -ac 1 -ar 16000 -f s16le pipe:1`.
3. **Google Meet Join & Lifecycle Controller (`services/meeting-bot/playwright-bot.ts`):**
   - Opens `meetingUrl` with camera and microphone muted (`--use-fake-device-for-media-stream`, WebRTC outgoing audio/video muted, and Meet pre-join mic/camera buttons toggled off).
   - Fills `"Dressly AI Assistant"` into the Google Meet name input and clicks `"Ask to join"` / `"Join now"`.
   - Detects lobby state (`WAITING_FOR_ADMISSION`), active call state (`JOINED` → `LISTENING`), and call ended/removed state.
   - Implements bounded reconnection (`RECONNECTING`, max `2` retries with `3s` / `6s` backoff) before reporting `FAILED` (`"Dressly left the consultation"`).
4. **Worker-Side Gemini Live Audio Client (`services/meeting-bot/gemini-stream.ts`):**
   - Opens a server-to-server WebSocket to `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${env.geminiApiKey}` using `env.geminiLiveModel` (`gemini-3.8-live`).
   - Streams `16 kHz mono PCM` chunks from `ConsultationAudioSource` as `realtimeInput.audio` (`mimeType: "audio/pcm;rate=16000"`).
   - Emits partial and finalized `inputTranscription` segments back to Next.js via `POST /api/sessions/[id]/consultation/bot-event` (and `/transcript`), without writing raw audio to disk.
5. **Standalone Worker Server & Process Cleanup (`services/meeting-bot/worker.ts`):**
   - Exposes the internal HTTP API on `MEETING_BOT_PORT` (`4100`), protected by `X-Meeting-Bot-Secret`.
   - Ensures `stopSession()` and process signal handlers (`SIGINT`, `SIGTERM`, `uncaughtException`, session timeout) always close the Gemini WebSocket, terminate `ffmpeg` / unload any PulseAudio sink, leave the Google Meet call, and close the Playwright Chromium context.

### Phase 3 Verification
- Start the worker (`npm run bot:worker`) and verify `GET http://127.0.0.1:4100/bot/health` reports `ok: true`, `chromiumFound: true`, `ffmpegFound: true`.
- Run `POST /bot/diagnostics/audio` to verify `ChromeMeetAudioSource` emits valid `16 kHz mono s16le PCM` chunks and streams them cleanly.
- Verify `End Consultation` terminates the Chromium browser context with zero orphan processes.

---

## 11. Phase 4 — Flagship Demo Scenario, Dev Diagnostics, Failure Isolation & Documentation

### Goal of Phase 4
Deliver `DRESSLY_CONSULTATION_DEMO_MODE=true`, the layer-by-layer developer diagnostic drawer (`ConsultationDiagnostics.tsx`), full failure isolation across all external services, end-to-end verification of the flagship 4-step handbag scenario, and updated `README.md` documentation.

### Step-by-Step Implementation Breakdown
1. **Flagship Demo Mode (`DRESSLY_CONSULTATION_DEMO_MODE=true`):**
   - Preloads the V1 burgundy structured leather shoulder bag (`public/catalog/consultation-bag-v1.png`) and starter canonical `BagDesignState` (`medium`, `burgundy`, `silver` hardware, `shoulder` strap).
   - If the session does not yet have a customer photo uploaded, offers a one-click starter model portrait or uses the uploaded photo while keeping **all AI providers real** (Gemini, JEV, Runway `nano_banana_2.1`, YouCam).
2. **Developer & Demo Diagnostic Toolkit (`components/consultation/ConsultationDiagnostics.tsx` & `/api/sessions/[id]/consultation/diagnostics`):**
   - Collapsible luxury-styled diagnostic bar at the bottom of the consultation panel providing independent layer tests:
     - **Quick Demo Utterance Buttons (Real Gemini + JEV + Runway + YouCam):**
       1. *"I like it, but can we make the hardware gold?"* (`V1 → V2`)
       2. *"That's better. Maybe make it a little smaller."* (`V2 → V3`)
       3. *"Could we make the strap longer so I can wear it crossbody?"* (`V3 → V4`)
       4. *"Can I see how that looks on me?"* (`V4 → YouCam VTO`)
       5. *"How was your weekend? Can you hear me?"* (Verifies `IGNORE`)
     - **Layer-by-Layer Controls:**
       - `Test Bot Join` / `Reconnect Bot`
       - `Test Audio Capture (16kHz PCM)`
       - `Test Gemini Live Audio Stream`
       - `Simulate Custom Transcript Event`
       - `Simulate Pending Suggestion`
       - `Test Runway Nano Banana 2.1 Revision`
       - `Test YouCam VTO with Current Design`
3. **Structured Observability & Logging (`lib/server/consultation-logger.ts`):**
   - Emits structured JSON server logs for every milestone required by the specification:
     `consultation started`, `bot launched`, `meet loaded`, `bot admitted`, `audio capture started`, `Gemini connected`, `suggestion detected`, `suggestion approved`, `Runway generation started`, `Runway completed`, `YouCam started`, `YouCam completed`, `consultation ended` — never logging API keys or raw audio bytes.
4. **Comprehensive Documentation (`README.md` & `.env.example`):**
   - Document architecture diagram, required dependencies, Chromium/Playwright setup, persistent Google Meet profile login, Linux/Docker PulseAudio/PipeWire & cross-platform WebRTC audio capture, environment variables, how to start the worker (`npm run bot:worker`) alongside Next.js (`npm run dev`), how to test each layer, browser automation limitations, and how `ConsultationAudioSource` enables a future official Google Meet Media API drop-in replacement.

---

## 12. Environment Variables Reference

All variables are read exclusively on the server in `lib/env.ts` and documented in `.env.example`:

| Variable | Default | Required For | Description |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | — | Real Gemini | Used for both `gemini-3.8-flash` extraction and `gemini-3.8-live` audio transcription. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Real Gemini | Model for structured consultation intent & modification extraction. |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Real Gemini Live | Model for real-time meeting audio transcription. |
| `TYPESAFE_API_KEY` | — | Real JEV | API key for `@typesafe-ai/sdk` SystemOne decision engine. |
| `JEV_MODEL` | `jev-1.13.0` | Real JEV | JEV model evaluating the 6 `CONSULTATION_ACTIONS`. |
| `RUNWAY_API_KEY` | — | Real Runway | Bearer token for `https://api.dev.runwayml.com`. |
| `RUNWAY_ENABLED` | `true` | Real Runway | Enables Runway video and `nano_banana_2.1` image generation. |
| `RUNWAY_IMAGE_MODEL` | `nano_banana_2.1` | Consultation | Runway `POST /v1/text_to_image` model used for iterative product design. |
| `RUNWAY_IMAGE_RATIO` | `896:1200` | Consultation | 3:4 portrait resolution for consultation design iterations (`1792:2400` for high-res finalize). |
| `YOUCAM_API_KEY` | — | Real YouCam | Bearer token for `https://yce-api-01.makeupar.com`. |
| `DRESSLY_CONSULTATION_DEMO_MODE` | `false` | Hackathon Demo | Preloads the V1 burgundy shoulder bag & demo helpers while calling real Gemini, JEV, Runway, and YouCam. |
| `CONSULTATION_AUTO_APPLY_THRESHOLD` | `0.90` | Auto Apply | Minimum confidence (`0..1`) required when `AUTO APPLY ●` is toggled on. |
| `MEETING_BOT_PORT` | `4100` | Bot Worker | Port for the isolated Playwright meeting-bot worker (`services/meeting-bot/worker.ts`). |
| `MEETING_BOT_URL` | `http://127.0.0.1:4100` | Next.js Server | Internal URL where Next.js reaches the meeting-bot worker. |
| `MEETING_BOT_SECRET` | `dressly-local-bot-secret` | Security | Shared secret header (`X-Meeting-Bot-Secret`) authenticating Next.js ↔ Bot Worker calls. |
| `MEETING_BOT_PROFILE_DIR` | `data/bot-profile` | Google Meet Auth | Optional persistent Chromium user-data directory for pre-authenticated Google Meet sessions. |
| `MEETING_AUDIO_BACKEND` | `auto` | Audio Capture | `"auto"` (`webrtc-tap` cross-platform, or `pulseaudio` on Linux when sink is active), `"webrtc-tap"`, or `"pulseaudio"`. |
| `CHROMIUM_EXECUTABLE_PATH` | *(auto-detected)* | Bot Worker | Optional override path to Chromium/Chrome binary. |
| `FFMPEG_PATH` | *(auto-detected)* | Audio Capture | Optional override path to `ffmpeg` binary. |

---

## 13. Definition of Done Checklist (25 Criteria)

- [ ] **1.** Dressly can start a Live Consultation from the main workspace (`Start Consultation` / `Live Consultation`) with explicit listening consent.
- [ ] **2.** A Google Meet URL can be created (Option A) or supplied (Option B) with external Picture-in-Picture guidance (`Open Meet`, `Copy Meet Link`).
- [ ] **3.** An isolated Playwright/Chromium Dressly bot worker joins the meeting independently from the user's browser.
- [ ] **4.** The bot is visibly identified as **`Dressly AI Assistant`** with camera and microphone muted.
- [ ] **5.** The host can manually admit the bot when Google Meet requires lobby approval (`Waiting for host approval...`).
- [ ] **6.** Dressly captures the browser's meeting audio output (never the host machine's physical microphone) behind `ConsultationAudioSource`.
- [ ] **7.** Gemini Live receives the `16 kHz mono PCM` audio stream.
- [ ] **8.** Dressly displays live/final transcript events with neutral `MEETING` attribution.
- [ ] **9.** Actionable fashion design requests are detected and aggregated across short conversational pauses.
- [ ] **10.** Irrelevant conversation (*"How was your weekend?"*, *"Can you hear me?"*) is ignored and deduplicated.
- [ ] **11.** JEV evaluates the appropriate action (`IGNORE`, `PROPOSE_CHANGE`, `ASK_CLARIFICATION`, `TRY_ON_CURRENT_DESIGN`, `RETURN_TO_PREVIOUS_VERSION`, `FINALIZE_DESIGN`).
- [ ] **12.** A structured `ProposedDesignChange` is proposed with field diffs and confidence score.
- [ ] **13.** The designer can **Ignore**, **Edit** (modifying interpreted parameters inline), or **Apply** it (plus optional `AUTO APPLY ●`).
- [ ] **14.** Applying updates the canonical `BagDesignState`.
- [ ] **15.** Runway `nano_banana_2.1` (`POST /v1/text_to_image`) generates the revised product using `@latest_design` and `@original_design` reference images.
- [ ] **16.** Unrequested product characteristics (silhouette, material, framing, studio background) are preserved via programmatic prompt constraints and dual reference anchoring.
- [ ] **17.** Each approved generation creates a `DesignVersion` (`V1 Original`, `V2 Gold hardware`, `V3 Smaller silhouette`, `V4 Crossbody strap`).
- [ ] **18.** Versions can be inspected, compared (`BeforeAfter`), and restored as the active canonical state and Runway reference.
- [ ] **19.** The resulting isolated product render can be passed to YouCam (`Try this version`, `AUTO TRY-ON ●`, or spoken `"Can I see how that looks on me?"`).
- [ ] **20.** The customer can see the new version through YouCam VTO (with honest capability handling if bag VTO is restricted).
- [ ] **21.** The conversation can continue and repeat this loop across multiple iterations.
- [ ] **22.** Ending the consultation (`End Consultation`) cleanly terminates Chromium, audio capture, and Gemini Live resources with zero orphan processes.
- [ ] **23.** Existing Dressly AI Stylist functionality continues to work with all existing tests passing.
- [ ] **24.** Existing Dressly Midnight Atelier luxury editorial visual identity and Shaders.com transitions are preserved.
- [ ] **25.** Live Consultation feels native to Dressly rather than a separate bolted-on application.
