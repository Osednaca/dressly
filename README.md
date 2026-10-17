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
| Gemini | Language understanding + live voice stylist (Gemini Live) | `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL` |
| Runway | Optional P2 animation | `RUNWAY_API_KEY`, `RUNWAY_ENABLED`, `RUNWAY_MODEL` |

Runway is a multi-model gateway: `RUNWAY_MODEL` selects any image-to-video model Runway hosts,
including Google's **Gemini Omni Flash** (`gemini_omni_flash_1.1`) or Runway's own `gen4_turbo`.
Set `RUNWAY_RATIO` and `RUNWAY_DURATION_SECONDS` to values the chosen model accepts (for
`gemini_omni_flash_1.1`: `720:1280`/`1280:720`, 3–10s). The "Bring this look to life" button only
appears on the final look once `/api/providers` reports Runway active.

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

## Visual system (Shaders)

The interface is styled as a "midnight atelier": a near-black shell, warm ivory type, clay
and champagne accents, and translucent glass surfaces. Depth comes from the open-source
[Shaders](https://shaders.com/) library (WebGPU), used with strict restraint — five signature
treatments, never a shader on every card:

| Treatment | Component | Where |
| --- | --- | --- |
| Ambient environment | `components/shaders/DresslyAmbient.tsx` | Behind the whole app (global / hero / cinematic variants) |
| Styling state | `components/shaders/DresslyLoadingShader.tsx` | Behind the named loading steps; energy rises with progress |
| Outfit transition | `components/shaders/LookStage.tsx` | Ripple wipe between the previous and new YouCam result |
| Glass panel | `components/shaders/DresslyGlass.tsx` | Frosted stylist panel with a fluted-glass edge |
| Selection glow | `components/shaders/DresslyGlow.tsx` | Halo around the fitting-room frame and primary actions |

Everything is tuned from one place, `lib/visual/config.ts`, so any effect can be switched off
in a single edit before a recording.

**Graceful degradation.** Shaders is WebGPU-only. The app renders a matching static CSS
gradient first and only upgrades to the GPU treatment once an adapter is confirmed
(`isWebGPUSupported` / `getWebGPUSupport`), so initialization is never blocked. Without
WebGPU, on mobile (`< 768px`), or under `prefers-reduced-motion`, the shaders are skipped and
the same mood is painted in CSS. The garment imagery is never filtered — shaders only frame,
transition, and light the scene.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Deterministic behaviour tests (`node --test`) |
| `npm run gen:catalog` | Regenerate `public/catalog/` (35 flat-lay renders) |
| `npm run gen:consultation-seed` | Regenerate V1 handbag (`public/catalog/consultation-bag-v1.png`) and demo portrait |
| `npm run bot:worker` | Start isolated Playwright + Chromium Google Meet bot worker (`127.0.0.1:4100`) |

Tests load the TypeScript source directly under Node's native type stripping via
`scripts/register.mjs`, a tiny resolver for the `@/` alias. No test framework dependency.

## Live Consultation Architecture

Dressly extends its AI personal stylist into a collaborative real-time design workspace for
live Google Meet consultations (**Style it. Design it. Try it.**):

```
Google Meet
   ↓
Chromium / Playwright bot ("Dressly AI Assistant", mic & camera muted)
   ↓
Meeting audio output (16 kHz mono s16le PCM via ConsultationAudioSource)
   ↓
Gemini Live (BidiGenerateContent audio transcription) + Gemini Flash (semantic modification extraction)
   ↓
JEV System One (evaluates IGNORE / PROPOSE_CHANGE / ASK_CLARIFICATION / TRY_ON_CURRENT_DESIGN / RETURN_TO_PREVIOUS_VERSION / FINALIZE_DESIGN)
   ↓
Human-in-the-loop designer approval ([ Ignore ] [ Edit ] [ Apply ] or AUTO APPLY ●)
   ↓
Runway Nano Banana 2.1 (POST /v1/text_to_image with @latest_design + @original_design reference preservation)
   ↓
YouCam Virtual Try-On (POST /s2s/v2.0/task/bag & cloth-v4)
```

### Dependencies & Binary Setup

- **`playwright-core` + Chromium:** Resolved automatically by `services/meeting-bot/playwright-bot.ts` from `CHROMIUM_EXECUTABLE_PATH`, the local Playwright browser cache (`ms-playwright/chromium-*`), or system Google Chrome / Chromium.
- **`ffmpeg`:** Resolved automatically by `services/meeting-bot/audio-capture.ts` from `FFMPEG_PATH`, `PATH`, or WinGet/system locations.
- **Linux / Docker Virtual Audio (optional):** `PulseAudio` or `PipeWire-Pulse` (`pactl`) when using `MEETING_AUDIO_BACKEND=pulseaudio`.

### Persistent Google Meet Profile Setup

Google Meet rooms that restrict anonymous guests can use a pre-authenticated persistent
Chromium profile directory (`MEETING_BOT_PROFILE_DIR=data/bot-profile`):

1. Launch Chromium once against `data/bot-profile` and sign into the dedicated assistant Google account.
2. Subsequent bot sessions reuse `data/bot-profile` automatically while always joining with microphone and camera muted as **`Dressly AI Assistant`**.

### Cross-Platform Audio Capture

All meeting audio capture sits behind the `ConsultationAudioSource` interface (`services/meeting-bot/audio-source.ts`) and never touches the host machine's physical microphone:

- **`webrtc-tap` (default cross-platform):** Injects a `16 kHz` `AudioContext` tap inside the bot's Chromium page that intercepts remote WebRTC media tracks and `<audio>`/`<video>` elements and forwards `16 kHz mono s16le PCM` frames (`3200 bytes` / `100ms`) in memory.
- **`pulseaudio` (Linux / Docker):** Creates an isolated `module-null-sink` (`dressly_meet_<sessionId>`) and spawns `ffmpeg -f pulse -i <sink>.monitor -ac 1 -ar 16000 -f s16le pipe:1`.

### Live Consultation Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Gemini Flash modification extraction & Gemini Live `BidiGenerateContent` audio transcription |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Structured fashion modification extraction model |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Real-time 16 kHz PCM audio transcription model |
| `TYPESAFE_API_KEY` | — | JEV System One consultation action decision engine |
| `JEV_MODEL` | `jev-1.13.0` | JEV model identifier |
| `RUNWAY_API_KEY` | — | Runway API key for `nano_banana_2.1` product generation |
| `RUNWAY_ENABLED` | `false` | Set `true` to enable live Runway calls |
| `RUNWAY_IMAGE_MODEL` | `nano_banana_2.1` | Runway `POST /v1/text_to_image` model for iterative product revisions |
| `RUNWAY_IMAGE_RATIO` | `896:1200` | 3:4 studio portrait aspect ratio (`1792:2400` for high-res finalize) |
| `YOUCAM_API_KEY` | — | YouCam S2S v2.0 Virtual Try-On API key |
| `DRESSLY_CONSULTATION_DEMO_MODE` | `false` | Preloads V1 burgundy leather shoulder bag & demo customer portrait while keeping real AI providers active |
| `CONSULTATION_AUTO_APPLY_THRESHOLD` | `0.90` | Minimum confidence (`0.5..1.0`) required when `AUTO APPLY ●` is enabled |
| `MEETING_BOT_PORT` | `4100` | Port for the standalone Playwright meeting-bot worker |
| `MEETING_BOT_URL` | `http://127.0.0.1:4100` | Internal worker URL called by Next.js |
| `MEETING_BOT_SECRET` | `dressly-local-bot-secret` | Shared `X-Meeting-Bot-Secret` authenticating Next.js ↔ worker requests |
| `MEETING_BOT_PROFILE_DIR` | `data/bot-profile` | Persistent Chromium profile directory for Google Meet |
| `MEETING_AUDIO_BACKEND` | `auto` | `"auto"`, `"webrtc-tap"`, or `"pulseaudio"` |
| `CHROMIUM_EXECUTABLE_PATH` | *(auto-detected)* | Optional explicit path to Chromium/Chrome binary |
| `FFMPEG_PATH` | *(auto-detected)* | Optional explicit path to `ffmpeg` binary |

### Starting the Meeting Bot Worker Alongside Next.js

Run the Next.js server and the isolated Meeting Bot Worker in two terminals:

```bash
# Terminal 1 — Next.js app (http://localhost:3000)
npm run dev

# Terminal 2 — Isolated Playwright + Chromium Meeting Bot Worker (http://127.0.0.1:4100)
npm run bot:worker
```

If `npm run bot:worker` is not running, Dressly degrades gracefully: the consultation workspace,
simulated/manual transcript input, Gemini + JEV decision pipeline, Runway `nano_banana_2.1`, and
YouCam Virtual Try-On continue to operate without interruption.

### Layer-by-Layer Diagnostics & Flagship 4-Step Scenario

Open **Live Consultation** in the UI and expand **Developer & Demo Layer Diagnostics** at the
bottom of the consultation panel to test each subsystem independently:

1. **`[ Test Bot Join ]`** — Verifies worker/Chromium/FFmpeg readiness and transitions `OPENING_MEET → WAITING_FOR_ADMISSION → JOINED → LISTENING`.
2. **`[ Test Audio Capture ]`** — Verifies `16 kHz mono s16le PCM` frame emission (`3200 bytes` per `100ms` frame).
3. **`[ Test Gemini Stream ]`** — Verifies `GeminiConsultationLiveStream` setup and semantic extraction.
4. **`[ Simulate Transcript ]`** — Runs a spoken client request through conversational aggregation, Gemini, and JEV.
5. **`[ Simulate Suggestion ]`** — Injects a pending `ProposedDesignChange` to test `[ Ignore ]`, `[ Edit ]`, and `[ Apply ]`.
6. **`[ Test Runway Revision ]`** — Triggers Runway `nano_banana_2.1` with `@latest_design` and `@original_design` reference images.
7. **`[ Test YouCam VTO ]`** — Triggers YouCam Virtual Try-On for the active handbag version (automatically seeding the demo customer portrait if no photo was uploaded).

To run the **Flagship 4-Step Handbag Consultation Scenario** (`V1 Original` burgundy shoulder bag with silver hardware):

1. *"I like it, but can we make the hardware gold?"* → Approve suggestion → **`V2 Gold hardware`**
2. *"That's better. Maybe make it a little smaller."* → Approve suggestion → **`V3 Smaller silhouette`** (anchored to both `@latest_design` and `@original_design`)
3. *"Could we make the strap longer so I can wear it crossbody?"* → Approve suggestion → **`V4 Crossbody strap`**
4. *"Can I see how that looks on me?"* (or click **`Try this version`**) → **YouCam Virtual Try-On**

### Browser Automation Limitations & Official Google Meet Media API Path

Playwright browser automation against Google Meet can encounter lobby admission waits, CAPTCHA
or workspace sign-in policies, or DOM selector changes across Google Meet rollouts. Dressly
isolates all Playwright and browser-audio logic inside `services/meeting-bot/` behind the
`ConsultationAudioSource` interface (`start()`, `stop()`, `onAudioChunk()`). A production
deployment adopting Google Workspace's official **Google Meet Media API** can drop in a
`GoogleMeetMediaApiAudioSource` implementation emitting `16 kHz mono s16le PCM` chunks without
changing a single line of `GeminiConsultationLiveStream`, the consultation orchestrator, JEV,
Runway `nano_banana_2.1`, or YouCam Virtual Try-On.

## Reliability

Every provider has a defined, visible degradation path: Gemini falls back to a keyword parser,
JEV to deterministic metadata ranking (records are marked `fallback`), YouCam fails closed with
a retry. Requests have hard deadlines and bounded retries; 4xx is never retried.
