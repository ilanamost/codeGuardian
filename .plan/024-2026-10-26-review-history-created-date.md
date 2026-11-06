# Review History: Show the Created Date

Status: done
Owner: Ilana
Last updated: 2026-10-26

## Goal
- A Review History row shows when the review was **created**, and says so. Running the review again changes "Analyzed" on the Review page but never the row's date.
- The list order stays the creation order (newest created first).

## Scope
- Backlog task: "Review History: after a review is run again, the row still shows the creation time ("3 days ago") while the Review page says "Analyzed: just now"…" Your note: show the created date. No `stack:full` marker, no Figma. Branch: `feat/review-history-created-date`.
- In scope:
  1. **Label** (`frontend/src/components/ReviewRow.tsx`): the second line becomes `{language} - Created {timeAgo}` (Open Question 1 decides the exact wording). The `timeAgo` field keeps its name and value; only the text around it changes.
  2. **Mock data source** (`frontend/src/services/json-data-source.ts`, list of reviews, lines ~199-202): a review that was run again is built with `toSummary(id)`, whose default is `analyzedAgo`. Pass the creation time there so the mock source matches the backend (`timeAgo` = creation time, never the run time). The API data source already behaves correctly (`backend/src/service/review.service.ts` uses `createdAt`; covered by `backend/tests/review.test.ts` "keeps the History timeAgo on the creation time").
  3. **Where the label shows**: Review History list and, since both use `ReviewRow`, the Dashboard "Recent reviews" list (Open Question 2).
  4. **Tests**: update the unit and e2e tests that read the old row text; add a regression for "run again keeps the created text".
  5. **Docs**: `.doc/glossary.md` only if a new term is introduced (none planned).
- Out of scope:
  - Backend, API contract (`.orchestrate/api-contract.yaml`) and database changes. No field is renamed or added.
  - Showing the last run time on the row (you chose the created date).
  - The other two pending backlog items about the Review page.

## Assumptions
- `timeAgo` already means "time since creation" for the API source, so no backend change is needed.
- The Dashboard "Recent reviews" mock entries in `frontend/src/mocks/dashboard.json` are creation-time texts too; their values stay as they are.

## Open Questions
Answer inside this file (below each question). The recommended answer is used if you only write "approved".

1. **How should the created date read?**
   - A. **"Created 3 days ago" (recommended).** Same relative style as today, with the word that removes the confusion. No contract change.
   - B. An exact date, e.g. "Created Oct 23, 2026". Needs the creation timestamp on the History item, which means a new field in the API contract (additive, `createdAt`) and a backend change, so the task becomes `stack:full`.
   - C. Both: "Created Oct 23, 2026" with "3 days ago" as a tooltip. Also needs the new field.

   **Answer:** A.

2. **Should the Dashboard "Recent reviews" rows get the same label?**
   - A. **Yes (recommended).** The same component and the same meaning; one wording across the app.
   - B. No, History only. Needs a prop on `ReviewRow` to switch the label.

   **Answer:** A.

## Steps
1. Edit the label in `frontend/src/components/ReviewRow.tsx` (per the answers above).
2. Fix the mock data source list so `timeAgo` comes from the creation time for reviews that were run again.
3. Update `frontend/tests/unit/ReviewHistory.test.tsx` and `frontend/tests/e2e/review-history.spec.ts` for the new text; add:
   - unit: a row renders `Created <timeAgo>`;
   - unit (mock source): create, run again later, list → `timeAgo` still reflects creation while `analyzedAgo` restarts;
   - e2e: create a review, run it again, open History → the row says "Created …" and keeps its position.
4. Run `cd frontend && npm test`, `npx tsc --noEmit` and `npm run lint`; run the Playwright review-history spec.

## Validation
QA checklist (each item provable by a test or command):
- [ ] `npm test` in `frontend/` passes, including the new row-label and run-again tests.
- [ ] `npx tsc --noEmit` and `npm run lint` in `frontend/` are clean.
- [ ] Playwright `review-history.spec.ts` passes against the backend: after a re-run, the History row still says "Created …" with the original age, while the Review page says "Analyzed: just now".
- [ ] History order is unchanged by a re-run (the re-run review does not jump to the top).
- [ ] With the mock data source, the same holds (unit test).
- [ ] `backend/` tests still pass untouched (`cd backend && npm test`); `git diff --stat` shows no `backend/` or `.orchestrate/api-contract.yaml` change (if answer 1 is A).
- [ ] No semicolons added, no new `.css` files, no inline styles.

## Risks
- Other tests or the PDF report may assert the old row text ("… - 2 hours ago"); the search for the text is part of step 3.
- If you pick answer 1 B or C, the scope grows into a contract and backend change; the plan would be revised and the task re-marked `stack:full` before any work starts.

## Rollout Order
1. Frontend label and mock-source fix with tests.
2. QA run.
3. Your approval, then mark the backlog item `[V]` and this plan `done`.

## Rollback
- Revert the branch `feat/review-history-created-date`. No data, contract or schema changes are involved, so nothing else needs undoing.
