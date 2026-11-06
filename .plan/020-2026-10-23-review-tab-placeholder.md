# Review Tab Placeholders

Status: done
Owner: Ilana
Last updated: 2026-10-23

## Goal
- When a review has nothing to show yet, the **Findings**, **Suggested refactors** and **Generated tests** tabs show a clear placeholder. Today they render an empty area; Generated tests renders nothing at all.

## Scope
- Frontend only (no `stack:full`); no Figma. Branch: `feat/review-tab-placeholder` (built on `feat/api-integration`).
- In scope:
  1. Reuse `components/EmptyState.tsx`, the dashboard empty state, with a `lucide-react` icon per tab. Use the same icon for the same concept across features (`.claude/rules/ui-and-styling.md`).
  2. The placeholder text depends on the review's state (see Open Question 1):
     - **Not run yet** (`/review/new` before Run review): "No findings yet. Run a review to see the issues in your code." The other two tabs get matching texts.
     - **Analyzing** (`pending`, `queued`, `in_progress`): "Analyzing your code… Findings will appear here when the review completes."
     - **Completed with nothing in that list**:
       - Findings: "No issues found";
       - Suggested refactors: "No refactors suggested";
       - Generated tests: "No tests generated", with a hint when generated tests are off in Settings. (The tab is hidden when they are off, so this hint is a safety net.)
     - **Failed or cancelled**: "This review did not finish, so there are no findings." The other two tabs get matching texts.
  3. The tab labels keep their counts, for example "Findings (0)".
  4. All texts go in `lib/review.constants.ts` (no hard-coded values). The placeholder is chosen in one place: a small helper that maps (status, isNew) to the right text for each tab.
  5. Tests:
     - unit tests for each tab in each state;
     - an e2e test on `/review/new` (blank), showing the "not run yet" placeholders;
     - an e2e test after Run review, where the stub analyzer finds nothing in clean code, showing the "completed, nothing found" placeholders.
- Out of scope:
  - The Summary tab. Its "Key issues" block gets the same placeholder only if you choose it in Open Question 2.
  - Any backend change.
  - The code editor task.

## Assumptions
- Statuses come from `REVIEW_STATUS` and `unfinishedStatusList` (`models/review.model.ts`).
- The stub analyzer returns no findings for code that breaks none of its rules, so "completed, nothing found" can be reproduced end to end.
- Styling uses Tailwind utilities only, with no new CSS files (`.claude/rules/ui-and-styling.md`).

## Open Questions
1. **One placeholder or one per state?** Recommended: **one per state** (not run, analyzing, completed and empty, failed or cancelled), so the text never claims "no issues found" before the analysis has run. Alternative: a single generic "Nothing here yet" text.
2. **The Summary tab's "Key issues" block** is also empty for a new review. Recommended: **yes, give it the same placeholder**, for consistency. Alternative: only the three tabs named in the backlog.

**Answers (approved 2026-10-23):**
- 1: one placeholder per state.
- 2: yes, the Summary tab's "Key issues" block gets the same placeholder.

## Steps
1. Branch `feat/review-tab-placeholder` (done).
2. Answer the Open Questions.
3. Frontend agent: add the texts and the state helper, add the placeholders to the tabs, and write the tests.
4. QA against the Validation section → `.orchestrate/qa-report.md`.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run test:e2e` pass.
- Unit tests: for each of the 3 tabs (4 with Open Question 2) and each of the 4 states, the right title and detail are shown, and nothing else renders in that tab.
- Generated tests never renders `null`: a tab whose list is empty shows its placeholder.
- When a list has items, no placeholder is shown (regression).
- E2E: `/review/new` shows the "not run yet" placeholders. After Run review on code with no stub findings, the tabs show the "completed, nothing found" placeholders, and the labels read "(0)".
- No new hard-coded texts: every placeholder string comes from `lib/review.constants.ts`.

## Risks
- **Status-dependent text drifts from the status list.** Mitigation: one helper keyed on `REVIEW_STATUS`, plus a unit test over every status value.
- **Existing tests that expect an empty tab body.** Mitigation: update them to expect the placeholder.

## Rollout Order
1. Texts and the helper.
2. Tabs.
3. Tests.
4. QA.

## Rollback
- Revert the branch. Nothing else depends on it.

## Implementation Notes and Deviations
- Texts: `REVIEW_PLACEHOLDER_STATE`, `REVIEW_PLACEHOLDER_TAB`, `REVIEW_PLACEHOLDER_TEXT` and `GENERATED_TEST_OFF_HINT` in `lib/review.constants.ts`. Each placeholder is a title plus a detail (`EmptyState`), so the plan's one-sentence texts are split: for example "No findings yet" / "Run a review to see the issues in your code.", and "Analyzing your code…" / "Findings will appear here when the review completes." The failed or cancelled state uses the title "This review did not finish" with the plan's sentence as the detail.
- Helper: `lib/reviewPlaceholder.ts`. `reviewPlaceholderState(status, isNew)` is the single mapping (an exhaustive switch over `REVIEW_STATUS`, so a new status fails the typecheck); `reviewPlaceholderFor(tab, status, isNew, generatedTestOn)` returns the text and the Settings hint. `isNew` wins over the status (the blank review is `pending`).
- Component: `components/TabPlaceholder.tsx` wraps `EmptyState`. Icons: `ScanSearch` for findings (Findings tab and Summary Key issues), `Lightbulb` for suggested refactors (the icon `SuggestionBadge` already uses), `FlaskConical` for generated tests.
- Findings tab with no finding shows only the placeholder (no "Key Issues" heading); the Summary keeps the "Key Issues" heading with the placeholder under it (new optional `placeholder` prop on `KeyIssues`).
- `GeneratedTestsTab` now renders the placeholder instead of `null`; `isNew` is passed from `ReviewPage` → `ReviewTabs` → `GeneratedTestsTab`.
- The Settings hint shows only with the "completed" state, as the plan words it; since the tab is hidden when generated tests are off, it is covered by unit tests on `GeneratedTestsTab` directly.
- Deviation (E2E): the stub analyzer always generates one test file, so after Run review on clean code the Generated tests tab reads "(1)" and shows that file, not the "No tests generated" placeholder. The e2e asserts the completed placeholders and "(0)" labels for Findings, Suggested refactors and the Summary's Key issues, and that Generated tests has no placeholder. "No tests generated" is covered by unit tests.
- No existing test expected an empty tab body, so none needed updating. `.orchestrate/api-contract.yaml` is unchanged (no new endpoint).
- QA round 1 fixes (`.orchestrate/qa-report.md`):
  - D1: light-theme `--color-text-muted` is now `#56607a` (`styles/setup/variables.css`), app-wide. Measured: 5.80:1 on page-bg, 4.96:1 on card, 6.27:1 on surface, 5.09:1 on border, and at least 5.3:1 on every soft tint. Dark mode is unchanged (it passed). No test or snapshot used the old value. `--color-neutral` still has the old hex `#6b7690`; it is a separate token and was not changed.
  - D2: `services/json-data.ts` `loadReview` gives seeded reviews that are not completed (r4–r8) empty `finding`, `findingCount`, `suggestion` and `generatedTest`, so their tabs show the analyzing or stopped placeholder. To keep History and the Dashboard's Recent Reviews consistent, the failed r4 summary in `mocks/dashboard.json` now counts 0 high and 0 medium (it was 4 and 2). The other demo numbers are unchanged.
  - D3: the stopped details no longer repeat the title: "There are no findings because the analysis stopped." (and the same for suggested refactors and generated tests).
  - D4: an unknown status falls back to `stopped`. The `never` check still makes the typecheck fail for a known status that has no case.
  - D5: `REVIEW_PLACEHOLDER_TEST_ID_SUFFIX` and `reviewPlaceholderTestId(tab)` are in `lib/review.constants.ts`. `TabPlaceholder`, both of my specs and both QA specs use them.
  - The Summary hides "View all findings" when there is no finding. Its text moved to `REVIEW_TEXT.viewAllFindings`.
  - QA tests: the fail markers are removed from the 4 unit (`it.fails`) and 2 e2e (`test.fail`) known-defect tests, and those tests are renamed "D<n> fixed". The QA unit test "current JSON behavior (why the two above fail)" asserted the D2 defect, so it now asserts the fixed behavior: r7 shows "Findings (0)" and the analyzing placeholder.
