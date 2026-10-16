# Feature: Dressly Live Consultation

Locator: `odd/tasks/live-consultation.md` · Engram mirror `odd/live-consultation/tasks`: **PENDING**
(no Engram MCP server is available in this runtime).

## Objective

Implement **Dressly Live Consultation** across 4 structured phases (`docs/LIVE_CONSULTATION_PLAN.md`) so Dressly can participate in a live Google Meet consultation between a designer/stylist and a customer, detect actionable garment/accessory modifications via Gemini + JEV, require human-in-the-loop approval (`[Ignore] [Edit] [Apply]`), generate iterative product revisions with Runway `nano_banana_2.1` reference images, and visualize results with YouCam Virtual Try-On.

## Problem & Why

- Existing Dressly provides an AI Personal Stylist for individual shoppers.
- Live Design Consultation extends Dressly to collaborative designer-client consultations over Google Meet: *"Dressly doesn't replace the designer. Dressly gives the designer an AI creative assistant that listens, understands, generates and visualizes ideas in real time."* (**Style it. Design it. Try it.**)

## Scope & Constraints

- **Authorized Scope:** Phases 1 and 2 complete; currently executing **Phase 3** (Isolated Playwright Meeting Bot Worker & Replaceable Audio Capture Pipeline). Phase 4 remains tracked for subsequent execution.
- **Constraints:**
  - Preserve existing AI Stylist functionality and Midnight Atelier visual identity (`#0b0a09`, Didot/Optima, `.glass`, `shaders/react`).
  - Do not duplicate Gemini, JEV, Runway, or YouCam clients; extend existing services cleanly.
  - Neutral `MEETING` speaker attribution unless verified diarization is present.
  - Human-in-the-loop approval is mandatory by default (`AUTO APPLY` defaults to `OFF`).
  - **TDD:** `off` (inherited from `odd/tasks/gemini-live-stylist.md`; no project/session TDD configuration).
  - **Test Runner & Checks:** `npm run typecheck` (`tsc --noEmit`), `npm test` (`node --no-warnings --experimental-strip-types --import ./scripts/register.mjs --test "tests/*.test.ts"`).
  - **RDD:** `disabled/unmanaged` (`gentle-ai review mode status` -> `off (decided by global)`).
  - **Delivery Strategy:** `ask-on-risk` (forecast ~1,800 authored lines across 4 phases; work-unit commits on `feat/dressly-mvp`, no push/PR without user instruction).

## Tasks Checklist

### Phase 1 — Domain State, AI Decision Engine (Gemini + JEV) & Human-in-the-Loop UI
- [x] **C1.1** Seed V1 canonical handbag asset (`scripts/gen-consultation-seed.ts` -> `public/catalog/consultation-bag-v1.png`), extend `lib/env.ts` & `.env.example`, and add domain/wire types (`lib/types.ts`, `lib/api-types.ts`) + pure session reducers (`lib/session/reducer.ts`) + unit tests (`tests/consultation-reducer.test.ts`).
  - Route: `delegated` (writer trigger: touches 6+ files). Commit: `ed1a17b` (`npm run typecheck` clean; `npm test` 41/41). RDD: `disabled/unmanaged`.
- [x] **C1.2** Implement conversational aggregator & deduplicator (`lib/agent/consultation-aggregator.ts`), Gemini fashion modification extractor (`services/gemini/consultation.ts`), JEV consultation decision evaluator (`services/jev/client.ts`, `services/jev/fallback.ts`, `services/jev/index.ts`), SSE event bus (`lib/server/consultation-events.ts`), consultation orchestrator (`lib/agent/consultation-orchestrator.ts`), API routes (`app/api/sessions/[id]/consultation/**`), and unit tests (`tests/consultation-aggregator.test.ts`).
  - Route: `delegated` (writer trigger: touches 8+ non-trivial files). Commit: `115f2ad` (`npm run typecheck` clean; `npm test` 47/47). RDD: `disabled/unmanaged`.
- [x] **C1.3** Build Midnight Atelier Consultation UI (`components/consultation/ConsultationSetupModal.tsx`, `SuggestionCard.tsx`, `ConsultationPanel.tsx`, `DesignVersionStrip.tsx`, `lib/client/use-consultation-events.ts`, `lib/client/api.ts`) and integrate into `Masthead.tsx`, `FittingRoom.tsx`, and `DresslyApp.tsx`.
  - Route: `delegated` (writer trigger: touches 8+ UI/client files). Commit: `0399027` (`npm run typecheck` clean; `npm test` 47/47; `npm run build` clean). RDD: `disabled/unmanaged`.

### Phase 2 — Iterative Design Generation (`nano_banana_2.1`) & YouCam Virtual Try-On Loop
- [x] **C2.1** Programmatic drift-controlled prompt builder (`lib/agent/consultation-prompt.ts`), Runway `POST /v1/text_to_image` (`nano_banana_2.1`) client extension (`services/runway/contract.ts`, `services/runway/client.ts`, `services/runway/index.ts`), async design job orchestrator (`lib/agent/consultation-runway.ts`, `lib/agent/jobs.ts`), and unit tests (`tests/consultation-prompt.test.ts`).
  - Route: `delegated` (writer trigger: touches 6+ files). Commit: `0087f34` (`npm run typecheck` clean; `npm test` 51/51). RDD: `disabled/unmanaged`.
- [x] **C2.2** YouCam `POST /s2s/v2.0/task/bag` extension (`services/contracts.ts`, `services/youcam/client.ts`, `services/youcam/mock.ts`), consultation VTO orchestrator (`lib/agent/consultation-tryon.ts`), job polling & retry routes (`app/api/sessions/[id]/consultation/tryon/route.ts`, `app/api/jobs/[id]/route.ts`, `app/api/jobs/[id]/retry/route.ts`), orchestrator & UI wiring (`lib/agent/consultation-orchestrator.ts`, `components/DresslyApp.tsx`), and end-to-end Phase 2 tests (`tests/consultation-orchestrator.test.ts`).
  - Route: `delegated` (writer trigger: touches 8+ files). Commit: `104b176` (`npm run typecheck` clean; `npm test` 53/53; `npm run build` clean). RDD: `disabled/unmanaged`.

### Phase 3 — Isolated Playwright Meeting Bot Worker & Replaceable Audio Capture Pipeline
- [x] **C3.1** Replaceable `ConsultationAudioSource` abstraction + `ChromeMeetAudioSource` / `MeetingAudioCapture` (`services/meeting-bot/contract.ts`, `services/meeting-bot/audio-source.ts`, `services/meeting-bot/audio-capture.ts`) and worker-side Gemini Live 16kHz PCM audio stream (`services/meeting-bot/gemini-stream.ts`).
  - Route: `delegated` (writer trigger: touches 4+ non-trivial files). Commit: `fc218ac` (`npm run typecheck` clean; `npm test` 53/53). RDD: `disabled/unmanaged`.
- [x] **C3.2** Install `playwright-core`, implement Playwright + Chromium Google Meet bot controller (`services/meeting-bot/playwright-bot.ts`), standalone HTTP worker (`services/meeting-bot/worker.ts`), Next.js bot client (`services/meeting-bot/client.ts`), webhook route (`app/api/sessions/[id]/consultation/bot-event/route.ts`), orchestrator lifecycle wiring, and Phase 3 tests (`tests/meeting-bot.test.ts`).
  - Route: `delegated` (writer trigger: touches 7+ files). Commit: `e8971c9` (`npm run typecheck` clean; `npm test` 58/58; `npm run build` clean). RDD: `disabled/unmanaged`.

### Phase 4 — Flagship Demo Scenario, Dev Diagnostics, Resilience & Documentation
- [ ] **C4.1** `DRESSLY_CONSULTATION_DEMO_MODE`, `ConsultationDiagnostics.tsx`, structured logging (`lib/server/consultation-logger.ts`), end-to-end flagship scenario tests, and `README.md` documentation.
  - Route: `delegated` (pending Phase 4 authorization).

## Acceptance Criteria (Phase 1)

- Starting a consultation requires explicit listening consent and accepts a Google Meet URL (or new Meet creation helper) with external Picture-in-Picture guidance (`Open Meet`, `Copy Meet Link`).
- Utterances separated by a short pause aggregate into a single proposal; near-duplicate transcripts and redundant state edits are deduplicated.
- Gemini extracts structured `DesignFieldDiff[]` from fashion speech and marks small talk / audio checks as irrelevant.
- JEV evaluates `CONSULTATION_ACTIONS` (`IGNORE`, `PROPOSE_CHANGE`, `ASK_CLARIFICATION`, `TRY_ON_CURRENT_DESIGN`, `RETURN_TO_PREVIOUS_VERSION`, `FINALIZE_DESIGN`) and records a `DecisionRecord`.
- Designer can **Ignore**, **Edit** (modifying parameters inline), or **Apply** a `ProposedDesignChange` (or toggle `AUTO APPLY ●`), updating canonical `BagDesignState`, version history (`V1`, `V2`, ...), activity stream, and collapsible `MEETING` transcript.
- `npm run typecheck` and `npm test` pass with zero errors.

## Progress & Verification Evidence

- Feature document created prior to first source write.
- **C1.1** completed in commit `ed1a17b` (`npm run typecheck` 0 errors, `npm test` 41/41 passing, `public/catalog/consultation-bag-v1.png` generated). RDD: `disabled/unmanaged`.
- **C1.2** completed in commit `115f2ad` (`npm run typecheck` 0 errors, `npm test` 47/47 passing). RDD: `disabled/unmanaged`.
- **C1.3** completed in commit `0399027` (`npm run typecheck` 0 errors, `npm test` 47/47 passing, `npm run build` clean). RDD: `disabled/unmanaged`.
- **C2.1** completed in commit `0087f34` (`npm run typecheck` 0 errors, `npm test` 51/51 passing). RDD: `disabled/unmanaged`.
- **C2.2** completed in commit `104b176` (`npm run typecheck` 0 errors, `npm test` 53/53 passing, `npm run build` clean). RDD: `disabled/unmanaged`.
- **C3.1** completed in commit `fc218ac` (`npm run typecheck` 0 errors, `npm test` 53/53 passing). RDD: `disabled/unmanaged`.
- **C3.2** completed in commit `e8971c9` (`npm run typecheck` 0 errors, `npm test` 58/58 passing, `npm run build` clean). RDD: `disabled/unmanaged`.
- **Phase 3 Status:** Complete. Next step: Await user authorization to begin **Phase 4 (C4.1)**.
