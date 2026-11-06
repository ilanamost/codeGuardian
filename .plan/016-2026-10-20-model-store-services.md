# Frontend Model Layer, Redux Store and Services

Status: done
Owner: Ilana
Last updated: 2026-10-20

## Goal
- Give the frontend a proper layered structure: a **model layer** (interfaces and classes), a **Redux store**, and a **business layer of services**. Components dispatch actions, the store calls the API through a service, and failures reach the user as notification messages that respect the Settings preferences, with all error texts kept as constants in one util file.

## Scope
- Frontend only (no `stack:full`); no Figma attached. Branch: `feat/model-layer-redux-services`. No backend work and no real backend integration (that is the later "Integrate the frontend with the backend" backlog item).
- In scope:
  1. **Model layer** (`frontend/src/models/`):
     - Interfaces for the API shapes (DTOs): `ReviewDto`, `ReviewSummaryDto`, `DashboardDto`, `GithubRepoDto`, `SettingsDto`, `SupportRequestDto`, mirroring `.orchestrate/api-contract.yaml`.
     - Classes for the domain: `Review` (with `fromDto`, `toSummary`, derived values such as finding counts and `hasCriticalFinding`), `ReviewSummary`, `Finding`, `Suggestion`, `GeneratedTestFile`, `Dashboard`, `AppSettings` (defaults and `merge`), and `AppError` (extends `Error`; fields `code`, `kind`, `status?`, `userMessage`, `cause?`).
     - `src/types/index.ts` keeps exporting the existing types (re-exports or aliases) so UI-only types and current imports keep working; nothing is renamed in one shot.
  2. **Services** (`frontend/src/services/`, named `<domain>.service.ts` per `.claude/rules/naming.md`):
     - `api.service.ts`: the only code that calls `fetch`. Base URL from `API_URL` (`VITE_API_URL`), JSON in and out, request timeout via `AbortController`, maps network, timeout and HTTP status failures to `AppError` using the standard error shape (`error.code`, `error.message`, `requestId`) from `.rule/error-handling-rules.md`; bounded retry with backoff for transient GET failures only.
     - `storage.service.ts`: typed, safe `localStorage` wrapper (`get<T>`, `set`, `remove`, `has`, JSON parse guards, try/catch, returns a result or throws `AppError` with kind `storage`); replaces every direct `window.localStorage` use (`savedReviews.ts`, `SettingsProvider.tsx`).
     - `util.service.ts`: pure helpers shared by services and components (`delay`, `clamp`, `isNonEmptyString`, `truncate`, `formatTimeAgo`, `createId`, `groupBy`), with the helpers that currently sit inline in components moved here.
     - Domain services: `review.service.ts` (list, get, create, save, rename, delete), `dashboard.service.ts`, `github.service.ts`, `settings.service.ts`, `support.service.ts` (replaces `lib/supportApi.ts`), `report.service.ts` (wraps the existing PDF builder from `lib/reportPdf.ts`), `notification.service.ts` (toast wrapper, see item 5).
     - Every domain service exposes one async interface and has two implementations behind it: an **API implementation** that calls `api.service` and a **mock implementation** that reads `src/mocks/` and `storage.service`. The mock is the default until the backend exists (see Open Question 1).
  3. **Redux store** (`frontend/src/store/`, Redux Toolkit): `index.ts` (`configureStore`, with the services injected as the thunk `extra` argument so tests can pass fakes), `hooks.ts` (typed `useAppDispatch`, `useAppSelector`), and slices with `createAsyncThunk` thunks that call services only (never `fetch` or `localStorage` directly):
     - `review.slice.ts`: `list`, `current`, `status` (`idle|loading|succeeded|failed`), `error`; thunks `fetchReviewList`, `fetchReview`, `saveReview`, `renameReview`, `deleteReview`.
     - `dashboard.slice.ts`: stats, charts data, activity range; `fetchDashboard`.
     - `github.slice.ts`: account, repo list, selected repo, file list; connect, search, select thunks.
     - `settings.slice.ts`: replaces the `SettingsProvider` state (same shape as `SettingsState`); persisted through `settings.service`. `useSettings()` stays as a thin facade over the store so existing components keep working.
     - `support.slice.ts`: submit status and ticket.
     - `main.tsx` wraps the app in `<Provider store={store}>`.
  4. **Wire the UI to the store** (behaviour unchanged): Review Results, Review History, Dashboard, GitHub wizard, Settings panels, Contact Support form read from selectors and dispatch thunks. Component-local UI state (open accordion, input text, active tab) stays local.
  5. **Error handling with notifications**:
     - `frontend/src/utils/error-messages.ts` (new util file): constants for every user-facing error text (`ERROR_MESSAGE.network`, `.timeout`, `.unauthorized`, `.notFound`, `.validation`, `.storage`, `.reviewLoad`, `.reviewSave`, `.reviewDelete`, `.reviewRename`, `.reportPdf`, `.dashboardLoad`, `.githubConnect`, `.githubRepoLoad`, `.supportSubmit`, `.unknown`), plus an `ERROR_CODE` to message map. The wording is aligned with the Help page "Error messages" table.
     - A store listener middleware turns every rejected thunk into an `AppError` and calls `notification.service.notifyError(error)`. Services never show toasts; components never hard-code error strings.
     - `notification.service` shows the toast with `sonner` **only if the Settings preference allows it**. Review-related errors (load, save, rename, delete, report, review polling) follow the `reviewFailed` preference; critical-finding notices follow `criticalFinding`; the `email` preference is out of scope until a backend sends email. Errors that are not about a review (network outage, storage, GitHub, support, settings) are always shown, so the user is never left without feedback (see Open Question 2). **Refined by the user after QA round 1:** network, timeout and storage failures are always shown even during a review action; only domain failures (review failed, not found, validation, server) of review actions follow `reviewFailed`. Duplicate toasts for the same error code within 2 seconds are collapsed.
     - Existing ad-hoc `toast.error(...)` calls move to this path.
  6. **Docs and contract**: update `.doc/architecture.md` (layers, data flow diagram, folder layout), `.doc/glossary.md` (terms: model, DTO, service, store, slice, thunk, app error), and `.orchestrate/api-contract.yaml` with the endpoints the API services call (comment block plus paths for reviews, dashboard, settings, GitHub, support), without implementing them.
- Out of scope: backend implementation, switching the app to the real API, auth, email delivery, replacing `sonner`, moving server state to RTK Query (see Open Question 4), unrelated UI changes.

## Assumptions
- Redux Toolkit and `react-redux` are added as dependencies (`@reduxjs/toolkit`, `react-redux`); the backlog says "Redux store", so Redux Toolkit is the standard way to build it.
- Behaviour and visuals stay the same; this is a restructuring. The 214 unit and 50 e2e tests from the last task must keep passing, with tests rendering through a `renderWithStore` helper in `frontend/tests/`.
- The backend routes do not exist yet; the real API paths follow the existing contract and the backlog (`/api/review`, `/api/dashboard`) and are singular per `.claude/rules/naming.md`.
- Coding style from `.rule/coding-rules.md`: no trailing semicolons. UI rules: `sonner` for toasts, `lucide-react` for icons.
- User input and stored data are validated when read (`storage.service` guards, DTO to class mapping rejects malformed payloads) per `.rule/security-rules.md`; nothing sensitive is stored in `localStorage` and error messages never include stack traces or raw payloads.
- Glossary terms are documented before broad use (see Scope item 6).
- No new `docs/` directory; plan, ticket and report files go to `.plan/` and `.orchestrate/`.

## Open Questions
1. How should services choose between mock and API? Recommended: an env flag **`VITE_DATA_SOURCE=mock|api`, default `mock`**, read once in `config.ts`; the store and components never know which one is active. Alternative: always mock until integration (no flag) or always call the API now (the app would break without a backend).
## I want to always mock until integration
2. Which notifications follow the Settings preferences? Recommended: **review-related errors follow `reviewFailed`, critical-finding notices follow `criticalFinding`, all other errors (network, storage, GitHub, support, settings) are always shown** so failures are never silent. Alternative: add a new "Error notifications" toggle to Settings (a UI change not requested), or gate every error behind `reviewFailed`.
3. Where do the error-message constants live? Recommended: **`frontend/src/utils/error-messages.ts`** (a new `utils/` folder) because the backlog says "the relevant util file"; success texts stay where they are for now. Alternative: put them in `util.service.ts` or `lib/`.
4. Redux Toolkit `createAsyncThunk` or RTK Query for API calls? Recommended: **`createAsyncThunk` with injected services**, which matches "the store should call the API using a service" literally and keeps the service layer testable. RTK Query would replace the services with generated hooks.
5. Persist the Redux state? Recommended: **only settings and saved reviews are persisted, through `storage.service`**; the rest is refetched. No `redux-persist` dependency.
6. Class or interface for each model? Recommended: **classes for domain objects with behaviour (`Review`, `Dashboard`, `AppSettings`, `AppError`), plain interfaces for DTOs and UI-only shapes**, to avoid class boilerplate for pure data.
7. File naming for the new folders? Recommended: **`<name>.service.ts` and `<name>.slice.ts` (kebab or lowercase, singular)** as in the naming rules, while existing `lib/` files keep their names until they are moved.
8. The contract file path: `.orchestrate/api-contract.yaml` exists, while the backlog and some docs say `.orchestration/api-contract.yaml`. Recommended: **keep updating `.orchestrate/api-contract.yaml`** (the one that exists) and fix the old references in docs and agent files in this task. Please confirm.

## Steps
1. Branch `feat/model-layer-redux-services` (done).
2. Install `@reduxjs/toolkit` and `react-redux`; add `VITE_DATA_SOURCE` to `config.ts` and `.env.example`.
3. Models: `src/models/` (DTO interfaces, domain classes, `AppError`) with unit tests for `fromDto`, derived values, and `AppError` shape; re-export from `types/index.ts`.
4. `util.service.ts`, `storage.service.ts`, `api.service.ts` with unit tests (storage failure paths, JSON guards, timeout, status to `AppError` mapping, retry limits, standard error shape parsing).
5. `utils/error-messages.ts` and `notification.service.ts` with tests for preference gating (enabled, disabled, non-review errors always shown) and de-duplication.
6. Domain services with mock and API implementations, and tests for both (the API implementation with a mocked `fetch`); move `supportApi.ts` and `reportPdf.ts` behind `support.service` and `report.service`; keep `savedReviews.ts` behaviour inside `review.service` (same storage keys `saved-reviews`, `deleted-reviews`, `cr.settings` so users keep their data).
7. Store: `store/index.ts`, `hooks.ts`, slices and thunks with injected services; listener middleware for error notifications; reducer and thunk tests with fake services.
8. Migrate the UI page by page (Settings and Help, then Dashboard, Review History, Review Results, GitHub wizard), deleting the replaced `lib` code and `SettingsProvider`; keep `useSettings()` as a facade.
9. Add `renderWithStore` test helper; update existing tests; add component tests for loading, error (toast shown or suppressed per preference) and empty states; Playwright: a forced API failure (route abort) shows the expected error toast and none when the preference is off.
10. Docs and contract: `.doc/architecture.md`, `.doc/glossary.md`, `.orchestrate/api-contract.yaml`; fix `.orchestration` references; update this plan with any deviation.
11. Frontend agent definition note: `.claude/agents/frontend.md` still says Next.js; align it with Vite + React (only if the user agrees, it is not part of the code change).

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass; `npm run test:e2e` passes with no regressions in the existing specs.
- Coverage of new code: every service, slice, thunk, `AppError` mapping and the notification gating has unit tests, including failure paths (network down, timeout, 401, 404, 422, 500, malformed JSON, storage full or blocked).
- Manual check with `npm run dev` in mock mode: every page behaves as before; with `VITE_DATA_SOURCE=api` and no backend running, each page shows the right error toast once (not repeated), and nothing shows when the matching Settings notification is turned off (and non-review errors still show).
- Static checks: no `fetch` or `localStorage` use outside `api.service.ts` and `storage.service.ts`; no hard-coded error strings outside `utils/error-messages.ts` (a grep check in a unit test); no trailing semicolons.

## Risks
- A broad refactor touching most pages can cause regressions; mitigate by migrating page by page with the full test suite after each, and keeping UI-local state local.
- Two sources of truth during migration (context and store) for settings; mitigate by replacing `SettingsProvider` in one step behind the `useSettings()` facade.
- Class instances in Redux state are non-serializable and break Redux Toolkit's serializability check; mitigate by storing plain DTO-shaped state and constructing classes in selectors (or mapping at the service boundary) and documenting the rule.
- Over-engineering for mock data; mitigate by keeping services small and one interface per domain.
- Error toasts can spam the user (polling, retries); mitigate with de-duplication, bounded retries and no toast for aborted requests.
- Mock and API implementations can drift; mitigate with a shared contract test run against both implementations.
- Unknown preference semantics: `reviewFailed` is described as "review fails or cannot be completed", so using it for save, delete and report failures is an interpretation (Open Question 2).

## Rollout Order
1. Dependencies, models, util, storage and api services. 2. Error constants and notification service. 3. Domain services (mock and API). 4. Store, slices and middleware. 5. UI migration page by page (Settings and Help, Dashboard, Review History, Review Results, GitHub wizard). 6. Tests, docs and contract.

## Rollback
- Revert the `feat/model-layer-redux-services` branch or its commits; no data migration is involved because the `localStorage` keys (`saved-reviews`, `deleted-reviews`, `cr.settings`) are unchanged. If a late page migration causes problems, revert only that page's commit, since the facade (`useSettings()`) and the unchanged UI types keep the other pages working.

## Implementation Notes and Deviations
Recorded by the frontend agent while executing Steps 2 to 10 (Open Questions 1 to 8 answered with the recommended options).
- **`VITE_DATA_SOURCE` not wired (Step 2).** The secret-file guardrail (`.claude/hooks/block-secret-file-access.js`) blocks any edit whose text contains the dotenv pattern, and that includes Vite's environment-variable expression (`import.meta` followed by its env object). So `lib/config.ts` cannot read the flag. `DATA_SOURCE` is the constant `'mock'` (which matches the note on Open Question 1) and `parseDataSource()` is ready; the missing line passes the Vite variable `VITE_DATA_SOURCE` through `parseDataSource`. A human needs to add it or adjust the hook. The env example template file in `frontend/` was not created either, because the auth-file guardrail requires human approval for that path.
- **Playwright "forced API failure" (Step 9).** Because the dev server can only run in mock mode, the e2e spec (`tests/e2e/error-notification.spec.ts`) forces the failure at the browser storage layer (save and delete), checks there is one toast, and checks there is none when "Review failed" is off. The API-mode failure path (fetch failing, toast shown once, suppressed by the preference, non-review errors still shown) is covered at component level in `tests/unit/StoreStates.test.tsx` with a failing `fetch`.
- **Activity range stays component state** (Scope 3 listed it in the dashboard slice). This keeps the old behaviour: the range resets when the page is left.
- **Settings persistence in mock mode stays silent on storage failure**, as `SettingsProvider` was (session-only settings, no toast on every toggle). In API mode a failed `PUT /api/settings` is always shown.
- **`review.service.get` returns `null` for an unknown or deleted id** (the API implementation maps 404 to `null`), so the page keeps showing "Review not found" without an error toast. Other load failures show a "Review unavailable" message and the toast.
- **Rename is persisted on Save, as before.** The `renameReview` thunk and `PATCH /api/review/{id}` exist and are tested but the UI still commits the name locally and saves it with Save review (no behaviour change).
- **Critical-finding notices**: `notification.service.notifyCriticalFinding` is gated by `criticalFinding` and tested. Nothing raises it automatically yet (no review polling exists); the Settings "Send test" button still uses the same gated path.
- **Inline form validation texts** (support form, password form) also moved to `utils/error-messages.ts` (`FORM_ERROR_MESSAGE`), so the grep check covers them.
- **Contract shapes**: `.orchestrate/api-contract.yaml` documents the frontend DTO shapes (camelCase) the API services call. The older backend draft in the `.orchestration/` folder (snake_case, 3 statuses) still exists and has to be reconciled in the integration task. `.gitignore` still lists `.orchestration/*-report.md`; it was not changed (outside this task's file list).
- **Step 11** (`.claude/agents/frontend.md` still says Next.js) is not done: it needs the user's agreement.

### QA round 1 fixes (2026-10-20)
- **Stale review responses**: `review.slice` stores the latest `fetchReview` requestId and ignores older results; `ReviewPage` aborts the previous request when the id changes (the thunk signal reaches `review.service` and `api.service`); the listener raises no toast for aborted or superseded requests (also for GitHub search and file loads).
- **Settings load race**: `fetchSettings` merges the loaded settings under fields the user changed while it was in flight (`mergeLoadedSettings`).
- **Body timeout**: `api.service` keeps the timer and the caller's abort active until the body is fully read; a stalled body rejects with a timeout AppError and the GET retry applies. HTTP 408 maps to a retryable timeout.
- **Delete atomicity**: the mock `review.service` delete records the deletion first and rolls it back if removing the saved edits fails.
- **Minor**: distinct hints for 403/404/409/422/429/5xx; Review page error texts moved to `PAGE_ERROR_MESSAGE`; Dashboard shows "Dashboard unavailable" with Retry on a failed load; contract and `lib/config.ts` wording now point to this plan and `.doc/architecture.md`.
- **User decisions**: (a) the notification policy above (the e2e spec now asserts a storage failure is shown with the preference off, and a PDF failure is silent with it off); (b) the data source stays fixed to `mock` until the integration task, so the deviation about the build flag is accepted as deferred; the guardrail hooks were not bypassed.
- Regression tests: `tests/unit/qa-regression.test.tsx` (ported from QA's adversarial cases), plus updates to `StoreStates`, `notification.service`, `store` and `models` tests and `tests/e2e/error-notification.spec.ts`.
