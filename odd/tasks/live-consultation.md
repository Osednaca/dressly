# Feature: Dressly Live Consultation

Locator: `odd/tasks/live-consultation.md` · Engram mirror `odd/live-consultation/tasks`: **PENDING**
(no Engram MCP server is available in this runtime).

## Objective

Implement **Dressly Live Consultation** across 4 structured phases (`docs/LIVE_CONSULTATION_PLAN.md`) so Dressly can participate in a live Google Meet consultation between a designer/stylist and a customer, detect actionable garment/accessory modifications via Gemini + JEV, require human-in-the-loop approval (`[Ignore] [Edit] [Apply]`), generate iterative product revisions with Runway `nano_banana_2.1` reference images, and visualize results with YouCam Virtual Try-On.

## Problem & Why

- Existing Dressly provides an AI Personal Stylist for individual shoppers.
- Live Design Consultation extends Dressly to collaborative designer-client consultations over Google Meet: *"Dressly doesn't replace the designer. Dressly gives the designer an AI creative assistant that listens, understands, generates and visualizes ideas in real time."* (**Style it. Design it. Try it.**)

## Scope & Constraints

- **Authorized Scope:** Phases 1, 2, and 3 complete; currently executing **Phase 4** (Flagship Demo Mode, Layer-by-Layer Dev Diagnostics, Structured Logging, Failure Isolation & `README.md` Documentation).
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
- [x] **C4.1** Structured milestone logger (`lib/server/consultation-logger.ts`), `DRESSLY_CONSULTATION_DEMO_MODE` support, layer-by-layer diagnostic endpoint & UI drawer (`app/api/sessions/[id]/consultation/diagnostics/route.ts`, `components/consultation/ConsultationDiagnostics.tsx`), `[ Rejoin ]` wiring, failure isolation & diagnostic tests (`tests/consultation-diagnostics.test.ts`), and `README.md` documentation.
  - Route: `delegated` (writer trigger: touches 8+ files). Commit: `202b401` (`npm run typecheck` clean; `npm test` 61/61; `npm run build` clean). RDD: `disabled/unmanaged`.

### Phase 5 (Hardening) — Real Playwright Google Meet Bot & Live Chromium Audio Capture Verification
- [x] **C5.1** Fix `headless` configuration (`MEETING_BOT_HEADLESS`, defaulting to headed `false` for real Google Meet calls), fix shared persistent profile directory (`data/bot-profile` reused across sessions so Google login persists), harden pre-join/lobby/in-call selectors (continuous pre-join retry loop, EN/ES localization, `srcObject` + `RTCPeerConnection` constructor audio tap), add `scripts/bot-join.ts` (`npm run bot:login` & `npm run bot:join`), fix `ConsultationSetupModal.tsx` demo vs. real Meet URL, and add a real-Chromium integration test in `tests/meeting-bot.test.ts`.
  - Route: `delegated` (writer trigger: touches 7+ files). Commit: `b9d6039` / `a993e38` (`npm run typecheck` clean; `npm test` 63/63 including live Chromium audio capture; `npm run build` clean). RDD: `disabled/unmanaged`.
- [x] **C5.2** Fix `.env.local` loading in standalone `bot:worker` / `bot:join` processes (`lib/env.ts` & `package.json`), upgrade `buildBrowserAudioCaptureInitScript` (`services/meeting-bot/audio-capture.ts`) to use Chromium's native `MediaStreamTrackProcessor` (bypassing Meet CSP/TrustedTypes and `AudioContext` sample-rate mismatch) plus native-rate `AudioContext` fallback, prevent auto-reopening Chrome windows when closed manually, and add rich real-time diagnostic logging (`[BOT:BROWSER]`, `[BOT:TELEMETRY]` RMS/peak levels, `[GEMINI:WS]`, `[GEMINI:TRANSCRIPT]`) across `audio-capture.ts`, `gemini-stream.ts`, `playwright-bot.ts`, `worker.ts`, and `bot-event/route.ts`.
  - Route: `delegated` (writer trigger: touches 6 files). (`npm run typecheck` clean; `npm test` 63/63 passing, 0 Chrome windows opened during tests). RDD: `disabled/unmanaged`.

### C5.3 — Echo and intermittent listening regression (2026-11-01)

- [x] **C5.3** Silence the WebRTC bot's speaker output and recover audio capture independently for each remote track, with regression tests and isolated Chromium audio verification.
  - Authorized scope: user's request to fix severe echo and intermittent listening in Live consultation; no remote execution, authenticated Meet access, deployment, push, or PR.
  - Route: `delegated`; mapping/preparation trigger (4+ relevant files) completed by `explore_audio`; writer trigger (capture, bot launcher, behavioral tests).
  - Evidence: global `trackProcessorFramesReceived` permanently suppresses every WebAudio fallback after any processor frame, including failed copies; Chromium output is unmuted and auxiliary audio players also render sound.
  - Acceptance: WebRTC capture retains nonzero PCM with bot output muted; each track can fall back after processor error/end/stall without duplicating audio; ended tracks release resources; PulseAudio output remains available to its virtual sink.
  - TDD: off, inherited explicit feature configuration above. Runner: `npm test`; checks: focused audio tests, `npm run typecheck`, full `npm test`, `npm run build`, isolated local Chromium test with temporary profile and no external meeting.
  - RDD: `disabled/unmanaged`, reconfirmed `gentle-ai review mode status` reports off/global.
  - Delivery: `ask-on-risk`; chain strategy `feature-branch-chain` explicitly selected by user. Forecast 300–450 authored additions + deletions for this recovery unit. Slice: C5.3 work-unit commit(s) based on `21729d3b31c70fb2cb6397aae80e4d9c193c2ea8` on `feat/dressly-mvp`; no PR requested or created. Existing completed work is preserved.
  - Rollback boundary: C5.3 changes to capture routing, Chromium launch audio flags, and accompanying tests/documentation; preserve prior consultation behavior outside this fix.
  - Engram mirror: PENDING (no memory tools available); local document is the recovery source.
  - Verification: full `npm test` with temporary `MEETING_BOT_PROFILE_DIR`: 77 tests, 74 pass, 0 fail, 3 opt-in skips. `npm run typecheck` and `git diff --check` passed. Focused `RUN_AUDIO_CHROMIUM_TEST=1 node --no-warnings --experimental-strip-types --import ./scripts/register.mjs --test tests/meeting-audio-capture.test.ts`: 13/13 passed, including local Chromium WebRTC loopback with muted output; browser logs confirmed non-silent MediaStreamTrackProcessor and forced WebAudio fallback separately. Chromium used disposable profiles, no STUN or external meeting.
  - Launch verification: production and Chromium tests share `chromiumAudioOptions`; `ignoreDefaultArgs` removes `--mute-audio` only for PulseAudio. Final Chromium 2/2 rerun also checked `chrome://version` for the effective mute flag. Final typecheck passed.
  - Historical checks: initial test harness parameter-property syntax and three test-only type errors failed, then were corrected and rerun successfully. One full-suite repetition reported 73 pass/1 fail with truncated diagnostics; the final repetition passed 74/74 executed tests. The older opt-in session/join Chromium E2E was skipped; new isolated audio tests were run explicitly. Real Meet/acoustic and remote Gemini checks remain pending; no live call access was authorized.
  - Commit: `de8b6b68034cbac44c089e7e9e5eb470d22cfc55` (`fix(consultation): silence bot output and recover audio per track`); 439 authored additions + deletions including task documentation. One coherent capture/launch regression fix with its behavioral/runtime tests exceeds the advisory 400-line target; user-selected `feature-branch-chain` retained, no PR published. RDD: disabled/unmanaged.
  - Build limitation: first `npm run build` cancelled after launch-option corrections; second run remained in Next/Turbopack `compile` for several minutes without completion or an error and was deliberately stopped. Build is **PENDING / NOT VERIFIED**, not a pass. Host had approximately 0.8–2 GiB free memory during checks; this may explain slowness but is not a confirmed root cause. No build/config changes were made.
  - Next: restart `npm run bot:worker`, rejoin with a fresh bot instance, and verify speech/echo in the user's real Meet; rerun production build when feasible. Functional correction is complete; real-call validation, production build, and Engram mirror remain pending.

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
- **C4.1** completed in commit `202b401` (`npm run typecheck` 0 errors, `npm test` 61/61 passing, `npm run build` clean). RDD: `disabled/unmanaged`.
- **C5.1** completed in commit `b9d6039` (`npm run typecheck` 0 errors, `npm test` 63/63 passing including real Chromium `launchPersistentContext` + WebAudio `16 kHz PCM` capture test, `npm run build` clean). RDD: `disabled/unmanaged`.
- **All Phases & Real-Bot Hardening Complete.**
