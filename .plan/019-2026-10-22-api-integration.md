# Frontend and Backend Integration

Status: done
Owner: Ilana
Last updated: 2026-10-22

## Goal
- Run the app end to end against the real backend: the frontend's HTTP data source (`VITE_DATA_SOURCE=api`) calls every backend route. Every button that needs the server works through the store and services, and the unit and e2e suites prove there are no regressions.

## Scope
- The backlog item was not marked `stack:full`. I marked it `stack:full` on 2026-10-22, because integration cannot be done on one side only. Agents: Frontend, then Backend (small), then QA. Branch: `feat/api-integration`.
- In scope:
  1. **Wire the six button routes** from contract 0.4.1 into the frontend. Each gets a service method, a thunk, slice state and the component change; failures go through the existing notification path.
     - Generated Tests **Regenerate** → `review.service.regenerateTest(id)` → `POST /api/review/{id}/generated-test`. This replaces the local `altCode` toggle and the 800 ms timer.
     - GitHub wizard **Switch account** → `github.service.disconnect()` → `POST /api/github/disconnect`.
     - GitHub wizard **Import** → `github.service.getFile(repoId, fileId)` → `GET /api/github/repo/{repoId}/file/{fileId}` (see Open Question 3).
     - **Account panel** and the Contact Support email → a new `account.service.get()` → `GET /api/account`, plus an `account` slice. `mocks/settings.json` stops being imported by components.
     - Security **Update password** → `account.service.changePassword(...)` → `PUT /api/account/password`. A wrong current password shows the field error from `details.issue`.
     - Security **Sign out** → `account.service.signOut()` → `POST /api/account/sign-out`. The "(mock)" text is removed from the toast.
  2. **New review in API mode** (see Open Question 1). `/review/new` has no backend record, so it stops loading the mock template. It opens a blank, unsaved review: an empty editor, the selected language and empty result tabs. **Save** on a new review sends `POST /api/review` (`source_type: "snippet"`), then the saved edit, then navigates to `/review/{id}`. The stub analyzer's results appear when the review completes, by polling `GET /api/review/{id}` while it is `pending`, `queued` or `in_progress`.
  3. **The JSON data source keeps working** (see Open Question 2). Add the six routes and the new-review flow to `services/json-data-source.ts`, so `json` mode behaves like `api` mode. Add a test that fails when `frontend/src/mocks/*.json` and `backend/src/data/*.json` differ, to guard against the two seed copies drifting apart.
  4. **Contract alignment**:
     - Check every frontend DTO and guard against contract 0.4.1, and fix any gaps. For example: `Account.avatarUrl` (`null` from the backend) versus the frontend's `initials`, and the `details.issue[]` validation shape.
     - The frontend error mapping handles every status the backend sends (400, 404, 409, 413, 422, 500).
  5. **Backend test isolation for e2e** (see Open Question 4): a `POST /api/test/reset` route that restores the seed. It is mounted only when the config flag `ENABLE_TEST_ROUTE=true` is set. `loadConfig` reads the flag, defaults it to false, and it is never set in the example env file.
  6. **E2E against the real servers**:
     - `playwright.config.ts` already starts both servers. Its frontend web server gets `VITE_DATA_SOURCE=api`, and its backend web server gets the test flag.
     - Each spec resets the backend before it runs.
     - Specs that forced failures through browser storage (`error-notification.spec.ts`) force them at the network layer with `page.route(...)` instead.
     - New specs: Regenerate, Switch account, Import, Account panel, password change, Sign out, and new review → save → completed.
  7. **Cross-stack contract test** (frontend Vitest): every domain service runs through the real HTTP data source against the backend `createApp` on an ephemeral port, in process (see Open Question 5).
  8. **Docs**:
     - `.doc/architecture.md`: data flow in API mode, the new-review flow, the test reset route.
     - `README.md`: how to run both servers; `VITE_DATA_SOURCE=api`.
     - `.orchestrate/api-contract.yaml`: remove the "not yet in the frontend" note, and document the test route as test-only.
     - Remove the stale "TO BE REPLACED BY HAND" comment in `frontend/src/lib/config.ts`.
- Out of scope:
  - The code editor upload and paste work, and the real Claude analyzer (the code editor task).
  - Real GitHub (the GitHub link ingestion task).
  - Auth and persistence.
  - Changing your direct read of `DATA_SOURCE` from Vite's env object in `lib/config.ts`.

## Assumptions
- **Backend env file:** the backend's `npm start` loads the backend env file with Node's env-file flag. Your local backend env file exists. Variables that Playwright passes to a web server take precedence, because Node's env-file loading never overrides a variable that is already set.
- **Frontend env file:** it sets `VITE_DATA_SOURCE` (`api` for integrated runs). E2E does not rely on it, because it sets the value explicitly.
- **Guardrail:** agents cannot write text that contains a dot directly followed by `env`. That covers Node's process environment expression, Vite's env object and env file names. The work above avoids those lines: flags reach code through `loadConfig` and through Playwright `env:` keys. If a line like that is unavoidable, the agent leaves a HUMAN TODO and the report lists it.
- **Rules:** no hard-coded values. Frontend texts and limits go in its existing constants and utils files; backend values go in `backend/src/utils/*`. No trailing semicolons; singular names.
- **Behaviour:** unchanged except for the new-review flow (Scope 2) and the button wiring (Scope 1).

## Open Questions
1. **What `/review/new` shows against the real backend.** Recommended: **a blank, unsaved review; Save creates it** (Scope 2). Real data starts empty, and creating a review from editor content is what the API does. The e2e specs that saved the mock template are rewritten to create a review first. Alternative: the backend serves a seeded template for the id `new`, which keeps today's look but is a fake record.
2. **Keep the JSON data source?** Recommended: **keep it and extend it** (Scope 3). It is the env-selected source you designed in plan 017, it is useful offline, and a seed-equality test controls the duplication. Alternative: delete the JSON data source and `frontend/src/mocks`, so the app always calls the API. This removes the duplication, but then `npm run dev` needs the backend running.
3. **What Import does with the file.** Recommended: **open `/review/new` with the imported file's content and language in the editor**, ready to save. Alternative: create the review immediately (`POST /api/review`) and open the result.
4. **E2E isolation.** Recommended: **the test-only reset route behind `ENABLE_TEST_ROUTE`**. It is fast, and each spec starts from the seed. Alternative: restart the backend for each spec (slow), or write specs that never depend on seed state (fragile).
5. **Cross-stack contract test.** Recommended: **yes**, in the frontend suite, importing `backend/src/app.ts` (Scope 7). It catches contract drift without a browser. Alternative: rely only on e2e.

**Answers (approved 2026-10-22):** every Open Question takes its recommended answer.
- 1: `/review/new` is a blank review that Save creates.
- 2: keep and extend the JSON data source, with a seed-equality test.
- 3: Import opens `/review/new` with the file.
- 4: test-only reset route behind `ENABLE_TEST_ROUTE`.
- 5: cross-stack contract test.

Execution order: the Backend agent goes first, because the e2e specs need the reset route.

## Steps
1. Branch `feat/api-integration` (done); backlog item marked `stack:full`.
2. Answer the Open Questions.
3. **Frontend agent:**
   - Scope 1 to 4.
   - The e2e changes in Scope 6, and the cross-stack contract test in Scope 7.
   - Record any new contract needs in `.orchestrate/api-contract.yaml`.
4. **Backend agent:** Scope 5 (the reset route and its config flag), plus any contract changes from step 3, with Supertest coverage.
5. Full run: both unit suites, both typechecks, frontend lint and build, and `npm run test:e2e` against the real servers.
6. QA against this checklist → `.orchestrate/qa-report.md`.
7. Docs (Scope 8); record deviations in this plan.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass. `cd backend && npm test` and `npm run typecheck` pass, including `npx vitest run --sequence.shuffle`.
- `cd frontend && npm run test:e2e` passes with **both servers running and `VITE_DATA_SOURCE=api`**. The Playwright config and its output show the API data source in use.
- The cross-stack contract test calls every route in contract 0.4.1, except `/api/health` and `/api/test/reset`, through the frontend services against the real backend app, and every response passes the frontend guards.
- Each of the six buttons has a unit test (service, thunk and component) and an e2e spec that asserts both the network call and the resulting UI:
  - Regenerate changes the shown test code.
  - Switch account clears the connected email.
  - Import opens the editor with the file content.
  - The Account panel shows the backend profile.
  - A wrong current password shows the field error; a valid change shows success, and the new password works next time.
  - Sign out shows its toast.
- New review: open `/review/new` (blank), type code, save, land on `/review/{id}` with status `completed` and stub findings; the review appears in History and on the Dashboard list.
- Failure paths at the network layer (e2e `page.route`):
  - Each page shows its error toast once when the backend returns 500 or the network fails.
  - "Review failed" off hides review errors but not network errors (plan 016 policy).
  - A 404 review id shows "Review not found" with no toast.
- `json` mode still works: run the existing unit suite once with the JSON data source, and the seed-equality test passes.
- The backend `POST /api/test/reset` returns 404 unless `ENABLE_TEST_ROUTE=true`. This is covered by Supertest in both states.
- No component imports `src/mocks/` (architecture test).
- Docs and the contract are updated, and the stale config comment is gone.

## Risks
- **E2E flakiness** from shared server state or background analysis timing. Mitigation: reset per spec, and wait on the status poll, not on timeouts.
- **The reset route reaching production.** Mitigation: it is off by default and enabled only through Playwright's web server env. A test asserts 404 when the flag is off.
- **No fallback for `DATA_SOURCE`.** Your direct read of `VITE_DATA_SOURCE` has no fallback, so a missing or misspelled value breaks the data source lookup. Mitigation: e2e sets it explicitly. I'm flagging it for you to decide; it is not changed in this task.
- **CI without the backend env file:** Node stops when the env-file flag points at a missing file. Mitigation: for CI, switch to Node 24's "if exists" variant of that flag, which needs a human edit of `backend/package.json`.
- **Large e2e churn** in `review-actions`, `error-notification` and `review-history`.

## Rollout Order
1. Backend reset route and flag.
2. Frontend services, thunks and slices for the six routes.
3. Component wiring.
4. New-review flow.
5. JSON data source parity, then the seed test.
6. Cross-stack test.
7. E2E migration and new specs.
8. Docs, full run, QA.

## Rollback
- Everything is on `feat/api-integration`. Abandon or revert it. Setting `VITE_DATA_SOURCE=json` also returns the running app to the JSON data source without a code change.

## Implementation Notes and Deviations
- **Scope 5 (Backend agent, AI-33, 2026-10-22): done.** `POST /api/test/reset` (`backend/src/route/test.route.ts` plus a thin `service/test.service.ts` over `MemoryStore.reset()`) returns 204. `createApp` mounts it only when `config.enableTestRoute` is true; otherwise it is the normal 404 `not_found`. Contract bumped to 0.4.2.
- **The flag is strict.** `ENABLE_TEST_ROUTE` accepts only the exact strings `true` and `false` (zod `stringbool`, case-sensitive). Unset means off. Any other value (`1`, `yes`, `TRUE`, an empty string) stops the server with the usual "Invalid server configuration" message instead of guessing. This matches the no-fallback rule for the other config values.
- **`createApp` requires the flag.** Its config parameter is now `Pick<AppConfig, 'frontendUrl' | 'enableTestRoute'>`, so callers must pass `enableTestRoute`. That includes the frontend cross-stack test in Scope 7, which should pass `false`. The backend test helper `buildApp(option, enableTestRoute = false)` gained a second parameter.
- **Config key names are now constants.** `PORT`, `FRONTEND_URL` and `ENABLE_TEST_ROUTE` live in `CONFIG_KEY` in `backend/src/utils/constants.ts`, together with `BOOLEAN_TEXT` and `FLAG_DEFAULT`, per the no-hard-coded-values rule. Only `ENABLE_TEST_ROUTE` is new. `backend/src/index.ts` is unchanged.
- **Left for Scope 8:**
  - the contract's "NOT in the frontend JSON data source yet" note;
  - the reset-route section of `.doc/architecture.md`.
  `.doc/` is outside the Backend agent's write paths.
- **Scopes 1, 2, 3, 4, 6, 7 and 8 (Frontend agent, AI-34, 2026-10-22): done.** No backend source was changed; no backend contract bug found. Deviations and decisions:
  - **Unit suite pinned to `json`.** `vite.config.ts` sets `VITE_DATA_SOURCE: 'json'` in the `env` option of the Vitest `test` block, so `npm test` no longer depends on the local env file (which sets `api` for integrated runs). API-mode unit tests inject the HTTP data source explicitly. This is the "run the existing suite once with the JSON data source" check, on every run.
  - **E2E on its own ports.** Ports 5173 and 3001 were already taken by running dev servers (the backend without the test route), and `reuseExistingServer` would have reused them. The e2e servers now use 5174 and 3101 (`tests/e2e/e2e.constants.ts`); the frontend web server runs `npm run dev -- --port 5174 --strictPort`. Besides the requested `VITE_DATA_SOURCE: 'api'` and `ENABLE_TEST_ROUTE: 'true'`, the web servers also get `VITE_API_URL`, `PORT` and `FRONTEND_URL`, so CORS and the API base URL match those ports.
  - **Import with several files** opens the first selected file only (Open Question 3 is about one file); the old "Imported N files" toast is gone.
  - **Regenerate** no longer raises the "Review completed" notice (that belonged to the fake timer). The notice now fires from the listener when a review the Review page was polling reaches `completed`, following its preference.
  - **Security panel:** the current password is now a field the user types (it was a read-only field showing the demo password), with a client check "Enter your current password." A server 422 naming `currentPassword` or `newPassword` (`details.issue[]`) is shown under that field and raises no toast; any other failure is a toast.
  - **New review page:** Save is disabled while the editor is empty and while a save runs (no double create); Download report is disabled until the review exists. The status bar shows Pending and "Not analyzed yet".
  - **JSON data source parity beyond the six routes**, to match the backend: PUT, PATCH and DELETE on an unknown or deleted id are 404 (so is a second delete); PATCH trims the name and requires 1 to 80 characters; POST with blank content is 422; the file list of an unknown repository is 404 (it was `[]`); a save without a name keeps the saved name. Five former `it.fails` KNOWN DEFECT tests in `qa-data-source.test.ts` are now normal tests; three remain (PUT settings with a non-Settings body, an aborted signal on the JSON source, a saved review without `savedAt`).
  - **Error mapping:** 413 maps to a new `payload_too_large` code with its own hint. New action codes: `test_regenerate` (follows "Review failed"), `github_disconnect`, `github_file_import`, `account_load`, `password_change`, `sign_out`.
  - **Constants:** route paths in `lib/api.constants.ts` (all services now use them), in-app routes in `lib/route.constants.ts`, account texts and password limits in `lib/account.constants.ts`, review texts and `REVIEW_POLL_INTERVAL_MS` in `lib/review.constants.ts`, GitHub texts in `lib/github.constants.ts`.
  - **Seed:** `frontend/src/mocks/github-file-content.json` is a copy of the backend file, so the four shared seeds plus this one are compared file by file; `settings-default.json` is compared with `AppSettings.defaultDto()`.
  - **Cross-stack test** imports `backend/src/app.ts` by path at run time (not a static import), because the backend source does not compile under the frontend's compiler options (`erasableSyntaxOnly` rejects its enums).
  - **Contract** stays 0.4.2: only description text changed (integration status, 413, `details.issue[]`, polling, the test route); the PUT password 422 description now says `details.issue[].field` instead of `details.field`, matching the backend.
  - **Left as is (outside the plan):** the Sidebar still shows a hard-coded "John Doe" / "john@company.com" / "JD"; the seeded reviews r5, r6 and r7 never finish, so their Review page polls once a second while open.
  - **Guardrail:** no HUMAN TODO was needed. `lib/config.ts` and `playwright.config.ts` were changed only around the lines that read the environment; those lines are byte-for-byte unchanged.
- **QA round 1 fixes (Frontend agent, 2026-10-22, from `.orchestrate/qa-report.md`):**
  - **D1:** `ReviewPage` (Save on a new review) and `GithubWizardPage` (Import) navigate only while still mounted (`lib/useMounted.ts`). A user who leaves mid-save stays where they went; the save itself still completes.
  - **D2:** a failed poll no longer stops polling. The next poll waits `REVIEW_POLL_RETRY_MS` (3 s), and polling stops after `REVIEW_POLL_MAX_FAILURE` (5) failures in a row; any answer resets the count (`lib/review.constants.ts`). This also caps the seeded r5, r6 and r7 when the backend fails; their normal polling is unchanged.
  - **D3:** `test_regenerate` is in the review codes of `notification.service.ts`, so a server failure of Regenerate follows "Review failed" (network failures still always show).
  - **Hard-coded values removed:**
    - The Sidebar shows the account from `GET /api/account` through `useAccount({ silent: true })`. A background load whose failure shows no toast; a page that shows the account (Account panel, Contact Support) still reports a failure, through `reportFailure` in the account slice.
    - The JSON data source's statuses, error codes and messages now come from constants: `HTTP_STATUS`, `API_ERROR_CODE` and `ID_PATTERN` in `lib/api.constants.ts`; `DEV_ERROR_MESSAGE` and `DEV_ISSUE_MESSAGE` in `utils/error-messages.ts`.
    - `defaultSupportPriority` is in `lib/help.constants.ts`.
    - `REVIEW_STATUS` and `unfinishedStatusList` in `models/review.model.ts` replace the status literals.
    - `DEV_ERROR_MESSAGE.missingReviewId` replaces 'Missing review id'.
  - **Regenerate (L-3)** is disabled, with a hint, unless the review is `completed`. QA's e2e "Regenerate on an in-progress review (409)" was rewritten to match. It now checks: the button is disabled, no request is sent, no toast, and the backend still answers 409 to a direct request.
  - **Length check (L-6):**
    - The Review page names the 100 000-character limit (`REVIEW_LIMIT.contentMax`) and disables Save above it.
    - The code is counted and sent with CR LF turned into LF (`toLf`), so Windows line breaks count once.
    - QA's e2e "100 001 characters is rejected (422)" was rewritten to match. It now checks: the limit is named, Save is disabled, nothing is sent, and the backend still answers 422 to a direct request.
  - **JSON-mode parity (L-4), trivial, done:** content over 100 000 characters, a title over 120 characters, and a malformed id (422 naming the field) are rejected as on the backend. Two of my `qa-data-source.test.ts` tests now expect a 422 for invalid ids.
  - **Docs (L-7):** `.doc/architecture.md` (wizard Approve) and the `lib/settings.constants.ts` comment are fixed.
  - **E2E absence checks (L-1):** the toast absence checks in `error-notification.spec.ts` and `api-integration.spec.ts` are now immediate counts.
  - **Fail markers removed:** QA's 4 `it.fails` in `qa-parity.test.ts` and 3 `test.fail` in `qa-adversarial.spec.ts` now pass as normal tests.
  - **Formerly skipped, done in a follow-up:**
    - **Cross-stack coverage self-check (L-8):** `tests/unit/cross-stack.test.ts` has one table, `ROUTE_COVERAGE` ("METHOD /path" → the service call). The test reads `.orchestrate/api-contract.yaml` with the backend's `yaml` package, loaded from `backend/node_modules` with `createRequire`. It fails in three cases:
      - a contract operation is missing from the table (`/api/health` and `/api/test/reset` are excluded);
      - the table names an operation the contract does not have;
      - an operation in the table was never actually requested by the cross-stack tests (a recording data source tracks every request).
      Proved both ways: removing `GET /api/account` from the table failed the check, and removing the sign-out call failed the "actually requested" check. Both changes were restored, and the file's sha256 is identical.
    - **The 3 older KNOWN DEFECTs in `qa-data-source.test.ts`:** fixed in the JSON data source, and their `it.fails` markers removed.
      - PUT `/api/settings` with a body that is not a complete Settings object is 422 (new `isSettingsDto` guard in `models/settings.model.ts`, as strict as the backend schema).
      - An already-aborted signal rejects as `abort` before anything runs.
      - `isSavedReviewDto` now requires `savedAt`. An older stored record without it is treated as not saved (no crash), and the next save replaces it. Covered in `json-data-source.test.ts`.
    - **Bounded polling with backoff (L-2), in `lib/review.constants.ts`:**
      - `REVIEW_POLL_INTERVAL_MS` 1 s, doubling (`REVIEW_POLL_BACKOFF_FACTOR` 2) up to `REVIEW_POLL_MAX_INTERVAL_MS` 30 s while the status stays the same.
      - Polling stops after `REVIEW_POLL_MAX_DURATION_MS` (5 minutes) without a status change.
      - Any status change starts over at 1 s.
      - D2's retry rule is unchanged: `REVIEW_POLL_RETRY_MS` 3 s, a cap of `REVIEW_POLL_MAX_FAILURE` 5.
      - Either stop shows a hint (`REVIEW_TEXT.pollStopped`) with a Check again button (`REVIEW_TEXT.pollResume`), with no toast; the button starts over.
      - Status changes are detected from each new answer in the effect, not after the await, so a re-render cannot race the bookkeeping.
      - Covered by fake-timer tests in `tests/unit/ReviewPollBackoff.test.tsx`.
      - The seeded r5, r6 and r7 now poll at 1, 2, 4, ... 30 s and stop after 5 minutes.
  - **Still skipped:** nothing from the QA report.

## Addendum (2026-10-23): API mode starts empty
The user ran the app with `VITE_DATA_SOURCE=api` and saw demo reviews on the Dashboard and in Review History before creating any. Cause: plan 018 seeded the backend store with the frontend demo data (Open Question 2) and served fixed dashboard numbers (Open Question 5).

The user decided:
1. **The backend starts with no reviews.** Review History and Recent Reviews show only reviews created through the API.
   - The GitHub mock (account, repos, files and file content), the account and the default settings stay seeded, because there is no real GitHub yet.
   - JSON mode keeps its demo data unchanged.
2. **The Dashboard is computed from the store:**
   - total, completed and failed counts, and the average quality score of completed reviews;
   - severity counts;
   - findings by category;
   - activity per day for the 7d, 14d and 30d ranges, from each review's creation time.

   Trends compare the current range with the previous range of the same length, and are 0 when there is no earlier data. Empty states replace charts with no data.
3. **Findings get a `category`:** `security`, `bug`, `performance`, `readability` or `maintainability`, a required enum on `Finding`. The contract goes to 0.5.0. The stub analyzer sets it per rule. The frontend DTO, guards and JSON demo data carry it too.

Execution: the Backend agent goes first (store, dashboard computation, category, contract, tests); then the Frontend agent (DTO, guards, JSON demo data, the seed-equality test limited to the shared seed files, e2e and unit tests that create their own reviews, empty states); then the orchestrator re-verifies.

Validation additions:
- A fresh backend returns `[]` from `GET /api/review`, and every dashboard count and the activity are 0.
- After creating reviews through the API, the dashboard numbers and charts match those reviews.
- In api mode, the e2e tests start from an empty store and create every review they use.
- JSON mode still shows the demo data.

### Addendum implementation notes and deviations (Backend agent, 2026-10-23)
- **Store.** The review list is empty on creation and on `reset()`. The GitHub mock, the account (seeded password) and the default settings are still seeded.
  - `backend/src/data/review.json` and `backend/src/data/dashboard.json` are deleted; nothing else used them.
  - The remaining backend seed files are `github.json`, `github-file-content.json`, `settings.json` and `settings-default.json`.
  - `ReviewRecord.createdAt` is now required, so `analyzedAgo` is always derived from it.
- **Dashboard rules** (my choices where the addendum left room; they are also in the contract's `Dashboard` schema):
  - Stat values are all-time; trends use windows.
  - **Trend window: 30 days.** Each trend compares the last 30 UTC calendar days (today included) with the 30 days before, by `createdAt`. The addendum did not say which range the single per-stat trend uses.
  - Trend = `Math.round((current - previous) / previous * 100)`, and 0 when the previous window has nothing of that kind. For quality, that means no completed review in the previous window.
  - Average quality = `Math.round` of the mean `qualityScore` of completed reviews, and 0 when there are none.
  - Days are UTC calendar days. Labels use `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })`, which gives 'Apr 26'. Each range has one entry per day, oldest first, ending today.
  - `severityCountList` always has the four counted severities, even when they are zero.
  - `categoryCountList` lists only categories with at least one finding, most first, ties in `FindingCategory` order. It is `[]` when there is no finding.
  - Deleted reviews never count.
- **Category labels changed.** The old seed used the ids `style` and `refactor` ("Code Style", "Refactoring"). These are gone. The labels are now Security, Bugs, Performance, Readability and Maintainability (`DASHBOARD_LABEL` in `backend/src/utils/constants.ts`).
- **Stub analyzer categories:**
  - security: no-eval, no-hardcoded-secret
  - maintainability: no-any, no-todo
  - readability: no-console, max-line-length
  - No stub rule produces `bug` or `performance`.
- **`recentReviewList` was never part of the Dashboard response.** It existed only in the deleted `dashboard.json`, and the service's `Dashboard` type never carried it. Recent Reviews come from `GET /api/review`.
- **Tests.**
  - The new helper `addReview(store, override)` in `backend/tests/helper/app.ts` puts a completed review with a known id into the store. Create-flow tests use the API instead.
  - In `qa-adversarial.test.ts`, only the fixture setup changed: a local `buildApp` wrapper adds r1 and r2 before each probe. No assertion changed.
- Contract bumped to 0.5.0.

### Addendum implementation notes and deviations (Frontend agent, 2026-10-23)
- **DTOs and guards.**
  - `FindingCategory` is in `models/dto.ts`, and its values are `FINDING_CATEGORY` / `findingCategoryList` in `models/review.model.ts`, as `REVIEW_STATUS` is.
  - `FindingDto.category` is required; `CategoryCountDto.id` is a `FindingCategory`.
  - The Finding guard checks `category`. The Dashboard guard accepts only those category ids, an empty `categoryCountList`, and exactly the four counted severities (`countedSeverityList`), each once.
- **Demo data (JSON mode).**
  - Each template finding has a category: f1 security, f2 bug, f3 readability.
  - The mock dashboard's `style` / "Code Style" is now `readability` / "Readability", and `refactor` / "Refactoring" is now `maintainability` / "Maintainability", matching the backend labels. JSON mode still shows the demo data.
  - `recentReviewList` stays in `src/mocks/dashboard.json` only as the JSON source's `GET /api/review` data. The dashboard route never returns it, and a unit test checks that.
- **Seed-equality test.** It compares `github.json`, `github-file-content.json` and `settings.json` file by file, and `settings-default.json` with `AppSettings.defaultDto()`. It asserts that the backend has exactly these four files and the frontend adds only `dashboard.json` and `review.json` (demo data).
- **Empty states.**
  - New `components/EmptyState.tsx`. Texts are `DASHBOARD_EMPTY_TEXT` in `lib/dashboard.constants.ts` and `HISTORY_TEXT` in `lib/review.constants.ts`.
  - lucide icons: `ChartPie` (severity), `ChartBar` (category), `ChartArea` (activity, per selected range), `Inbox` (Recent Reviews, with a link to start a review), `History` (Review History).
  - Stats show 0 from the computed response. "View all" is hidden when Recent Reviews is empty.
  - The category chart had no id assumptions (it plots labels); it now shows the empty state for `[]`.
- **Tests that create their reviews.**
  - New `tests/utils/backendHarness.ts`: the real backend app in process, `createCompletedReview`, and a holding analyzer. The holding analyzer is the stub, except that content with `HOLD-ANALYSIS` stays pending; it is needed for the 409 of Regenerate, because the stub completes every review at once.
  - `cross-stack.test.ts` starts from an empty store and creates every review. It now also checks the empty Dashboard and that the Dashboard numbers and categories match two created reviews.
  - E2E: `createReview` in `tests/e2e/fixture.ts` uses POST, then polls until the review is completed; the reset fixture still runs first. `showReviewAs` shows a created review as pending, queued or in progress by rewriting its GET answers.
  - Every spec now creates its reviews; no spec relies on r1 to r9.
  - New e2e: after the reset, the Dashboard and History show their empty states. After two reviews are created, the stats, severity total, category chart, Recent Reviews and History reflect them.
- **QA's tests, setup only (as the backend agent did for its QA test).**
  - `qa-parity.test.ts`: the backend store gets the same demo reviews (r1 to r9, `addDemoReviews`) so both modes are compared on equal data.
  - `qa-adversarial.spec.ts`: r1, r5, r6 and r7 are created reviews (the last three shown as in progress, queued and pending through `showReviewAs`).
  - In its failed-poll test, `route.continue()` became `route.fallback()`, so the other GETs still go through `showReviewAs`.
  - **One assertion removed:** the direct `POST .../generated-test` expecting 409 in "Regenerate on an in-progress review". It cannot happen against the real backend any more, because every created review is completed at once. The 409 is now covered in `cross-stack.test.ts` with the holding analyzer.
- **Not done:** none.

### User test fixes (2026-10-23)
- **"Run review" on `/review/new`:** the user created a snippet but found nothing that looked like starting a review, because the only trigger was labelled "Save review". On a new review the primary button is now **Run review**, with a `Play` icon. It makes the same calls (POST, then PUT, then navigation and polling) and shows the toast "Review started". Existing reviews keep **Save review**. Both labels are in `REVIEW_TEXT` (`lib/review.constants.ts`). The dedicated "Review Code" editor button is still the code editor backlog task.
- **Monaco's "Uncaught (in promise) Canceled":** this is harmless. Monaco cancels its pending work when an editor is disposed and leaves the rejection unhandled. The new `lib/ignoreMonacoCancel.ts`, called once in `main.tsx`, ignores only that exact rejection (name and message both `Canceled`). Unit test: `tests/unit/ignoreMonacoCancel.test.ts`.
- **Tests:** new-review unit and e2e tests now use "Run review" and "Review started".
- **Results:**
  - frontend unit: 591 passed; typecheck and lint clean; build passes;
  - e2e: 102 passed;
  - backend: 213 passed.
