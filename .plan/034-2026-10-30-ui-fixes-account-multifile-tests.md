# UI Fixes: Editable Account, Multi-File GitHub Import, Working Test Configuration

Status: done
Owner: Ilana
Last updated: 2026-10-30

## Goal
Three fixes from one backlog item, done as three ordered workstreams on one branch:
1. **Account.** The user name and email in Settings > Account can be edited, and clicking the user details at the bottom left of the sidebar opens Settings > Account.
2. **Multi-file GitHub import.** When several files are imported from a repository, the editor shows a list of all of them; the user can switch between them, read each one's code and run a separate review for each.
3. **Generated Tests tab.** "Tests generated for" is fully visible; **Copy all** moves to the top next to "Test Configuration" as an icon-only button that is clearly a button; the **Framework** and **Test Type** choices are saved when switching tabs and really change the generated tests.

## Scope
- Backlog item "UI fixes" (three numbered parts). No Figma. It needs the backend for parts 1 and 3 (and optionally part 2), so it runs as **stack:full**. Branch: `feat/ui-fixes-account-multifile-tests`.
- **What the code does today** (read 2026-10-30):
  - **Part 1.** `frontend/src/components/AccountPanel.tsx` shows full name, user name, email and member-since as read-only text. The sidebar profile (`SidebarProfile` in `frontend/src/components/Sidebar.tsx`) is not a link. `.doc/product-definition.md` (plan 028) lists "editing the full name or email" as out of scope, so this plan moves user name and email into scope.
  - **Part 2.** The wizard (`frontend/src/pages/GithubWizardPage.tsx`) lets the user tick several files (`fileIdList`) but `approve()` imports only the first (`selectedFileList[0]`). A pull-request link import (plan 023) returns one joined text with header comment lines, and its `fileList` has no per-file code.
  - **Part 3.** `frontend/src/components/GeneratedTestsTab.tsx` keeps `framework` and `selectedTypeIdList` in local `useState`, so they reset when the tab changes. `regenerateTest(reviewId)` sends only the review id (`POST /api/review/{id}/generated-test`), so the choices never reach the server and change nothing.
- **In scope:**
  1. **Account (Workstream A).**
     - `PUT /api/account` (strict body `{ username?, email? }`, signed-in account only, CSRF header). Validation is the same as registration: user name 3 to 32 characters `[A-Za-z0-9._-]`, email valid and at most 254 characters, both unique regardless of case, with the same generic 409 message that never says which field or whether an account exists. Password rule per Open Question 1.
     - `AccountPanel` gets an Edit mode: fields with inline errors, Save and Cancel, a success toast, and the sidebar profile updates at once.
     - The sidebar profile becomes a real link to Settings > Account (keyboard focus, `aria-label`, hover style, `cursor-pointer`).
     - Mock mode edits the session copy only, and nothing is sent.
  2. **Multi-file import (Workstream B)** per Open Question 2:
     - The wizard imports every ticked file (not only the first), up to the existing PR limit of 20 files, one `GET .../file/{fileId}` per file, with a progress state and per-file failures reported without losing the others.
     - The editor page shows a **file list** (a vertical list beside the editor on desktop, a horizontal scrollable strip above it on phones) with name, language and a review status mark per file. Selecting a file shows its code in the editor; each file keeps its own language, edits and findings.
     - **Run review** runs for the selected file only and creates its own review, so each file has its own results, history row and saved state (the review model stays one code per review).
     - A pull-request link import shows its files in the same list (Open Question 3).
     - Leaving the page with unsaved imported files asks for confirmation.
  3. **Generated tests (Workstream C):**
     - Layout: "Tests generated for" shows fully (its own scroll area, never clipped); **Copy all** becomes an icon-only button (clipboard-copy icon from `lucide-react`) placed on the same row as the "Test Configuration" title, with a visible border and hover state, an `aria-label` and a tooltip "Copy all test files", and a toast on success.
     - Behaviour (Open Question 4): the choices are saved per review and sent with Regenerate, and the generator honors them.
  4. **Contract 0.13.0** (additive unless noted): `PUT /api/account`; the test configuration on the review (`testConfig: { framework, testTypeIdList }`) and in the regenerate request body; optionally per-file code in the pull-request import (Open Question 3).
  5. **Database:** one nullable column or JSON field for the review's test configuration (migration `00N-test-config.sql`, idempotent, documented in `README.md` upgrade note: run `npm run db:setup` and restart). Existing reviews read as the default configuration.
  6. **Docs:** `.doc/product-definition.md` (account editing in scope, multi-file import, test configuration), `.doc/architecture.md`, `.doc/glossary.md` (`import session`/`file draft`, `test configuration`), `.rule/database-rules.md` (new column), `README.md`.
  7. **Tests.** Backend: account update (validation table, 409 generic, 401/403/422, password rule), test-config persistence and generation per framework and type, migration on a populated database. Frontend unit: Edit mode, sidebar link, multi-file draft list (switch, per-file edits survive, per-file run, partial failures), tab-switch persistence, Copy all. E2E (Playwright): edit user name and email and see the sidebar update; click the sidebar profile; import 3 files from the fake GitHub, switch between them, run two reviews separately; choose Vitest and only Edge Cases, switch tabs and back, see the choice kept and the generated code change.
- **Out of scope:**
  - Editing the full name, the member-since date, or deleting the account.
  - Email verification, password reset by email, changing the avatar flow (already exists).
  - A combined review across several files.
  - Real test execution (generated tests are only shown, never run).
  - GitHub OAuth and private repositories.

## Assumptions
- A user name or email change keeps the current session valid (the session id is not tied to the user name); the sidebar and login use the new values from then on.
- The generator behind `generated-test` is the stub analyzer in tests and local use and the provider-backed analyzer otherwise; both take the configuration through the same interface (confirmed by the backend agent before coding).
- Fetching up to 20 files uses up to 20 of GitHub's 60 unauthenticated calls an hour (shared with link import), so a clear 429 message is already in place from plan 030.
- The review model keeps one `content` per review (no multi-file review).

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Does changing the user name or email need the current password?**
   - A. **Yes (recommended).** Same rule as the password change: the form asks for the current password when the user name or email changes, because the email and user name identify the account and are what an attacker with a stolen session would change to take it over.
   - B. No. Edit and save directly. Simpler, but a stolen session can change the sign-in identity.

   **Answer:**

2. **How should several imported files work?**
   - A. **A file list inside the editor page; each file is its own draft and its own review (recommended).** Matches your request: see all files, switch, read the code, run each review separately. Nothing changes in the review model.
   - B. Import every file immediately as separate saved reviews and open Review History. Faster to build, but the user cannot look at or edit the code before reviews exist.
   - C. Keep one joined text (as pull-request links do today) and only list the file names. Does not let you run reviews separately.

   **Answer:**

3. **Should a pull-request link import also show a file list?**
   - A. **Yes, with the same file list (recommended).** The backend adds per-file code to `POST /api/github/import` (additive field), and the old joined text is kept for compatibility. One way to work with several files everywhere.
   - B. No, pull-request links keep the joined text; only the repository wizard gets the list. No backend change for this part.

   **Answer:**

4. **How are Framework and Test Type saved and made to work?**
   - A. **Saved on the review and used by the generator (recommended).** Regenerate sends `{ framework, testTypeIdList }`; the server stores them with the review and generates tests in that framework's syntax (Jest, Vitest or Mocha) and only the chosen kinds (unit, edge cases, error cases); switching tabs, reloading and reopening the review show the same choices. Needs a small database change.
   - B. Saved in the browser only (Redux state and local storage) and sent with Regenerate, not stored on the server. No migration, but the choices are forgotten on another device and on a cleared browser.

   **Answer:**

**Answers (approved 2026-10-30, recommended options; no inline answers were found in this file):**
- 1: A. Changing the user name or email needs the current password.
- 2: A. A file list in the editor page; each file is its own draft and its own review.
- 3: A. Pull-request link imports show the same file list (per-file code added to the import response).
- 4: A. Framework and Test Type are saved on the review and used by the generator.

## Steps
1. Branch `feat/ui-fixes-account-multifile-tests` (created).
2. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend, Backend and QA tickets (Todo); Backend to In Progress. Write `.orchestrate/tickets.json`.
4. Backend agent, after the contract update (0.13.0) first: `PUT /api/account`, test-config persistence and generation, the migration, optional per-file pull-request code, tests, docs.
5. Frontend agent: Workstream A (account edit and sidebar link), B (file list and multi-file drafts), C (Generated Tests layout and saved configuration), unit and e2e tests.
6. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
7. Before the manual check: `npm run db:setup` in `backend/` and restart the backend (new column); no other setting changes.
8. Your final approval; plan to `done`, backlog item ticked.

## Validation
- `cd backend && npm test`, `npm run typecheck`, `npm run test:db`; `cd frontend && npm test`, `npm run lint`, `npm run typecheck` (apart from the two known `isWellFormed` errors from plan 023), `npx vite build` and `npm run test:e2e` pass.
- Account (backend): valid update of user name, email, and both; duplicate user name or email (any letter case) gives the same generic 409; invalid formats give 422 with the field; no body change, unknown fields, 401, 403 (CSRF) behave; with Question 1 A a missing or wrong current password is refused; login works with the new user name and the old one no longer does; other accounts are unaffected.
- Account (UI): Edit, validation errors inline, Save updates the panel and the sidebar immediately, Cancel restores; the sidebar profile is a link (keyboard, focus ring, hover, pointer cursor) that opens Settings > Account; mock mode edits the session copy only.
- Multi-file (UI): ticking 3 files and approving opens all 3 in the list; the first is selected; switching shows each file's own code and language; edits to one do not change another; Run review on one creates one review with its own results and leaves the others as drafts; a failed file download shows an error for that file and keeps the others; more than 20 ticked files is refused with a clear message; leaving with unsaved drafts asks for confirmation; phone width shows the strip and keeps the editor visible.
- Pull-request link (per Question 3): the same list appears with per-file code, the skipped files are still listed, and limits and errors from plan 023 are unchanged.
- Generated tests (UI): "Tests generated for" shows every file without clipping at 320px, 768px and desktop widths; the Copy all icon button is at the top beside "Test Configuration", has a tooltip, `aria-label`, border and hover, and copies all files; Framework and Test Type choices survive switching tabs, reloading and reopening the review.
- Generated tests (backend): Jest, Vitest and Mocha produce syntax of that framework; unchecking a kind removes those tests; at least one kind is required (422 otherwise); the stored configuration is returned with the review; a review created before the migration reads as the default configuration.
- Migration: `003`-style idempotent migration applies twice without error on a populated database, and the README upgrade note names `npm run db:setup`.
- Contract: every new or changed operation has at least one test; `api-contract.yaml` is 0.13.0.
- Docs updated as listed; manual: try all three fixes in the running app.

## Risks
- **Account takeover through the edit form.** Mitigation: Question 1 A (current password), rate limit on `PUT /api/account` (the password-change limiter), CSRF, generic 409.
- **Rate limit of GitHub (60 per hour) with up to 20 file downloads.** Mitigation: the 20-file cap, sequential downloads, a clear 429 message, partial results kept.
- **Large state with many drafts** (up to 20 files of up to 50 000 characters). Mitigation: drafts live in memory and are saved only when reviews are created; limits enforced; no local storage of code.
- **Confusing state between drafts and saved reviews.** Mitigation: the list shows a status per file; unsaved-leave confirmation; unit and e2e tests of switching.
- **Test configuration changes the generator for every user of old reviews.** Mitigation: the default configuration equals today's output, so old reviews read as before.
- **Migration on a populated database.** Mitigation: nullable column, idempotent, tested on a populated database, README upgrade note.
- **Scope size.** Three workstreams in one branch. Mitigation: they are independent and ordered; if one fails QA it can be fixed alone.

## Rollout Order
1. Contract 0.13.0 and the migration.
2. Backend: account update, test configuration, optional pull-request files.
3. Frontend A, then C, then B (B is the largest).
4. Docs.
5. QA, including the manual check of all three fixes.

## Rollback
- Revert the branch. The only persistent change is the nullable test-configuration column on reviews; leaving it in place is harmless and a down migration drops it. Account user names and emails already changed by users stay as they are.
