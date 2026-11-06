# Review Page: Failed Review Re-run Rule and Stale Findings After Reload

Status: done
Owner: Ilana
Last updated: 2026-10-26

## Goal
- Settle the two decisions left open by plan 021 QA:
  1. A failed review is **not** run again unless the code or language changed (your answer: "it cannot be run again without edits or file upload"). The app already behaves this way; this plan locks it in with a test and, if you want, a hint.
  2. After upload, Save review and a page reload, the page must not present findings as if they belonged to code they were not produced from.

## Scope
- Backlog task: "Review page: decide whether a failed review can be run again without editing the code first, and whether findings should be hidden when a saved edit no longer matches the analyzed code…". No `stack:full` marker, no Figma. Branch: `feat/review-failed-rerun-guard`.
- In scope:
  1. **Re-run rule (decision 1).** No behavior change: `canRunReview` (`frontend/src/lib/reviewRun.ts`) already needs `hasUnanalyzedChange`, so a `failed` or `cancelled` review with unchanged code and language keeps Run review disabled. Add the missing explicit tests (Open Question 1 decides the hint).
  2. **Stale findings after reload (decision 2).** Today `findingStale` is a `useState(false)` in `ReviewView` (`frontend/src/pages/ReviewPage.tsx`), set to true only by an upload in the current session. After Save review and a reload, it starts false again, while the saved code differs from `analyzedContent` / `analyzedLanguage`, so the editor marks lines of the old findings on the new code. Fix: start `findingStale` from `hasUnanalyzedChange({ saved code, saved language, analyzedContent, analyzedLanguage })`, so a saved edit that no longer matches the analyzed code is treated as stale from the first render. Run review still clears it.
  3. **What "hidden" covers** (Open Question 2): the editor line markers and glyphs (as today for uploads), and optionally the Findings tab list.
- Out of scope:
  - Backend, API contract and database (`analyzedContent` / `analyzedLanguage` are already returned by `GET /api/review/{id}`).
  - Re-analyzing automatically on save.
  - The History date label (plan 024).

## Assumptions
- A plain typed edit that is not yet saved keeps today's behavior (markers stay until upload or run, per plan 021 D1-D5). Only the saved-and-reloaded mismatch changes.
- Comparison uses the existing trimmed, LF-normalized rule, so whitespace-only and CR LF differences do not count as a mismatch.

## Open Questions
Answer inside this file (below each question). The recommended answer is used if you only write "approved".

1. **Should the page explain why Run review is disabled on a failed review?**
   - A. **Yes (recommended).** For `failed` / `cancelled` with no change, show a short hint near the button: "Edit the code or upload a file to run again." Text goes in `lib/review.constants.ts`.
   - B. No hint; only the tests for the existing rule.

   **Answer:** A.

2. **What is hidden when the saved code no longer matches the analyzed code?**
   - A. **Editor markers and glyphs only (recommended).** The Findings, Suggested refactors and Generated tests tabs still show the last analysis, and the Review status bar keeps saying when it was analyzed. Consistent with how uploads behave today.
   - B. Also the Findings tab list, replaced by a notice "The code changed since the last analysis. Run review to update the findings." Larger change; touches several tabs and tests.

   **Answer:** A.

## Steps
1. Add a pure helper next to `hasUnanalyzedChange` if needed, and initialize `findingStale` from the saved review (`frontend/src/pages/ReviewPage.tsx`).
2. Add the hint (if 1A) and any notice (if 2B), with texts in `lib/review.constants.ts`.
3. Tests:
   - unit `reviewRun`: failed and cancelled with unchanged code → `canRunReview` false; changed code or language → true;
   - unit `ReviewPage`: a review whose saved code differs from `analyzedContent` renders with no markers on first render; equal code renders markers; Run review clears the flag;
   - e2e: upload a file, Save review, reload → no markers, Run review enabled; Run review → markers return for the new code.
4. Run `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, and the Playwright review specs.

## Validation
- [ ] `cd frontend && npm test` passes, including the new `reviewRun` and `ReviewPage` tests.
- [ ] `npm run typecheck` and `npm run lint` in `frontend/` pass (`npm run typecheck` still fails on the known TS2550 error from commit 98be1e3 until the backlog bug is fixed; only that error is allowed).
- [ ] A failed review with unchanged code has Run review disabled; after any code or language change it is enabled (unit test).
- [ ] Upload → Save review → reload: the editor shows no markers and Run review is enabled (e2e).
- [ ] After Run review finishes, the new findings mark the code (e2e).
- [ ] A saved review whose code equals `analyzedContent` still shows markers after reload (unit test).
- [ ] No change under `backend/` or `.orchestrate/api-contract.yaml` (`git diff --stat`).
- [ ] No semicolons added, no new `.css` files, no inline styles.

## Risks
- Existing plan 021 tests (`ReviewFindingStale.test.tsx`) assert the current flag behavior; they must still pass or be updated deliberately.
- Answer 2B enlarges the change across tabs and tests.

## Rollout Order
1. Frontend change and tests.
2. QA run.
3. Your approval, then mark the backlog item `[V]` and this plan `done`.

## Rollback
- Revert the branch `feat/review-failed-rerun-guard`. No data, contract or schema changes.
