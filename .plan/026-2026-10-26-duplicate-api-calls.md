# Bug: Same API Calls More Than Once on Page Load

Status: done
Owner: Ilana
Last updated: 2026-10-26

## Goal
- On every route, each API call a page needs is sent **once** when the page loads (and once per real reason to refetch: navigation to the page, polling, a user action).
- A test fails if a route sends the same GET twice on load.

## Scope
- Backlog task: "Bug: I see that several routes in the application get the same api calls more than once when the page loads". No `stack:full` marker, no Figma. Branch: `fix/duplicate-api-calls`.
- In scope:
  1. **Measure first.** A Playwright test (new, `frontend/tests/e2e/api-calls.spec.ts`) visits each route (`/`, `/review/new`, `/review/:id`, `/history`, `/github`, `/settings` and its tabs, `/help`), records every request to `/api/*` until the page is idle, and reports the duplicates per route. This is the evidence for the root causes below and becomes the regression test.
  2. **Likely causes found by reading the code** (to be confirmed by step 1):
     - `React.StrictMode` (`frontend/src/main.tsx`) mounts effects twice in development. The thunks `fetchSettings` (`lib/useApplySettings.ts`), `fetchDashboard` and `fetchReviewList` (`pages/DashboardPage.tsx`, `pages/ReviewHistoryPage.tsx`) and `fetchReview` (`pages/ReviewPage.tsx`, aborts the first and sends a second) have no `condition`, so the second effect sends a second request. `fetchAccount` already skips a load that is running or done (`store/account.slice.ts`), so it is not affected.
     - `fetchReviewList` is requested by both the Dashboard and Review History, and `fetchSettings` is loaded by `App.tsx` while other pages read settings through `useSettings`. Whether any route triggers the same call from two components is shown by step 1.
  3. **Fix** at one place, not per page (Open Question 1): in-flight GET sharing in the shared request function of the API data source (`frontend/src/services/`), so two identical GETs issued while the first is still pending share one network call and one result. Pages and thunks stay as they are. The mock (JSON) data source needs nothing because it makes no network calls.
  4. **Tests**: unit tests for the sharing (two concurrent identical GETs → one `fetch`; different URLs, a POST, and a call after the first finished → separate calls; an aborted caller does not cancel the shared call for another caller); the e2e spec from item 1 asserting each route's `/api/*` GETs are unique.
  5. **Docs**: one line in `.doc/architecture.md` (frontend services) about in-flight GET sharing.
- Out of scope:
  - Caching results between page visits (revisiting a page still refetches, as today).
  - Polling of unfinished reviews (a deliberate repeat).
  - Backend, API contract and database.

## Assumptions
- The duplicates you see are on page load in the browser (dev server). In a production build `StrictMode` does not double effects, so the e2e measurement runs against the dev server, where the bug shows, and also against the preview build to show the difference.
- Sharing identical in-flight GETs is safe because every GET in the contract is idempotent and returns the same data for the same URL.

## Open Questions
Answer inside this file (below each question). The recommended answer is used if you only write "approved".

1. **Where should the duplicates be removed?**
   - A. **In the shared API request function (recommended).** One place, covers every route and any future page, no changes to pages or the store.
   - B. Per thunk, with a `condition` that skips a call while the same one is loading (as `fetchAccount` does). More code, and a new page can reintroduce the bug.
   - C. Remove `StrictMode`. Not recommended: it hides real effect bugs and fixes only development.

   **Answer:** A.

2. **Should a second visit to the same page also avoid the call?**
   - A. **No (recommended).** Only calls sent at the same time are shared; leaving and returning to a page reloads fresh data as today.
   - B. Yes, cache for a few seconds. Larger behavior change (stale lists after a save or delete).

   **Answer:** A.

## Steps
1. Add the Playwright measurement spec and record the duplicates per route (kept in `.orchestrate/frontend-agent-report.md`).
2. Implement the answer to Open Question 1 in the shared request function.
3. Unit tests for the sharing; make the e2e spec assert no duplicate GET per route.
4. Run `cd frontend && npm test`, `npm run typecheck` (only the known TS2550 errors are allowed), `npm run lint`, and the new and existing Playwright specs.

## Validation
- [ ] `cd frontend && npm test` passes, including the new sharing tests.
- [ ] `npm run typecheck` shows only the known TS2550 errors; `npm run lint` is clean.
- [ ] The new Playwright `api-calls.spec.ts` passes on the dev server for every route listed above: no identical `/api/*` GET is sent twice at load.
- [ ] Before the fix, the same spec fails on at least the routes the measurement reported (the report lists them), proving the test detects the bug.
- [ ] Concurrent identical GETs make one `fetch`; POST, PUT, DELETE and different URLs are never shared (unit tests).
- [ ] One caller aborting does not cancel or fail the shared request for the other caller (unit test).
- [ ] Existing Playwright specs for review, history, dashboard, settings and github still pass.
- [ ] No change under `backend/` or `.orchestrate/api-contract.yaml` (`git diff --stat`).
- [ ] No semicolons added, no new `.css` files, no inline styles.

## Risks
- Sharing a request between callers needs careful abort handling: `fetchReview` aborts its request on unmount, and StrictMode unmounts the first mount at once. The shared call must survive until all callers are gone or finished.
- The measurement may show duplicates that StrictMode does not explain (two components requesting the same data); the plan would then add a targeted fix for those routes and ask you first if it changes behavior.

## Rollout Order
1. Measurement spec.
2. Fix and tests.
3. QA run, then your approval; mark the backlog item `[V]` and this plan `done`.

## Rollback
- Revert the branch `fix/duplicate-api-calls`. No data, contract or schema changes.
