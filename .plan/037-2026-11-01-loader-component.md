# Loader Component: Shown Until Each API Call Finishes

Status: done
Owner: Ilana
Last updated: 2026-11-01

## Goal
Add one reusable loader component and show it while an API call is running, until that call finishes (success or failure), so the user never looks at a silent or half-empty screen while the backend works.

## Scope
- Backlog item: "Add a loader component. The loader will be displayed until each api call finishes running." No Figma. **Frontend-only** (no `stack:full`): nothing under `backend/` changes. Branch: `feat/loader-component` (created from `feat/remove-mock-use-real-api`; plan 036 was cancelled, so the number is skipped).
- **What the code does today** (read 2026-11-01):
  - All requests go through one function, `request()` in `frontend/src/services/api.service.ts` (the only data source since plan 035).
  - Every Redux slice keeps an `AsyncStatus` (`idle | loading | succeeded | failed`, `frontend/src/store/thunk.ts`), set by its thunks (`dashboard`, `review` with `status`, `currentStatus`, `runStatus`, `regenerateStatus`, `github` with five statuses, `session` with four, `account` with five, `support`, `settings`).
  - The UI shows loading in different, unrelated ways: plain text ("Loading review..." in `ReviewPage.tsx:513`, "Loading account..." in `AccountPanel.tsx`, "Loading reviews..." through `ReviewHistoryList`), a spinning `RefreshCw` icon in `GeneratedTestsTab.tsx`, and disabled buttons. The Dashboard shows an empty layout until the data arrives. There is no shared loader component.
  - Some calls are background work that the user did not start: the review status poll (`ReviewPollBackoff`), the settings load in `store/listener.ts`, and the session check on page load.
- **In scope:**
  1. **`Loader` component** (`frontend/src/components/Loader.tsx`): a spinner (`LoaderCircle` from `lucide-react`, `animate-spin`) with an optional label; sizes `sm | md | lg`; `role="status"` and an accessible name (`aria-live="polite"`); respects `prefers-reduced-motion` (no spin, a static pulse or the label only); Tailwind v4 utility classes and existing theme tokens, working in light and dark themes; no new `.css` file and no inline styles. Texts as constants in the relevant `lib/*.constants.ts` file.
  2. **In-flight tracking** (per Open Question 1): a small module `frontend/src/lib/requestTracker.ts` counts requests in flight from `request()` (increment before the fetch, decrement in `finally`, so a failure, a cancel by `abortAll` and a timeout always release it) and exposes `useIsRequestPending()` through `useSyncExternalStore`. It holds no request data and never logs.
  3. **Global indicator** (per Open Question 1): a thin top loader in `AppShell.tsx`, visible while the count is above zero, after the delay of Open Question 2, non-blocking (Open Question 4).
  4. **Page-area loaders** (per Open Question 1): `Loader` replaces the ad-hoc loading text and shows in empty areas on first load: Dashboard charts and stat bar, Review History list, Review page body, Account panel, GitHub wizard repository and file lists, Generated Tests regenerate (replacing the spinning icon only if the shared look is better; the button text stays).
  5. **Background calls** (Open Question 3): the tracker takes an option so polling and silent loads can be excluded from the global bar.
  6. **Tests** (see Validation) and **docs**: `.doc/architecture.md` (the tracker, the component and where it is used), `.doc/glossary.md` (`loader`), `README.md` only if a developer-visible setting is added (none expected).
- **Out of scope:**
  - Skeleton screens, progress percentages and upload progress bars.
  - Any change to the backend, the API contract, retry logic or error handling (errors still use the existing toasts and error states).
  - Changing what the review status poll does.
  - Page transitions and lazy-route loading fallbacks, unless Open Question 1 says to include them.

## Assumptions
- `request()` is the only place that talks to the network from the app, so counting there covers every call, including ones made outside Redux.
- A loader that appears and disappears within a fraction of a second is distracting, so it is shown only after a short delay (Open Question 2).
- The existing per-slice statuses stay as they are; they decide which area shows its own loader, and the tracker decides the global one. They do not need to agree frame by frame.
- Playwright can slow a response with `page.route`, so the loader can be tested without changing the backend.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Where should the loader appear?**
   - A. **Both a global top loader for every call, and the same `Loader` inside page areas on first load (recommended).** Literally "until each api call finishes", and an empty area never looks broken.
   - B. Global top loader only. Smallest change, but empty areas still look blank.
   - C. Page-area loaders only, no global one. Calls that are not tied to an area (saving settings, deleting a review) show nothing.

   **Answer:**

2. **Show it immediately, or after a short delay?**
   - A. **After 200 ms, and once shown keep it at least 400 ms (recommended).** Fast calls cause no flicker; slow calls always show a loader.
   - B. Immediately, with no delay.

   **Answer:**

3. **Should background calls (review status poll, silent settings load) show the global loader?**
   - A. **No: only calls the user started and page loads show it (recommended).** A poll every few seconds would keep the bar on all the time.
   - B. Yes, every call.

   **Answer:**

4. **Should the loader block the screen?**
   - A. **No, it never blocks; buttons that already disable themselves keep doing so (recommended).**
   - B. Yes, a full-screen overlay for user-started changes (save, delete, sign out).

   **Answer:**

**Answers (approved 2026-11-01, recommended options; no inline answers were found in this file):**
- 1: A. A global top loader for every call, and the same `Loader` inside page areas on first load.
- 2: A. Shown after 200 ms, and kept at least 400 ms once shown.
- 3: A. Background calls (review status poll, silent settings load) do not show the global loader.
- 4: A. The loader never blocks the screen.

## Steps
1. Create the branch (done). Record the baseline: `cd frontend && npm test` pass count.
2. Add `requestTracker.ts` and its unit tests; wire it into `request()` with the background option (Open Question 3). Keep the shared-GET de-duplication, abort and error handling unchanged: a shared GET counts once per underlying fetch, not once per caller.
3. Add `Loader.tsx`, its text constants and unit tests (roles, labels, sizes, reduced motion).
4. Add the global indicator to `AppShell.tsx` with the delay and minimum time of Open Question 2.
5. Replace the ad-hoc loading text and icons with `Loader` in the areas listed in Scope item 4, one page at a time; keep layouts stable (no layout shift when data arrives).
6. Playwright: slow a response with `page.route`, assert the loader shows and then disappears, on desktop and phone sizes, light and dark themes.
7. Docs per Scope item 6. Run the validation below.

## Validation
Each item is provable by a test or a command (QA checklist).
1. Unit: `requestTracker` counts up and down for success, failure, abort (`abortAll`) and timeout; the count never goes negative or stays above zero after all calls end; a shared GET with several callers counts once; calls marked as background do not change the visible count.
2. Unit: `Loader` renders `role="status"` with an accessible name, supports the three sizes, and shows no animation class under `prefers-reduced-motion`.
3. Unit: with a fake slow request the global loader is absent before 200 ms, present after, and stays visible at least 400 ms after the call ends (fake timers); with a fast request (under 200 ms) it never appears (Open Question 2A).
4. Unit: every listed area shows `Loader` while its status is `loading` and shows its content or error state after `succeeded` or `failed` (Dashboard, Review History, Review page, Account panel, GitHub wizard lists).
5. E2E (Playwright, real backend, one slowed route): the loader is visible during the slowed call and gone after the response, on `chromium` desktop and a phone viewport; a failed call (route aborted) also ends with no loader left.
6. No layout shift: the area keeps its size when the loader is replaced by data (checked in at least one e2e by comparing the bounding box).
7. The review status poll does not keep the global loader on (e2e or unit with the poll running).
8. `cd frontend && npx tsc --noEmit` and `npm run lint` pass; `npm test` passes with the pass count reported against the baseline; no test is removed or weakened.
9. No inline styles and no new `.css` file (`git diff --stat` shows none); colors come from existing tokens and the loader is readable in the dark theme.
10. `.doc/architecture.md` and `.doc/glossary.md` describe the tracker and the loader.

## Risks
- **Count never returns to zero** (a missed `finally`, a cancelled request) would leave the global loader on forever. Mitigation: decrement only in `finally`, a test for every end path, and a safety reset when the session ends (`abortAll`).
- **Flicker or double loaders** (global bar plus an area loader). Mitigation: the delay of Open Question 2 and a design where the global bar is thin and the area loader sits inside the content.
- **Layout shift** when the loader is replaced. Mitigation: Validation 6.
- **Accessibility noise** from many live regions. Mitigation: only one `aria-live` loader announced at a time; area loaders use the visible label and the global bar is `aria-hidden` or silent.
- **Polling interaction.** Mitigation: Open Question 3 and Validation 7.

## Rollout Order
1. Tracker and `request()` wiring (steps 2).
2. `Loader` and the global indicator (steps 3, 4).
3. Page areas, one at a time (step 5).
4. Tests, docs, validation (steps 6, 7), QA, then merge after the human approval gate.

## Outcome (2026-11-01)
- Completed after two QA rounds. **Accepted exception to Validation 6 (user decision):** Recent Reviews reserves 200 px, so it grows when data arrives for a returning user (4 reviews on desktop +36 px, 3 or more on a phone +76 px to +172 px). It is the last Dashboard block, so nothing below it moves. QA's heavy-data and 3 to 4 review layout tests in `frontend/tests/e2e/qa-037-loader.spec.ts` therefore still fail on purpose-of-record; they were not weakened or removed.
- Validation 3: the 400 ms minimum counts from when the global bar appears (answer 2A), not from when the call ends.
- Not done: the full Playwright suite (12 tests of an earlier full run did not run and were not confirmed), the encrypted suite (skipped at the user's request), and the 2 pre-existing `npm run typecheck` errors.

## Rollback
Revert the branch `feat/loader-component` (or `git revert` its commits after merge). The change is frontend-only with no database, API or contract change, so nothing else needs undoing.
