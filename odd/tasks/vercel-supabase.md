# Feature: Vercel deployment with Supabase storage

Locator: `odd/tasks/vercel-supabase.md` · Engram mirror `odd/vercel-supabase/tasks`: PENDING (memory tools unavailable).

## Objective and scope

User authorized local implementation of Supabase Free for sessions and files and fixing Vercel deployment. Preserve local development; prepare SQL, environment examples and setup instructions. Do not access a remote project, credentials, authenticated session, deploy, push or create a PR without separate destination/operation/credential authorization. The Meet bot requires separately hosted infrastructure outside Vercel; do not claim it is deployed.

Vercel's application filesystem is read-only; current storage writes to `data/`, while session, job and event caches are per-process. Supabase storage must be shared, errors observable, and private bucket credentials remain server-only. Existing API access is based on session/media identifiers and is not user authentication; do not claim per-user isolation without implementing it. Vercel's request/response size constraints apply to proxied media.

## Execution

- TDD: off; inherited from `odd/tasks/gemini-live-stylist.md` and current project feature configuration. Checks: `npm test`, `npm run typecheck`, targeted functional tests, build where feasible. RDD: disabled/unmanaged (`gentle-ai review mode status`, off/global).
- Delivery: `ask-on-risk`; user previously selected `feature-branch-chain`. Forecast 800–1500 authored changed lines due to storage, cross-instance lifecycle and tests; split into coherent work-unit commits, no PR created. 400 lines is advisory, never shrink tests for size. Baseline `623414b` on `feat/dressly-mvp`.
- Routes: delegated throughout; mapping/preparation trigger (4+ files) and writer trigger (2+ non-trivial files). Commit per completed task with tests. Track verification, failures and commit IDs; mirror pending until Engram is available.

## Checklist

- [ ] **V1** Shared Supabase persistence for session state and media with safe configuration, SQL/bucket setup and local fallback. Cover isolation between simulated processes, concurrent updates and failures; do not hide cloud errors. Delegated writer: storage mapping trigger. Acceptance: create/read/update sessions and files without writes to Vercel filesystem; user assets stay in a private bucket and credentials remain server-side. Note API ownership limitation.
- [ ] **V2** Shared persisted job lifecycle, including cross-instance polling and safe duplicate completion; keep local behavior. Delegated writer: jobs/consumer mapping trigger. Acceptance: jobs survive separate function instances, no silent state loss; tests cover completion and concurrency where feasible.
- [ ] **V3** Cross-instance consultation delivery and clear worker configuration/failure handling. Delegated writer: event and worker mapping trigger. Acceptance: consultation clients can observe changes started elsewhere; do not report listening when worker is unreachable, do not enable default worker secret in public production. Document operational limits of separately hosted bot.
- [ ] **V4** Integrate, configure and verify: documented setup and explicit required environment variables and SQL, free-tier/Vercel size limits, tests/build and deployment handoff. Delegated writer if needed. Live Supabase/Vercel not verified without explicit remote authorization.

## Progress

- V1 implementation commit `54164f7acfd1a7588b8c6a2d60e42af33ac1407a`; focused storage tests 3/3, including two independent processes with CAS conflicts. Shared orchestrator callback retry fixes are pending in V3. Full typecheck and integration still pending. RDD disabled/unmanaged. Engram unavailable.
- V2 focused tests 4/4 across job storage, asset paths and serverless providers; integration and commit pending. Jobs use leases and stable result IDs; expiry and crash windows cannot guarantee exact-once auto-tryon. Supabase/Vercel live integration not exercised.
