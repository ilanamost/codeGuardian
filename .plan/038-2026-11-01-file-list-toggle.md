# Open and Close the Imported Files List

Status: done
Owner: Ilana
Last updated: 2026-11-01

> Revision 1 (2026-11-01): the plan was not approved after QA; the user reported a phone problem ("not enough space to scroll horizontally and see all the files after import"). Scope item 8, Open Questions 4 and 5, Validation items 11 to 14 and Step 7 were added. Revision approved by the user on 2026-11-01 (answers 4A and 5A below).

## Goal
After importing GitHub files, the user can open and close the imported files list, so that the code editor can use the full width (desktop and tablet) or the full height (phone) when the list is not needed.

## Scope
- Backlog item: "After importing github files, I see the files list, but there is not much space for the code editor. Add an option for opening and closing the files list, so that the full editor will be visible." No Figma. **Frontend-only** (no `stack:full`): nothing under `backend/` changes. Branch: `feat/file-list-toggle` (created from `feat/loader-component` at commit `ca3822d`, which holds the committed loader work of plan 037).
- **What the code does today** (read 2026-11-01):
  - `ImportSessionFrame` in `frontend/src/pages/ReviewPage.tsx` (~line 540) renders `<FileDraftList>` next to the page content in a flex row (`md:flex-row`); on phones it is a column.
  - `frontend/src/components/FileDraftList.tsx` is always visible: a vertical list from `md` up (`md:w-60`, `lg:w-64`, 240 to 256 px wide) and a horizontal scrolling strip above the editor on phones. There is no way to hide it.
  - The list exists only while an import session exists (plan 034): `selectImportSession`, `importFileSelected`, and `useLeaveGuard` for unsaved drafts.
  - Texts are in `FILE_DRAFT_TEXT` (`frontend/src/lib/review.constants.ts:237`). The browser storage module `services/storage.service.ts` is the only code that touches `localStorage`.
- **In scope:**
  1. A toggle button that closes and opens the list (Open Question 1 for the collapsed look). It is a real `button` with `aria-expanded`, `aria-controls` (the list id) and an accessible name that says what it will do ("Hide imported files" / "Show imported files"), an icon from `lucide-react` (`PanelLeftClose` / `PanelLeftOpen`, the same icons for the same idea everywhere), `cursor-pointer`, a hover style and a visible keyboard focus ring; Tailwind v4 utilities and existing tokens only (no new `.css` file, no inline styles).
  2. When closed, the editor area takes the freed space (no fixed gap) and the user can still see which file is open and how many files exist (Open Question 1), so the closed state is never confusing.
  3. The open or closed choice is kept while the user switches between files and pages inside the session, and remembered according to Open Question 3 through `storage.service` (guarded: private mode or blocked storage falls back to open without an error).
  4. The default state follows Open Question 2.
  5. A smooth width change that respects `prefers-reduced-motion` (no animation when reduced).
  6. Texts as constants in `FILE_DRAFT_TEXT`.
  7. **Tests** (see Validation) and **docs**: `.doc/architecture.md` (the toggle, the storage key), `.doc/glossary.md` only if a new shared term is used (none expected).
  8. **Phone layout (user feedback, Revision 1).** On phones the files cannot all be reached: the list is a horizontal strip of fixed-width cards (`w-44`, 176 px) with its scrollbar hidden on purpose (`hide-bar` in `FileDraftList.tsx`), so with several files (up to 20) most are off screen with no sign that the strip scrolls. Replace it on phones (below `md`) as chosen in Open Question 4. Desktop and tablet (`md` and up) keep the vertical list, the rail and the toggle unchanged. Every file stays reachable on a 320 px screen with 20 files and long names; failed or skipped files still show their reason.
  9. **QA findings F1 and F2** (Open Question 5): the success toast covers the new toggle right after an import, and `fileListOpen.ts` computes the next state from the current render.
- **Out of scope:**
  - Any change to what the list shows, to selection, to the leave guard or to the import itself.
  - A resizable splitter between the list and the editor.
  - Saving the choice on the server or in the account settings (that would need a backend change).
  - Keyboard shortcuts for the toggle.

## Assumptions
- The choice is a per-browser display preference, not account data, so it uses browser storage like other UI-only state and never touches `AppSettings` or the API.
- The Monaco editor re-measures itself when its container width changes (it already uses automatic layout); the e2e test checks the editor's real width, not only the CSS class.
- The list stays mounted when closed (hidden from view and from the tab order), so file status marks and the selected file are not lost. Nothing is refetched.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **How should the closed list look?**
   - A. **A slim rail on desktop and tablet (about 2.5 rem wide), and a one-row bar on phones, each holding the toggle button, the number of files and the name of the open file (recommended).** Always discoverable, the editor gets nearly all the width, and nothing floats over the code.
   - B. Fully hidden, with a small floating button over the corner of the editor. The editor gets 100% of the space, but the button covers code and is easy to miss.

   **Answer:**

2. **Should the list start open or closed after an import?**
   - A. **Open everywhere, as today (recommended).** No surprise: the user sees the imported files first and closes the list when they want more room.
   - B. Open on desktop and tablet, closed on phones, where space is tightest. The one-row bar still shows the file count.

   **Answer:**

3. **Should the choice be remembered?**
   - A. **Yes, in this browser, across imports and reloads (recommended).** One storage key, read once on load; falls back to the default if storage is unavailable.
   - B. No: it resets to the default for every import.

   **Answer:**

4. **How should the files be shown on phones?** (Revision 1)
   - A. **A dropdown (recommended).** One full-width button, always one row (about 2.75 rem), shows the open file's name, its language, its status mark and "2 of 5"; tapping it opens a vertical list under it (at most about 50% of the screen height, scrolling up and down, which phones do naturally), where each file is a full-width row with name, language, status mark and, for failed or skipped files, the reason. Choosing a file closes the list. It works with 20 files and long names, needs no sideways scrolling, and uses a custom list (not a native `select`) because a native `select` cannot show status marks, reasons or disabled rows. Because this row is as small as the closed bar, the open/close toggle stays only from `md` up; on phones the dropdown replaces it.
   - B. Keep the horizontal strip but make it scrollable by sight: a visible thin scrollbar, fade edges, arrow buttons and a "3 of 12" counter. Keeps one tap to switch, but only about 2 files are visible at a time, and long lists still need many swipes.
   - C. Dropdown on phones and keep the open/close toggle there too. Redundant: the dropdown row is already as small as the closed bar.

   **Answer:**

5. **Should this plan also fix QA findings F1 and F2?**
   - A. **Yes, both (recommended).** F1: move the toggle or the toast so they never overlap (the toast stays top-center; the toggle gets room below it or the toast moves). F2: use a functional state update and write storage from an effect. Both are defects in this feature, QA already has failing tests for them, and they are small.
   - B. Only the phone layout; record F1 and F2 as follow-ups.

   **Answer:**

**Answers (approved 2026-11-01, recommended options; no inline answers were found in this file):**
- 1: A. A slim rail on desktop and tablet and a one-row bar on phones, each with the toggle, the file count and the open file's name.
- 2: A. The list starts open everywhere.
- 3: A. The choice is remembered in this browser.

**Revision 1 answers (approved 2026-11-01, recommended options; no inline answers were found in this file):**
- 4: A. Phones get a dropdown (one full-width row, a vertical list under it, a custom list, not a native `select`); the open/close toggle stays from `md` up.
- 5: A. QA findings F1 (toast covers the toggle) and F2 (functional state update, storage written from an effect) are fixed in this plan too.

## Steps
1. Create the branch (done). Record the baseline: `cd frontend && npm test` pass count.
2. Add the texts to `FILE_DRAFT_TEXT` and the storage helper (key, read and write guarded) in a small `lib/` module with unit tests.
3. Add the open or closed state and the toggle to `ImportSessionFrame` and `FileDraftList` (props: `open`, `onToggle`); the collapsed rail or bar per Open Question 1; the list element keeps an id for `aria-controls`.
4. Make the layout give the editor the freed space on every breakpoint (`md`, `lg`, phone) and check the sizes of the Review page body when the list is closed.
5. Unit tests, then one Playwright spec for the real flow (multi-file import from the fake GitHub, close, check the editor width, switch file, reload, reopen).
6. Docs per Scope item 7. Run the validation below with short, targeted runs.
7. Revision 1 (after approval): first measure the real phone problem in a browser at 320 and 390 px with 5 and 20 files (is the strip wider than the screen, can it be scrolled by touch, is the page itself scrolling sideways); then build the phone layout of Open Question 4, fix F1 and F2 per Open Question 5, update the affected existing phone assertions (never weaken them) and the docs. Run only the targeted tests listed in Validation 11 to 14, plus the unit suite once.

## Validation
Each item is provable by a test or a command (QA checklist).
1. Unit: the toggle button has `aria-expanded` that follows the state, `aria-controls` pointing at the list, and the names "Hide imported files" and "Show imported files"; it works with the keyboard (Enter and Space) and has a visible focus style class.
2. Unit: when closed, the file buttons are not reachable by Tab and not visible to assistive technology, yet the list stays mounted (status marks and selection survive closing and reopening).
3. Unit: the closed rail or bar shows the file count and the open file's name, and updates when another file is selected while closed.
4. Unit: the remembered choice is read on load and written on change through `storage.service`; with storage throwing or blocked the page renders with the default and no error (Open Questions 2 and 3).
5. E2E (Playwright, real backend and the fake GitHub): after importing 3 files, closing the list makes the editor wider by at least the list's width on desktop (measured with `boundingBox`, within 2 px), and taller on a phone by the strip's height; reopening restores the original size; switching files while closed works through the rail or bar; after a reload the choice is the remembered one.
6. E2E: with the list closed, "Run review" still reviews the open file, and the leave guard still asks before leaving unsaved drafts.
7. E2E at 1280, 768 and 390 px, in light and dark themes: no horizontal page scroll, the button is visible and not clipped.
8. `prefers-reduced-motion`: no width transition class applies (unit or e2e with `emulateMedia`).
9. `cd frontend && npx tsc --noEmit` and `npm run lint` pass; `npm test` passes with the pass count reported against the baseline; no test is removed or weakened.
10. No inline styles and no new `.css` file (`git diff --stat` shows none); `.doc/architecture.md` describes the toggle and its storage key.
11. (Revision 1, phones) E2E at 320 and 390 px, with 5 files and with 20 files with long names: every file can be reached and opened (the last one too), the page itself does not scroll sideways, the control is one row high when closed (at most about 3 rem), and the open list scrolls vertically inside a maximum height without covering the Run review button permanently.
12. (Revision 1) The phone control shows the open file, its language and status mark and "N of M"; each row shows name, language, status mark and, for failed or skipped files, the reason; unopenable files cannot be selected; choosing a file closes the list, updates the editor and the control, and a selection made after Run review shows the new mark.
13. (Revision 1) Accessibility: the phone trigger has `aria-expanded` and `aria-controls`, the list opens and closes with the keyboard (Enter, Space, Escape, arrow keys or Tab), Escape and an outside tap close it and return focus to the trigger, and the list has an accessible name. The dropdown respects `prefers-reduced-motion`. No inline styles, no new `.css` file.
14. (Revision 1, F1 and F2, if Open Question 5 is A) QA's two failing toast-overlap e2e checks and its failing quick-toggle unit test (`qa-038-*`) pass unchanged; the desktop and tablet behaviour, rail, remembered choice and tests of this plan still pass.

## Risks
- **Editor not re-measuring** after the width changes, leaving a blank strip or a clipped editor. Mitigation: Validation 5 measures the real editor width; if needed the editor gets a resize trigger.
- **Hidden list still focusable** (keyboard trap or confusing Tab order). Mitigation: Validation 2 and `hidden` or `inert` on the collapsed list content, not only `overflow-hidden`.
- **Layout shift with the loader** from plan 037. Mitigation: Validation 7, and the page keeps its existing structure.
- **Phone bar takes too much height.** Mitigation: a one-row bar of about 2.5 rem, checked at 320 and 390 px.
- **Stored value out of date** (an old or malformed value). Mitigation: only the two valid values are accepted; anything else means the default.

## Rollout Order
1. Texts, storage helper, tests (step 2).
2. Toggle and collapsed look (steps 3, 4).
3. Playwright spec and docs (steps 5, 6).
4. Validation, QA, then merge after the human approval gate.

## Rollback
Revert the branch `feat/file-list-toggle` (or `git revert` its commits after merge). The change is frontend-only, with no database, API or contract change; a leftover browser storage key is harmless and ignored.
