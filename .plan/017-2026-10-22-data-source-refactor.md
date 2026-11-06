# Frontend Data Source Refactor

Status: done
Owner: Ilana
Last updated: 2026-10-22

## Goal
- Remove the mock/API split in the service layer. Every domain service gets **one** implementation that talks to a **data source**; which data source is used (local JSON or the real HTTP API) is chosen once from a `VITE_DATA_SOURCE` env variable. Adding a data source must not require editing any domain service (Open/Closed).
- Move all mock data out of TypeScript into JSON files, read by the JSON data source.
- Replace the `attempt` function in `api.service.ts` with a simple `request<T>(method, url, body?)` that does one `fetch` call and either returns the parsed response or throws an `AppError` (single responsibility).

## Scope
- Frontend only (no `stack:full`); no Figma attached. Branch: `chore/data-source-refactor` (built on `feat/model-layer-redux-services`, plan 016, not yet merged). No backend work: the backend is the next backlog item.
- In scope:
  1. **Data source contract** (`frontend/src/services/data-source.ts`, new):
     ```ts
     export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
     export interface DataSource {
       request<T>(method: HttpMethod, url: string, body?: unknown, option?: { signal?: AbortSignal; query?: Query }): Promise<T>
     }
     ```
     Both data sources implement it and speak the shapes in `.orchestrate/api-contract.yaml`, so services cannot tell them apart. `get`/`post`/`put`/`patch`/`delete` shortcuts stay as one-line helpers over `request`.
  2. **HTTP data source** (`api.service.ts`, rewritten):
     - `request<T>` builds the URL, calls `fetch` once with JSON headers and body, and:
       - network failure → throws `AppError` kind `network`;
       - non-2xx → throws the `AppError` built by a separate `AppError.fromResponse(status, body)` (the status → code/kind mapping moves out of the request function into `models/app-error.ts`);
       - `204` → `undefined`; otherwise returns the parsed JSON (malformed JSON → `AppError` kind `parse`).
     - Removed: the per-request timeout timer, `untilAborted`, the retry loop and backoff, and `API_TIMEOUT_MS` / `API_RETRY_COUNT` / `API_RETRY_DELAY_MS` from `lib/config.ts` (see Open Question 3). The caller's `signal` is still passed straight to `fetch`, because `fetchReview` cancels a stale load when the route id changes.
  3. **JSON data source** (`frontend/src/services/json-data-source.ts`, new): a small route table (`method` + path pattern → handler) that serves every route the services call (`/api/review`, `/api/review/{id}`, `/api/dashboard`, `/api/github/connect`, `/api/github/repo`, `/api/github/repo/{repoId}/file`, `/api/settings`, `/api/support-request`) from the JSON files, keeps user writes (save, rename, delete review; settings) in browser storage through `storage.service`, and throws the same `AppError`s the API would (404 `notFound`, 422 `validation`). An unknown route throws `notFound`. Behaviour moved here unchanged from today's mock services: saved name replaces the title, deleted reviews are hidden, `create` keeps session-only reviews, delete rolls back on a failed storage write, the support request waits `mockSupportDelayMs`.
  4. **One implementation per domain service**: `createReviewService(source)`, `createDashboardService(source)`, `createGithubService(source)`, `createSettingsService(source, storage)`, `createSupportService(source)`. All `createMock*Service` and `createApi*Service` functions are deleted; services no longer import from `src/mocks/`.
  5. **Selection in one place** (`services/index.ts`): `createServices` gets the data source from `createDataSource(DATA_SOURCE)` (a map `{ json: createJsonDataSource, api: createApiService }`, so a new source is one entry) and builds each service once. `ServicesOption` takes `dataSource?: DataSource` (an instance, so tests inject a fake) instead of the `'mock' | 'api'` string.
  6. **Env variable** `VITE_DATA_SOURCE=json|api`, default `json`, read once in `lib/config.ts` through the existing `parseDataSource()`; add `frontend/.env.example` with `VITE_DATA_SOURCE=json` and `VITE_API_URL=http://localhost:3001` (see Open Questions 1 and 2).
  7. **Mock data to JSON** (`frontend/src/mocks/*.json`): `review.json` (reviews by id, the new-review template, generated test files), `dashboard.json` (stats, severity and category counts, activity by range, recent reviews), `github.json` (account, repos, files by repo), `settings.json` (account; see Open Question 5). Data is typed on import by a guard from `models/` (`parseDto`), never by an `as` cast. The `src/mocks/*.ts` files are deleted.
  8. **UI constants that are not data** (option lists and static content that no service serves) move out of `src/mocks/` to `src/lib/` constants files (see Open Question 4): `languageList`, `frameworkList`, `testTypeList`, `activityRangeList`, `recentPreviewCount`, `wizardStepList`, `sectionList`, `notificationList`, `fontSizePx`, `autoLanguage`, `defaultSettings`, and the Help content (`topicGroupList`, `guideOf`, `featureList`, `issueList`, `errorList`, `issueTypeOptionList`, `priorityOptionList`).
  9. **Tests**: rewrite `api.service.test.ts` for `request<T>` (success, 204, network, each status → code, malformed JSON, signal pass-through); replace mock-vs-API service tests in `domain.service.test.ts`, `review.service.test.ts`, `qa-regression.test.tsx` with (a) one test per service against a fake `DataSource` and (b) JSON-data-source route tests, including the storage-failure rollback cases from QA. Remove the timeout and retry tests. Update test imports from `src/mocks/*.ts` to the JSON files or `src/lib/` constants.
  10. **Docs**: `.doc/architecture.md` "Frontend layers" (diagram and text: data source layer, JSON vs HTTP, env variable), `.doc/glossary.md` (term **data source**), and a short note at the top of `.orchestrate/api-contract.yaml` that the JSON data source serves the same contract.
- Out of scope: the backend; switching the default to `api`; new routes or contract shape changes (except Open Question 5 if chosen); UI or behaviour changes; the "Integrate the frontend with the backend" task.

## Assumptions
- Behaviour and visuals stay the same: all existing unit and e2e tests keep passing except those that test removed code (mock/API service factories, retry, timeout), which are replaced as in Scope 9.
- Vite imports JSON natively and `resolveJsonModule` works with the current tsconfig (it is added to `tsconfig.app.json` / `tsconfig.test.json` if needed).
- Existing browser storage keys stay the same (`saved-reviews`, `deleted-reviews`, `cr.settings`), so users keep their saved reviews and settings.
- Paths stay singular and match the contract (`.claude/rules/naming.md`); new files follow `<name>.service.ts` / kebab-case names. No trailing semicolons (`.claude/rules/code-style.md`).
- Errors keep the standard shape and user messages from `utils/error-messages.ts`; nothing above the service layer calls `fetch` or browser storage (the architecture test keeps checking that).
- Generated artifacts go to `.orchestrate/`; no `docs/` directory.

## Open Questions
1. **The env variable is blocked by a guardrail.** **DO not change the gurdrail file: I Choose B - Adding the line by hand**  `.claude/hooks/ block-secret-file-access.js` rejects any tool call whose text contains a dot followed by `env`. That includes Vite's env-variable expression (`import.meta` followed by its env object), so an agent cannot write the line in `lib/config.ts` that reads `VITE_DATA_SOURCE` (plan 016 hit the same wall). Options:
   - **(A) Recommended:** narrow the hook regex so it blocks dotenv *files* only (a file path whose name starts with the dotenv prefix, including its `local` / mode variants) and no longer matches the Vite expression. A one-line hook change that you review; the agent then writes the config line.
   - (B) You add the one line by hand after the agent finishes: `DATA_SOURCE = parseDataSource(<Vite env object>.VITE_DATA_SOURCE)`, the same pattern `API_URL` already uses. The hook stays as it is.
   - (C) Read the variable in `vite.config.ts` with `loadEnv` and inject it with `define`. It avoids the hook's pattern but works around a guardrail, so not recommended.

2. **Name of the local data source value.** Recommended: **`json`** (`VITE_DATA_SOURCE=json|api`), since there are no "mock services" any more and the data now lives in JSON. Alternative: keep `mock`.
3. **What `request<T>` keeps.** Recommended: **one `fetch`, the caller's `signal` passed through, no timeout and no retry**; status-to-error mapping lives in `AppError.fromResponse`. Alternative: keep a timeout with a one-liner `AbortSignal.any([signal, AbortSignal.timeout(ms)])` (it adds a little to the simple function).
4. **Static UI content currently in `src/mocks/` (option lists, Help page text).** It is not data any service returns. Recommended: **move it to `src/lib/` constants files** (for example `lib/review.constants.ts`, `lib/help.constants.ts`) and leave only service data in JSON. Alternative: move it all to JSON too (Help text included) and import the JSON in components.
5. **Account details and the demo password** (`mockAccount`, `mockPassword`) are read directly by `AccountPanel`, `ContactSupportForm` and `SecurityPanel`, not through a service. Recommended: **move them to `mocks/settings.json` and keep the direct import for now**; serving them through a service and a `GET /api/account` route is left to the backend task. Alternative: add `GET /api/account` to the contract and an account read to `settings.service` in this task.

**Answers (approved 2026-10-22):** 1 → **(B)**: the guardrail is not changed. The agent leaves `DATA_SOURCE` in `lib/config.ts` as the constant `'json'`, keeps `parseDataSource()` ready, and adds a comment that names the one line to add by hand. The human adds that line after the agent finishes. The agent still creates `frontend/.env.example`, which the hook allows. 2 → `json`. 3 → no timeout, no retry, `signal` passed through. 4 → UI constants go to `src/lib/`. 5 → account and demo password go to `mocks/settings.json`, imported directly.

## Steps
1. Branch `chore/data-source-refactor` (done).
2. Answer the Open Questions; if 1(A), narrow the hook regex (human review) before the agent starts.
3. Add `data-source.ts`; rewrite `api.service.ts` as the HTTP data source with `request<T>`; move status mapping to `AppError.fromResponse`; trim `lib/config.ts`.
4. Convert `src/mocks/*.ts` to `src/mocks/*.json` with guards; move UI constants to `src/lib/`; update component imports.
5. Add `json-data-source.ts` with the route table, carrying over the mock services' behaviour.
6. Collapse each domain service to one implementation on `DataSource`; rewrite `services/index.ts` selection; wire `VITE_DATA_SOURCE` and add `frontend/.env.example`.
7. Update and replace tests (Scope 9).
8. Update docs (Scope 10) and record any deviation in this plan.
9. Run the validation commands; write `.orchestrate/frontend-agent-report.md`.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- `npm run test:e2e` passes with no regressions in the existing specs (the app runs on the `json` data source).
- `grep -rn "createMock\|createApi[A-Z]" frontend/src` finds nothing; no domain service file imports from `src/mocks/`; `services/index.ts` has no `dataSource === 'api'` branch.
- `frontend/src/mocks/` contains only `.json` files.
- `api.service.ts` has no `setTimeout`, retry loop or `untilAborted`; `request<T>` is a single `fetch` call. Unit tests cover: 2xx JSON, 204, network error, 400/401/404/408/422/500 mapped through `AppError.fromResponse`, malformed JSON, and that the caller's `signal` reaches `fetch`.
- Each domain service has a unit test against a fake `DataSource` (method, url, body sent; response parsed; malformed response → `parse` error).
- JSON data source tests: every contract route above answers in the contract shape; unknown route → `notFound`; save, rename, delete persist through storage and survive a new data source instance; delete rolls back when the second storage write fails; invalid support request → `validation`.
- `parseDataSource` maps `'api'` → `api`, anything else (including missing) → `json`; `createServices({ dataSource: fake })` uses the injected source for every service.
- Manual check: `npm run dev` with no local env file behaves as today; with `VITE_DATA_SOURCE=api` and no backend running, each page shows its error toast once.
- `.doc/architecture.md`, `.doc/glossary.md` and the contract note are updated.

## Risks
- **Behaviour drift while moving mock logic** into the JSON data source (saved names, deleted reviews, rollback). Mitigation: port the existing mock-service tests to the JSON data source before deleting the old code.
- **Losing timeout and retry** means a hung request in API mode waits for the browser's own limit. Acceptable while there is no backend; revisit in the integration task (Open Question 3).
- **JSON typing**: imported JSON loses literal union types (`'high'`, `'completed'`). Mitigation: validate with the existing guards instead of `as` casts.
- **Guardrail change** (Open Question 1A) widens what the agent may touch. Mitigation: the new regex still blocks every real dotenv file; you review the diff.
- Large test churn in `domain.service`, `review.service` and `qa-regression` tests.

## Rollout Order
1. Hook change, if 1(A) is approved.
2. Data-source contract and the HTTP data source with its tests.
3. JSON files, UI constants, JSON data source with its tests.
4. Single-implementation services and the selection in `services/index.ts`, env variable and the example env file.
5. Remaining test updates, docs, full validation, QA.

## Rollback
- The work sits on its own branch; nothing reaches `master` until you approve a merge. To roll back, abandon or revert the branch commits; browser storage keys are unchanged, so no user data needs migrating.
- If only the env wiring is a problem, set `DATA_SOURCE` back to the constant `json` in `lib/config.ts`; the rest of the refactor still works.

## Implementation Notes and Deviations
- **The example env file in `frontend/` (Scope 6) was not created.** The Write was stopped by `.claude/hooks/require-approval-auth-files.js` ("protected path (auth/security boundary), requires explicit human approval"). The hook was not changed or worked around. The human creates it with two lines: `VITE_DATA_SOURCE=json` and `VITE_API_URL=http://localhost:3001`.
- **`DATA_SOURCE` is still the constant `'json'`** (decision 1B). A comment in `lib/config.ts` names the line the human adds; `parseDataSource()` maps `'api'` → `api`, anything else → `json`. The config type was renamed `DataSource` → `DataSourceName` so it does not clash with the new `DataSource` interface.
- The validation grep `createApi[A-Z]` matches `createApiService`. Scope 5 names that function as the HTTP data source factory, so the name stays. No `createMock*Service` or per-domain `createApi*Service` remains.
- Shortcut helpers are free functions in `data-source.ts` (`get`, `post`, `put`, `patch`, `del`; `delete` is a reserved word). The `DataSource` interface only has `request`.
- `api.service` reports a fetch that fails after the caller's signal aborted as kind `abort`, not `network`, so a cancelled review load never raises a toast. That was the behaviour before.
- New supporting files: `services/json-data.ts` (the JSON parsed once with the model guards, also used as test fixtures through `tests/utils/mockData.ts`); `models/github.model.ts` (the GitHub guards moved out of `github.service.ts`); `isRecordOf` in `models/guard.ts`; `tests/utils/fakeDataSource.ts`; `tests/unit/json-data-source.test.ts`. The `saved-reviews` / `deleted-reviews` key constants and `mockSupportDelayMs` moved to `json-data-source.ts`. `settingsStorageKey` stays in `settings.service.ts`.
- UI constants went to `lib/review.constants.ts`, `lib/dashboard.constants.ts`, `lib/github.constants.ts`, `lib/settings.constants.ts` and `lib/help.constants.ts`. The architecture test's "error text only in utils/error-messages.ts" rule now also allows `lib/help.constants.ts`, because the Help page's Error messages table quotes those texts. Before this plan the rule skipped `src/mocks/`.
- `review.json` holds `template`, `generatedTestList` and `reviewById` (per-id title, status, language and age over the template). The recent review rows live in `dashboard.json` `recentReviewList`. The values were generated from the old TS mocks, so the data is unchanged.
- The JSON data source returns `GET /api/review/{id}` in the contract shape: saved edits applied, plus `savedAt`. The one review service builds `saved` from it, so `saved.name` is now the applied title even when no name was saved. The UI shows the same values. Request bodies on write routes are checked, and a bad body throws 422 `validation`. The old mock did not check them.
- `settings.service.get()` now caches the merged settings under `cr.settings` with any data source. For the JSON source that is the same record it reads from.
- `resolveJsonModule` was not needed. The `bundler` resolution already types JSON imports, so the tsconfigs are unchanged.
- QA defect 3 tests (timeout and stalled body, retry, 408 retry) were removed along with the timeout and retry (Open Question 3). The caller abort and the 408 → `timeout` mapping are covered in `api.service.test.ts`.
- Manual check (`npm run dev` with `VITE_DATA_SOURCE=api`) was not run. It needs the hand-added config line.
