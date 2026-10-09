# Feature: Gemini Live voice stylist

Locator: `odd/tasks/gemini-live-stylist.md` · Engram mirror `odd/gemini-live-stylist/tasks`: **PENDING**
(no Engram MCP server is available in this runtime).

## Objective

Replace dictation (speech -> text box) with a real-time spoken conversation with the stylist,
using the Gemini Live API. The stylist hears the shopper, talks back, and drives the existing
JEV + YouCam try-on pipeline through function calls.

## Why

Owner: "the main idea is to use the gemini live api, which means a live chat with the try-on
api, not transcribing."

## Design (verified against live API on 2026-10-08)

- Model `gemini-3.8-live` (listed with `bidiGenerateContent` for this key). Env `GEMINI_LIVE_MODEL`.
- Client-to-server WebSocket with an **ephemeral token** minted by our server
  (`POST v1beta/auth_tokens`, field `bidiGenerateContentSetup`, uses=1). The whole setup —
  system instruction, tools, transcription — is locked in the token, so the API key and prompt
  never reach the browser. Verified with a probe: token 200, `setupComplete`, `toolCall`
  received, spoken reply + output transcription after `toolResponse`.
- Tools: `style_request(message)` -> existing `/chat` turn (Gemini intent + JEV decision +
  YouCam try-on job); `finish_look()` -> existing `/finish`. The tool returns as soon as the
  try-on job is *submitted*; when the job resolves the client tells the Live session so the
  stylist can react.
- Audio: mic -> AudioWorklet -> 16 kHz PCM16 in; 24 kHz PCM16 out, scheduled playback,
  barge-in clears the queue on `interrupted`.
- Typed messages while live go into the Live session; when not live, typing uses `/chat` as before.

Sources: https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket ,
https://ai.google.dev/gemini-api/docs/ephemeral-tokens , https://ai.google.dev/api/live#AuthToken ,
https://ai.google.dev/gemini-api/docs/live-tools

## Constraints

- The shopper photo is never sent to Gemini (unchanged).
- No push / PR / merge without instruction.
- TDD: off (no project/session configuration). Runner: `npm test`; checks `npm run typecheck`, `npm test`.
- Route: inline for all tasks — runtime policy disallows subagents unless the user asks, so the
  writer/mapping triggers are recorded but not delegated.

## Tasks

- [x] L1 Server: `services/gemini/live.ts` (setup builder + token mint) and
      `POST /api/sessions/[id]/live`; unit test `tests/live.test.ts`.
- [x] L2 Client engine `lib/client/live.ts` + hook `lib/client/use-live-stylist.ts`.
- [x] L3 UI: ChatPanel live mode (mic = go live / end), DresslyApp tool handlers + try-on
      completion notice; dictation/transcribe path removed.
- [x] L4 Docs (`docs/PROJECT.md`, `README.md`, `.env.example`) + checks + commit.

## Acceptance

- Clicking the mic starts a spoken session; the stylist answers by voice.
- Saying "something for a rooftop dinner" triggers a try-on that appears in the fitting room.
- Interrupting the stylist stops its audio.
- Ending the session releases the microphone.

## Delivery

Forecast ~550 authored lines (one coherent feature; splitting the engine from its UI would leave
dead code). Strategy: `ask-on-risk` — owner has not requested a PR; commits stay on `feat/dressly-mvp`.

## Progress / evidence

- Prior work unit: `bf2f898` fix(onboarding) — occasion sent on begin + voice fallback.
- `npm run typecheck` clean; `npm test` 34/34 (2 new Live setup tests).
- Route check: `POST /api/sessions/{id}/live` -> token, model `models/gemini-3.8-live`.
- Node e2e through our route + real `/chat`: setupComplete -> `style_request("Rooftop dinner
  tonight, elegant but not too formal.")` -> engine reply -> spoken reply (25 audio chunks) whose
  transcript relays the blocked reason (no photo in that session).
- PENDING (needs a human in a browser): mic capture worklet, audio playback, barge-in, echo
  behaviour on speakers, try-on completion note with a real photo.
- RDD: `gentle-ai review assess` not run (receipt-driven review switch not enabled by owner).

## Next step

Owner tests in Brave/Chrome: upload photo, Begin styling, tap mic, talk.
