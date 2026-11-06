# Remove the Mock Data Source: The Frontend Works Only With the Real API

Status: done
Owner: Ilana
Last updated: 2026-11-01

## Goal
Remove the frontend's mock configuration, mock services and mock-only tests, so the app always talks to the real backend over HTTP. After this plan there is no `json` data source, no `VITE_DATA_SOURCE` switch, no mock mode and no `src/mocks/` folder.

## Scope
- Backlog item: "remove the mock configuration, services and tests. Make the frontend work directly with real api." No Figma. It is **frontend-only** (no `stack:full` marker): nothing under `backend/` changes. Branch: `feat/remove-mock-use-real-api`.
- **What the code does today** (read 2026-11-01):
  - `frontend/src/services/index.ts` builds a `dataSourceFactory` with two entries, `json` and `api`, chosen by `DATA_SOURCE` from `frontend/src/lib/config.ts` (`VITE_DATA_SOURCE`).
  - `frontend/src/services/json-data-source.ts` (566 lines) and `json-data.ts` (96 lines) serve `frontend/src/mocks/*.json` (7 files) plus browser storage.
  - `config.ts` derives `AUTH_REQUIRED` and `GITHUB_USERNAME_REQUIRED` from `DATA_SOURCE === 'api'`; the session slice, `RequireSession`, `App.tsx`, `GithubConnectCard`, `ReviewPage`, `Sidebar` and others branch on mock vs API.
  - Tests: `vite.config.ts` pins unit tests to `VITE_DATA_SOURCE: 'json'`; `tests/utils/mockData.ts` reads the JSON data; `tests/e2e/mock-mode.spec.ts` and a `mock-mode` Playwright project plus `mockFrontendServer` in `playwright.config.ts` run the app without a backend. About 20 unit test files import the JSON data source or `src/mocks`.
- **In scope:**
  1. Delete `src/services/json-data-source.ts`, `src/services/json-data.ts`, `src/mocks/`, and the `json` entry of `dataSourceFactory` in `src/services/index.ts`.
  2. Remove `DataSourceName`, `DATA_SOURCE` and the mock branches in `src/lib/config.ts`. `AUTH_REQUIRED` and `GITHUB_USERNAME_REQUIRED` are no longer needed: the session slice, `RequireSession`, `App.tsx` routes (`/login`, `/register` always present), `GithubConnectCard`, `ReviewPage`, `Sidebar`, `account.service.ts`, `dashboard.service.ts`, `github.service.ts`, `settings.service.ts`, `support.service.ts`, `review.service.ts`, `session.service.ts` and `github.slice.ts` lose their mock-only branches.
  3. Remove mock-only code paths and comments in the remaining source files that the search found (`reportPdf.ts`, `help.constants.ts`, `avatarFile.ts`, `useAvatarSrc.ts`, `route.constants.ts`, `types/index.ts`, `models/dto.ts`, `account.model.ts`, `util.service.ts`, `SecurityPanel.tsx`, `ReviewTabs.tsx`, `AccountDetailsForm.tsx`).
  4. Tests per Open Question 1: delete mock-only tests (`json-data-source.test.ts`, `qa-data-source.test.ts`, `qa-parity.test.ts`, `seed.test.ts`, `mock-mode.spec.ts`, mock-mode parts of `cross-stack`/`architecture` tests) and move the others onto the test-only fake data source.
  5. Playwright: remove the `mock-mode` project, `mockFrontendServer`, `MOCK_DATA_SOURCE` and `MOCK_FRONTEND_URL`; drop `VITE_DATA_SOURCE` from the remaining servers.
  6. Environment files: remove `VITE_DATA_SOURCE` from the frontend env files and the example file (names only; secret files are not read or printed). Keep `VITE_API_URL`.
  7. Docs: `.doc/product-definition.md` (drop "Mock mode" lines), `.doc/architecture.md`, `.doc/glossary.md` (mock/data source terms), `README.md` (the backend must run for the frontend to work), and `.orchestrate/api-contract.yaml` only if it mentions mock mode.
- **Out of scope:**
  - The loader component (separate backlog item) and GitHub OAuth.
  - The backend's own stub analyzer and fake GitHub used by backend and e2e tests (they are backend test doubles, not the frontend mock).
  - Any behaviour change for signed-in users with the real backend.
  - Offline or demo mode for the frontend.

## Assumptions
- The `api` data source (`api.service.ts`, `createApiService({ handshake: true })`) is complete: every call a mock-mode page makes already has a real endpoint (plans 018, 019, 028, 030, 034).
- `DataSource` (`data-source.ts`) stays as the interface between domain services and HTTP; only the second implementation goes away. Unit tests keep injecting `createFakeDataSource` (`tests/utils/fakeDataSource.ts`) through `createServices({ dataSource })`.
- With no backend running, the app shows its existing error states and the sign-in page (no special offline UI).
- Test fixtures that still need sample data keep it in `tests/`, not in `src/`.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **What happens to the unit tests that currently run on the JSON data source (about 20 files)?**
   - A. **Move them onto the test-only fake data source and fixtures in `tests/` (recommended).** Keeps fast, backend-free unit tests; only `src/` loses the mock. Fixtures move to `tests/fixtures/*.json`.
   - B. Delete them and rely on the Playwright suite against the real backend. Less to maintain, but much slower feedback and lower coverage of edge cases.

   **Answer:**

2. **Do you want the sample data kept anywhere?**
   - A. **Only as test fixtures under `tests/fixtures/` (recommended).** Nothing under `src/`.
   - B. Delete it completely; tests build their own data inline.

   **Answer:**

3. **Should `VITE_DATA_SOURCE` be removed outright?**
   - A. **Yes, remove the variable and its documentation (recommended).** One way to run the app, no dead switch.
   - B. Keep it accepted but only allow `api`, failing at startup for any other value. Safer for people with an old env file, but keeps a switch that has one position.

   **Answer:**

4. **What should the app show when the backend is not running?**
   - A. **The existing error notification and error states only (recommended).** The loader item in the backlog improves loading states afterward.
   - B. Add a dedicated "Cannot reach the server" screen now.

   **Answer:**

**Answers (approved 2026-11-01, recommended options; no inline answers were found in this file):**
- 1: A. Unit tests move onto the test-only fake data source and fixtures in `tests/`.
- 2: A. Sample data kept only as fixtures under `tests/fixtures/`.
- 3: A. `VITE_DATA_SOURCE` is removed outright.
- 4: A. Existing error notification and error states only.

## Steps
1. Create the branch (done) and run the current unit suite once to record the baseline pass count in the QA report.
2. Source: delete `json-data-source.ts`, `json-data.ts` and `src/mocks/`; simplify `services/index.ts` to build `createApiService({ handshake: true })` directly (keep the `dataSource` override for tests); remove `DATA_SOURCE`, `DataSourceName`, `AUTH_REQUIRED` and `GITHUB_USERNAME_REQUIRED` and every branch that read them. Run `npx tsc --noEmit` after each group of files.
3. Source clean-up of leftover mock wording and unused exports in the files listed in Scope item 3. Use the repository terms from `.doc/glossary.md`.
4. Tests per Open Questions 1 and 2: delete the mock-only tests; rewrite the others to inject `createFakeDataSource`; move needed JSON data to `tests/fixtures/` and update `tests/utils/mockData.ts` to read from there (rename it if the name says "mock" and nothing else uses the word).
5. Config: `vite.config.ts` test env (remove `VITE_DATA_SOURCE: 'json'`), `playwright.config.ts` (remove the `mock-mode` project and server), `playwright.encrypted.config.ts`, `tests/e2e/e2e.constants.ts`, env example file.
6. Docs per Scope item 7.
7. Run the full validation below. Fix failures; do not skip or weaken tests.

## Validation
Each item is provable by a command or a test (QA checklist).
1. `grep -ri "json-data\|src/mocks\|VITE_DATA_SOURCE\|DATA_SOURCE\|AUTH_REQUIRED\|GITHUB_USERNAME_REQUIRED\|createJsonDataSource" frontend/src frontend/tests frontend/*.ts` returns nothing (documentation excepted for historical plans in `.plan/`).
2. `frontend/src/mocks/`, `src/services/json-data-source.ts` and `src/services/json-data.ts` do not exist.
3. `cd frontend && npx tsc --noEmit` and `npm run lint` pass.
4. `cd frontend && npm test` passes. The pass count is reported against the baseline, and every removed test file is listed with the reason (mock-only).
5. A unit test proves `createServices()` with no override builds services on the HTTP data source (calls `fetch` for `GET /api/...`) and never reads browser storage as a data store.
6. `cd frontend && npx playwright test` passes against the real backend (default and encrypted projects); there is no `mock-mode` project.
7. Opening the app with no backend running shows the sign-in page and, after submitting, the existing error notification (manual check, one e2e if cheap).
8. `/login` and `/register` routes always exist, and an unauthenticated visit to `/` redirects to `/login` (unit test).
9. `.doc/product-definition.md`, `.doc/architecture.md`, `.doc/glossary.md` and `README.md` contain no "mock mode" or `VITE_DATA_SOURCE` instruction.

## Risks
- **Hidden coupling to mock behaviour.** Some components may rely on mock-only behaviour (instant responses, no login). Mitigation: the Playwright suite already runs against the real backend; fix any real regression it shows.
- **Large test rewrite (about 20 files).** Mitigation: move them in small groups and run the suite after each group; keep assertions unchanged where possible.
- **Weaker coverage by deleting tests.** Mitigation: only tests of the JSON source itself and mock mode are deleted; the list is reported.
- **Old env files** that still set `VITE_DATA_SOURCE=json` are ignored by the app (Open Question 3A); a README note says so.
- **Secrets.** Env files are never read or printed; only variable names are edited.

## Rollout Order
1. Source removal and config (steps 2, 3).
2. Tests and Playwright config (steps 4, 5).
3. Docs (step 6).
4. Validation (step 7), then QA, then merge after the human approval gate.

## Rollback
Revert the branch `feat/remove-mock-use-real-api` (or `git revert` its commits after merge). No database, API or contract change is involved, so nothing else needs undoing.

## Deviation Notes (frontend agent, 2026-11-01)
- Step 4: the fake data source the moved tests use is the former JSON data source, moved to `frontend/tests/utils/fixtureDataSource.ts` (`createFixtureDataSource`, `createFixtureServices`), with its data in `frontend/tests/fixtures/*.json` and the loader in `tests/utils/fixtureData.ts`. Keeping its routing logic kept the assertions of about 20 test files unchanged; `createFakeDataSource` stays for per-test fakes. `tests/utils/mockData.ts` became `tests/utils/sampleData.ts` (`reviewMock` became `sampleReview`).
- Validation 7: with no backend the app does not show the sign-in page: the session restore fails, so the route guard shows its existing "Could not check your session" state with Retry plus one error toast (Open Question 4A: no new UI). Once the backend answers, Retry opens `/login`. Covered by `tests/unit/qa-api-mode.test.tsx` and `tests/e2e/backend-down.spec.ts`.
- Scope 6: the frontend has no committed example env file (the only one belongs to `backend/`, outside the frontend scope), and the local frontend env file is a guarded secret file, so `VITE_DATA_SOURCE` was not removed from either; the app ignores the variable (README says so).
- `GITHUB_USERNAME_REQUIRED` removal: the connect card always asks for the user name and `github.service.connect(username)` always sends `{ username }`; unit tests type the fixture user name `john-doe`.
- `tests/unit/cross-stack.test.ts` keeps its link-import parity check (the fake backend against the real backend app), because every fixture-based unit test now depends on that fake answering like the backend.
