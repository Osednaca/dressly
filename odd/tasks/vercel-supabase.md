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

- [x] **V1** Shared Supabase persistence for session state and media with safe configuration, SQL/bucket setup and local fallback. Delegated writer; commit `54164f7`, plus orchestrator CAS retry adjustments in `4df0e7e`. Focused tests 3/3, including independent processes with concurrent updates; full suite 90 pass, 0 fail, 3 opt-in skips. Server-only credentials and private bucket, but app API does not enforce per-user ownership. RDD disabled/unmanaged. Supabase real integration pending.
- [x] **V2** Shared persisted job lifecycle with leases, stable result IDs, and local fallback. Delegated writer: jobs/consumer trigger. Commit `38fce2ed09e67d2c4f3bbedcdd8bfca5898fd60c`; focused tests 4/4, typecheck passed, mocks disabled in distributed mode and missing provider config fails explicitly. SQL `002_jobs.sql`; catalog assets traced and reference paths constrained. Lease expiration/crash windows do not guarantee exactly-once auto-tryon. RDD disabled/unmanaged; full suite pending.
- [x] **V3** Cross-instance consultation delivery, job recovery and honest worker failure handling. Delegated writer; commit `4df0e7e17181debac9e5a4e5f3f7e82e62114581`; focused event/poll tests 9/9, diagnostics 3/3, bot 7 pass/1 opt-in skip; full suite 90 pass/0 fail/3 skips and typecheck passed. Events persist in SQL 003, replay refreshes snapshot, queued jobs recover sequentially; no default public bot secret. Prior focused failures (test syntax/types and timing) corrected and rerun green. Event aggregation across separate instances and exact-once provider effects are not guaranteed. Live worker/Supabase not verified. RDD disabled/unmanaged.
- [ ] **V4** Integrate, configure and verify: documented setup and explicit required environment variables and SQL, free-tier/Vercel size limits, tests/build and deployment handoff. Delegated writer if needed. Live Supabase/Vercel not verified without explicit remote authorization.

## Progress

- V1 implementation commit `54164f7acfd1a7588b8c6a2d60e42af33ac1407a`; focused storage tests 3/3, including two independent processes with CAS conflicts. Shared orchestrator callback retry fixes are pending in V3. Full typecheck and integration still pending. RDD disabled/unmanaged. Engram unavailable.
- V2 commit `38fce2e`; focused tests 4/4 across job storage, asset paths and serverless providers. Supabase/Vercel live integration not exercised. Running V1/V2 authored count 835 lines including task document; feature-branch chain selected, no PR created.
- V3 commit `4df0e7e` adds 549 authored lines, a coherent cross-instance delivery fix with its security and regression tests; exceeds advisory 400-line heuristic without omitting tests. Combined work-unit count 1384 authored lines; no PR or deployment. `npm test` final: 93 total, 90 pass, 0 fail, 3 opt-in skips. `npm run typecheck` passed. Build in progress. No Engram tool available.
