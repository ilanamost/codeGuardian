# Backend for All Routes

Status: done
Owner: Ilana
Last updated: 2026-10-22

## Goal
- Implement the Express backend for every route the app needs (Dashboard, New Review, Review History, GitHub Integration, Settings, Help/Support) over an **in-memory store**, exactly as specified by `.orchestrate/api-contract.yaml`. Extend the contract first with the routes that UI buttons need but the contract lacks.
- No frontend integration in this task: the frontend keeps running on the JSON data source. Wiring it up is the "Integrate the frontend with the backend" backlog item.

## Scope
- Backlog item marked `stack:full (backend-only)` by the user on 2026-10-22: Backend agent + QA, **no `frontend/**` changes**. Branch: `feat/backend-route`.
- In scope:
  1. **Contract first** (`.orchestrate/api-contract.yaml`, bump to 0.4.0). Add the routes for buttons that need the server (see Open Question 1):
     - `POST /api/review/{id}/generated-test`: the Generated Tests "Regenerate" button. Returns the regenerated `GeneratedTestFile[]`.
     - `POST /api/github/disconnect`: "Switch account". Returns 204.
     - `GET /api/github/repo/{repoId}/file/{fileId}`: the wizard "Import" step. Returns `{ id, path, language, content }`.
     - `GET /api/account`: the Account panel (`fullName`, `email`, `avatarUrl`, `memberSince`).
     - `PUT /api/account/password`: Security "Update password" (`currentPassword`, `newPassword`). Returns 204, or 422 when the current password is wrong or the new one is too weak.
     - `POST /api/account/sign-out`: Security "Sign out". Returns 204.
     - Client-only buttons stay without routes: tabs, copy, download PDF (built in the browser), View all findings, accordions, password reveal, the notification "test" toast.
  2. **Layout** (`backend/src/`), one file per domain, singular names (`.claude/rules/naming.md`):
     - `store/memory-store.ts`: the only module that owns data. It is seeded on creation and has `reset()` for tests.
     - `data/*.json`: seed data (see Open Question 2).
     - `route/<domain>.route.ts`: thin Express routers (`review`, `dashboard`, `github`, `settings`, `support`, `account`).
     - `service/<domain>.service.ts`: the business rules.
     - `schema/<domain>.schema.ts`: request validation (see Open Question 4).
     - `analyzer/`: an `Analyzer` interface plus a deterministic stub (see Open Question 3).
     - `createApp({ store, analyzer, ... })` takes its dependencies, so each test gets a fresh store.
  3. **Behaviour per route**, matching the contract and what the JSON data source does today:
     - `GET /api/review`: newest first, deleted reviews hidden, a saved name replaces the title.
     - `GET /api/review/{id}`: the review with saved edits applied, plus `savedAt`. Unknown or deleted id → 404.
     - `POST /api/review`: 202 with the created review in status `pending`. The stub analyzer then completes it in the background.
     - `PUT /api/review/{id}`: save. 404 for an unknown id.
     - `PATCH /api/review/{id}`: rename. 404 for an unknown id, or for a review that was never saved.
     - `DELETE /api/review/{id}`: 204. 404 for an unknown or already-deleted id.
     - `GET /api/dashboard`: the dashboard aggregates.
     - GitHub: connect, search repos (case-insensitive name contains), list files (404 for an unknown repo), file content, disconnect.
     - `GET /api/settings` and `PUT /api/settings`: single-user settings with the frontend defaults.
     - `POST /api/support-request`: 201 `{ ticket: "SUP-NNNN" }`. The request is kept in the store.
     - Account: get, change password, sign out.
     - These close QA's frontend findings L2 to L4 on the server side: names of 1 to 80 characters, non-empty content, 404 for unknown ids, `savedAt` always present.
  4. **Errors** (`.rule/error-handling-rules.md`): the existing `{ error: { code, message, details? }, requestId }` shape is kept.
     - Malformed JSON → 400 `bad_request`.
     - A body that fails its schema → 422 `validation_error`; the existing `validationError` helper moves from 400 to 422.
     - 404 `not_found`; anything unexpected → 500 `internal_error`.
     - The body size limit is 200 kB (the contract allows 100 000 characters of code) → 413 `payload_too_large`.
  5. **Security** (`.rule/security-rules.md`):
     - Validate every body, path and query value. `id` path segments are limited to `[A-Za-z0-9-]`.
     - The password is stored as a `scrypt` hash (`node:crypto`), never echoed, never logged.
     - CORS stays restricted to the frontend URL.
     - No secrets in the repo.
  6. **Tests** (Vitest + Supertest, `backend/tests/`): one file per route group. Cover:
     - Happy paths.
     - Every documented error status.
     - A response-shape check against the contract for each 2xx response.
     - Store isolation between tests.
  7. **Docs**: `.doc/architecture.md` (backend components and layout), `.doc/glossary.md` (new terms: analyzer stub, account), and a backend section in `README.md` (run, test).
- Out of scope:
  - Any `frontend/**` change. This includes adding the new routes to the frontend JSON data source; that belongs to the integration task.
  - Real AI analysis (Claude). It comes with the code editor "Review Code" task.
  - Real GitHub API and URL ingestion. They come with the GitHub link ingestion task.
  - Auth and sessions.
  - Persistence, a database, and rate limiting.

## Assumptions
- Stack as it already exists: Node 20+, TypeScript, ESM, **Express 4**, which is the installed version (the agent definition says 5; no upgrade). Tests use Vitest + Supertest.
- The contract is the single source of truth. Shapes are the frontend DTOs in camelCase, except `Finding.line_start`.
- Single user, single instance: state lives in memory and resets on restart.
- Code style: no trailing semicolons (`.claude/rules/code-style.md`). Naming: singular routes and files.
- **Guardrail:** `.claude/hooks/block-secret-file-access.js` rejects tool calls whose text contains a dot followed by `env`. That includes Node's process environment expression, which already appears in `backend/src/app.ts` and `backend/src/index.ts`. The agent must not rewrite those lines. It edits around them and passes configuration in through `createApp(...)` parameters. The hook stays unchanged, as decided for plan 017.

## Open Questions
1. **New routes for buttons the contract lacks** (Scope 1). Recommended: **add all six now.** The backlog says every button must produce an API call where needed, and the integration task then only wires them. Alternative: implement only the existing contract and leave these buttons for the integration task.
2. **Seed data.** The backend agent may not read `frontend/**`. Recommended: **copy the frontend's `src/mocks/*.json` once into `backend/src/data/`** (orchestrator does the copy before the agent starts) and add the settings defaults plus seed file contents for the Import route. The two seeds may drift later; the integration task removes the duplication by switching the frontend to the API. Alternative: import them from `../frontend/src/mocks` at runtime (couples the two packages).
3. **What `POST /api/review` does without AI.** Recommended: **an `Analyzer` interface with a deterministic stub.** The review is created as `pending`; the stub then sets it to `completed` with findings derived from simple rules on the code (for example `console.log`, `any`, `TODO`, very long lines), a quality score and the regenerate variants. The Claude analyzer replaces the stub in the code editor task. Alternative: leave reviews `pending` forever with empty results.
4. **Request validation.** Recommended: **`zod`** (one small, widely used dependency; schemas double as TypeScript types). Alternative: hand-written guards with no new dependency.
5. **Dashboard numbers.** Recommended: **serve the seeded aggregates as they are** (they match what the UI shows today). Computing them from the store needs finding categories and creation dates that the review model does not have yet; revisit with the AI task. Alternative: compute total, completed, failed and the severity counts from the store now, and keep the seeded category and activity charts.
6. **Password rules for `PUT /api/account/password`.** Recommended: **at least 8 characters and different from the current one**; the seeded demo password matches the frontend's `mockPassword`. Alternative: also require a digit and a letter.

**Answers (approved 2026-10-22):** every question takes its recommended answer.
- 1: add all six routes.
- 2: the seed JSON is copied to `backend/src/data/` (done by the orchestrator).
- 3: deterministic stub analyzer.
- 4: `zod`.
- 5: seeded dashboard aggregates.
- 6: at least 8 characters, different from the current password.

The Backend agent also updates `.orchestrate/api-contract.yaml` (Scope 1), because no boundary hook restricts it.

## Steps
1. Branch `feat/backend-route` (done); backlog item marked `stack:full (backend-only)`.
2. Answer the Open Questions; update the contract (Scope 1) and copy the seed JSON (Open Question 2).
3. Backend agent: store + seed, error helpers (400, 413, 422), `createApp` dependency injection.
4. Routes, services and schemas per domain, each with its Supertest file.
5. Analyzer interface and stub; background completion of new reviews.
6. Docs (Scope 7); record deviations in this plan; write `.orchestrate/backend-agent-report.md`.
7. QA validates against this checklist and writes `.orchestrate/qa-report.md`.

## Validation
- `cd backend && npm test` and `npm run typecheck` pass. The frontend suite (`cd frontend && npm test`) still passes, untouched.
- `git diff --stat master...HEAD -- frontend` shows no frontend changes from this task.
- Every path and method in `.orchestrate/api-contract.yaml` has at least one Supertest test for its 2xx response, and its body passes a shape check against the contract schema.
- Error tests:
  - Malformed JSON → 400 `bad_request`.
  - An invalid body on each write route → 422 `validation_error`.
  - Unknown review id on GET, PUT, PATCH and DELETE → 404; unknown repo or file → 404; an unknown route → 404.
  - A body over the limit → 413.
  - Every error response has `requestId` matching the `x-request-id` header.
- Review flow:
  - Create → 202 `pending`, then `completed` with findings from the stub.
  - Save, then GET shows the edits and `savedAt`.
  - Rename changes the list title.
  - Delete hides the review from the list and makes GET return 404.
  - A second delete → 404.
- Settings: GET returns the defaults; PUT with a valid body → 204, after which GET returns the saved values; PUT with an invalid enum → 422.
- Support: valid → 201 with a `SUP-\d{4}` ticket; a description under 10 characters, a bad email or a bad `reviewId` → 422.
- Account:
  - GET returns the profile.
  - A wrong current password → 422; a valid change → 204 and the new password works next time.
  - The password and its hash never appear in any response or log line (test asserts on captured logs).
- `reset()` gives each test a fresh seed: tests pass in any order (`vitest --sequence.shuffle`).

## Risks
- **Seed drift** between `backend/src/data` and `frontend/src/mocks` until integration. Mitigation: copy once now, and the integration task deletes one side.
- **The guardrail blocks edits** to lines that read the process environment. Mitigation: they are left as they are and config flows through `createApp` parameters.
- **Contract additions not mirrored in the frontend** JSON data source until integration. Mitigation: listed explicitly as integration-task work in the contract description.
- **The stub analyzer looks like real AI output.** Mitigation: findings carry an obviously rule-based message, and the stub is named and documented as such.

## Rollout Order
1. Contract update and seed copy.
2. Store, errors, app wiring.
3. Review routes, then dashboard, GitHub, settings, support, account.
4. Analyzer stub.
5. Docs, full test run, QA.

## Rollback
- All work is on `feat/backend-route` and touches only `backend/**`, the contract, docs and this plan. Abandon or revert the branch to roll back. The frontend is unaffected because it does not call the backend yet.

## Implementation Notes and Deviations
Backend agent, 2026-10-22 (AI-31). Nothing is committed.

- **Extra dev dependencies `ajv` and `yaml`.** The plan approved only `zod`. These two are used only by `tests/helper/contract.ts`, which loads `.orchestrate/api-contract.yaml` and checks every response against the declared status and JSON schema. They are not runtime dependencies. `tests/contract.test.ts` also fails if any contract operation has no `expectContract(...)` call.
- **Seed additions as new files.** The copied `data/{review,dashboard,github,settings}.json` are unchanged. The settings defaults (taken from `frontend/src/models/settings.model.ts`) are in `data/settings-default.json`, and the Import route's file contents are in `data/github-file-content.json` (one snippet for each of the 11 seeded files).
- **`Account.avatarUrl` is `null`.** The seed has only `initials`, no avatar URL. The contract declares `avatarUrl` as a nullable string, and the UI keeps showing initials.
- **Regenerate on a review that is not completed → 409 `conflict`.** The plan did not name a status for this case. Regenerating swaps each file's `code` and `altCode` (stub behaviour), so a second press returns the first version.
- **Malformed ids → 422.** An `id`, `repoId` or `fileId` outside `^[A-Za-z0-9-]{1,64}$` gets 422 `validation_error` (declared in the contract), not 404.
- **Strict bodies.** Every request schema is a strict object, so unknown fields get 422 (noted in the contract description). Strings are length-capped: language 40, name 80, title 120, code/content 100 000, query 100, email 254, password 200.
- **Middleware order.** `attachRequestId` now runs before CORS and the JSON parser, so 400 and 413 responses carry `requestId` as well. The body-parser `body` field (which can hold a password) is never logged.
- **`createApp(frontendUrl, option)`.** Configuration still enters through the untouched config line. The new second parameter takes `{ store, analyzer, now, bodyLimit }`. `index.ts` is unchanged.
- **GitHub routes do not require a connection.** Connect and disconnect toggle a `connected` flag only, matching the JSON data source. Requiring a connection is for the real GitHub task.
- **Sign-out is an acknowledged no-op (204),** because there are no sessions.
- **List title.** `GET /api/review` applies only the saved name (as the contract says). `GET /api/review/{id}` applies name, language and code.
- **Support tickets** are sequential from `SUP-1001` and wrap after `SUP-9999`, so they always have 4 digits.
- **`POST /api/review` requires `source_type: "snippet"`** per the contract. The frontend `NewReviewDto` has no `source_type`, so the integration task must add it, or the contract must change.
- **Docs written:** `.doc/architecture.md`, `.doc/glossary.md` (analyzer stub, account), `README.md` (Backend section).
- **QA round 1 fixes** (`.orchestrate/qa-report.md`, D1 to D4; all seven QA `it.fails` markers in `backend/tests/qa-adversarial.test.ts` were removed and those tests now pass, no QA test changed otherwise):
  - D1: `lib/error.ts` maps any error that carries a 4xx `status` or `statusCode`, and any `URIError`, to the contract's codes. A malformed percent-escape in a path (`/api/review/%E0%A4%A`, `/api/github/repo/%zz/file`) now returns 400 `bad_request` with no error log, instead of 500.
  - D2: **deviation from Scope 4 (the "200 kB" limit).** QA's six 413 tests require a 210 000-character ASCII body to be rejected, and D2 requires 100 000 multi-byte characters to be accepted. A byte limit cannot do both. So the main cap now counts **Unicode code points of the raw JSON text** (200 000, `bodyCharLimit`), checked in the parser's `verify` hook. The byte cap is raised to **700 kB** (`bodyLimit`) as an outer safety net, which is enough for 100 000 four-byte characters plus the envelope. The zod character check on `content` (100 000) is unchanged. JSON `\u` escapes still count as 6 characters each, so 100 000 escaped control characters get 413.
  - D3: every 4xx from the body parser other than 413 (such as 415 for an unsupported content-encoding) now returns 400 `bad_request`.
  - D4: contract 0.4.1. All 12 operations that had no `default` now declare `default: { $ref: '#/components/responses/Error' }`, so all 20 operations have one. `tests/contract.test.ts` asserts this. The description states the new size rule and the 400 cases.
  - Results: `npm test` 12 files, 191 passed. `npm run typecheck` clean. `npx vitest run --sequence.shuffle` 191 passed in three runs.
- **Frontend suite:** one test was already failing on HEAD before this task. `tests/unit/domain.service.test.ts` imports `parseDataSource`, but `frontend/src/lib/config.ts` does not export it. No `frontend/**` file was touched.

### User review fixes (2026-10-22, before approval)
- **No hard-coded values in `backend/src`.** They now live in `backend/src/utils/`:
  - `http-status.ts`: the `HttpStatus` enum.
  - `error-code.ts`: the `ErrorCode` and `BodyParserErrorType` enums.
  - `domain.ts`: enums for severity, review status, source type, settings values, support issue type and priority. The DTO union types are derived from them.
  - `error-messages.ts`: the `ERROR_MESSAGE`, `ISSUE_MESSAGE`, `SUBJECT` and `FIELD` constants.
  - `limits.ts`: `LIMIT`.
  - `constants.ts`: API paths and router sub-paths, headers, log level, operation and message, password hash, ticket format, time units, patterns, and stub analyzer defaults and weights.
  - Response texts and status codes are unchanged, so no test or contract change was needed.
- **Configuration:** the new `backend/src/config.ts` `loadConfig(environment)` validates `PORT` and `FRONTEND_URL` with zod and has no fallback values. `createApp({ frontendUrl }, option)` no longer has a default URL. `index.ts` calls `loadConfig({})` behind a HUMAN TODO, because the guardrail stops an agent from writing the process environment expression. Until the human edits it, the server stops at startup with a clear message. Tests: `tests/config.test.ts`.
- **Frontend:** removed the `parseDataSource` test in `frontend/tests/unit/domain.service.test.ts`, because the user removed the function on purpose.
- **Results:**
  - Backend: 13 files, 194 passed in shuffled order; typecheck clean.
  - Frontend: 453 passed, plus 8 tests marked as known defects (expected to fail).
