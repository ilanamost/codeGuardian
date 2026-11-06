# UI Fixes: Sign-In Background, Dashboard Double Scrollbar, Mobile Editor Scrolling

Status: done
Owner: Ilana
Last updated: 2026-10-28

## Goal
1. The sign-in (and register) page has a darker background, so the small white card no longer sits on an almost empty white page.
2. The Dashboard shows one scrollbar, not two, in tablet view.
3. In the code editor on a phone, the user can always scroll horizontally to see long lines.

## Scope
- Backlog task: "UI fixes: frontend only: 1. In Sign in page, make the background a bit darker... 2. In tablet view, there are 2 scrollbars in the page instead of one, in the 'Dashboard' page. 3. In mobile, it is impossible to scroll horizontally in the code editor since the horizontal scrollbar dissappears." Frontend only, no Figma. Branch: `fix/ui-login-dashboard-mobile-editor`.
- **Diagnosis** (real browser, temporary Playwright specs, 2026-10-28, deleted afterwards):
  - **Sign-in background:** `SignInLayout` (`frontend/src/components/SignInLayout.tsx`) uses `bg-page-bg`, which is `#f4f6fb` in the light theme (`frontend/src/styles/setup/variables.css`), a near-white page behind a white `bg-card` card.
  - **Dashboard double scrollbar:** the page has two vertical scrollers when the viewport height is below about 700 px, whatever the width. The inner `<main>` scrolls (`overflow-auto`, content 1357 px) and the document itself also overflows (`documentElement.scrollHeight` 890 px against `innerHeight` 600 px at 800x600, 1000x600, 1023x700). At 768x1024, 820x1180 and 1024x768 the document does not overflow, so only one scrollbar shows. Something in the shell has a minimum height of about 890 px, larger than the viewport; the agent finds it.
  - **Mobile editor:** in an emulated touch phone (375x667, `hasTouch`, `isMobile`) on `/review/new`, the horizontal scrollbar is present and stays visible (16 px high, class `visible`, opacity 1 after 3 s), and both a horizontal swipe and dragging the slider scroll the code. So the failure does not reproduce in this one case. It may depend on the page (an existing review, the Generated tests editor), the device or browser (iOS Safari), the orientation, or the state (after an upload or language change). Open Question 2 asks you where it fails.
- In scope:
  1. **Sign-in and register background** per Open Question 1: a new colour token (declared in `:root` in `variables.css` and exposed through the theme file, as in `.claude/rules/ui-and-styling.md`), used by `SignInLayout`. Both app themes checked; text and card contrast stay at WCAG AA.
  2. **Dashboard single scrollbar** at every viewport size: find the element that forces the document to overflow and fix it, so the document never scrolls while `<main>` is the scroller. Check every page and the mobile layout for the same overflow (the `responsive.spec.ts` list), not only the Dashboard.
  3. **Mobile editor horizontal scroll**: reproduce on the pages and devices in Open Question 2, find the cause, and fix it so a long line can always be scrolled, by swiping and by the scrollbar. The scrollbar stays visible and at least 16 px high below `md` (plan 021). Applies to both editors (Summary and Generated tests).
  4. **Tests**: Playwright checks that no document overflows beside `<main>` at several tablet and short viewports on the Dashboard and the other pages; a mobile test that scrolls a long line by touch swipe and by dragging the slider, on the pages found in step 3; a visual or computed-style check for the sign-in background in both themes.
- Out of scope:
  - The syntax-error markers for wrong code, which stay in the backlog item "In the code editor in mobile..." (its mobile scroll part is done here; the item is edited when this plan completes).
  - Redesigning the sign-in page layout beyond the background.
  - Backend, API contract and database.

## Assumptions
- "Tablet view" means a viewport between 768 and 1023 px wide, in portrait or landscape; the double scrollbar appears when the height is short. The fix covers every size.
- Tests keep using the signed-in e2e fixture; the sign-in page tests use a signed-out context.

## Open Questions
Answer inside this file, on the `**Answer:**` line under each question. If you only write "approved", the recommended answer is used.

1. **How should the sign-in background look?**
   - A. **(Recommended)** A darker neutral tint of the light theme's page colour (about `#dfe5f1`) behind the white card, with a subtle top-to-bottom gradient to the page colour is not used (flat colour). The dark theme keeps its current dark background.
   - B. A deep brand-coloured background (the dark navy used in the dark theme, `#0c1426`) on the sign-in and register pages in both themes, with the card on top.
   - C. A different colour you name.

   **Answer:** A.

2. **Where does the mobile editor scroll fail for you?** The emulated phone on a new review works, so I need the case that breaks.
   - A. **(Recommended)** I test the Summary and Generated tests editors on `/review/new` and on an existing review, in portrait and landscape, with a 375x667 and a 390x844 touch phone, after typing, uploading and switching the language. You add the device and browser if you know them (for example "iPhone, Safari") and what you did before it failed.
   - B. It fails only on a real phone; I cannot reproduce it, so the plan fixes the likely causes found in the code (touch handling, scrollbar auto-hide, the page scroller taking the swipe) and you retest on the device.

   **Answer:** A (no device or browser was given).

## Steps
1. **Diagnose** each of the three issues again with a temporary spec (deleted afterwards) and record the cause in the handoff report: the element that makes the document 890 px tall; the case where the editor scroll fails.
2. **Fix** the three issues (Scope 1 to 3), tokens and Tailwind utilities only, no new `.css` file, no inline styles, no semicolons.
3. **Tests** (Scope 4).
4. Run `cd frontend && npm test`, `npm run typecheck` (only the known TS2550 errors are allowed), `npm run lint`, and only these Playwright specs: `responsive`, `login`, `register`, `mock-mode`, `code-editor`, the new spec. No full suite; QA runs it once at the end.
5. **QA** against Validation → `.orchestrate/qa-report.md`; then your approval, the backlog item marked `[V]`, and this plan set to `done`.

## Validation
- [ ] `cd frontend && npm test` passes. `npm run typecheck` shows only the known TS2550 `isWellFormed` errors. `npm run lint` is clean.
- [ ] Playwright: on the Dashboard and the other app pages, at 768x1024, 820x1180, 1024x768, 800x600, 1000x600 and 1023x700, the document does not overflow (`documentElement.scrollHeight <= innerHeight`) and only `<main>` scrolls vertically.
- [ ] Playwright: the sign-in and register pages' background colour is the new token value in the light theme and unchanged in the dark theme; the card text contrast is at least 4.5:1.
- [ ] Playwright: on the pages and phones from Open Question 2, a long line scrolls horizontally by a touch swipe and by dragging the slider, the scrollbar stays visible (at least 16 px high), also after typing, upload and a language switch, and the page does not scroll sideways.
- [ ] The existing `responsive`, `code-editor`, `login` and `register` specs still pass; the one full `npm run test:e2e` run passes (a flaky Monaco CDN load that passes when rerun alone is reported, not counted as a defect).
- [ ] `git diff --stat` shows nothing under `backend/` or `.orchestrate/api-contract.yaml`, no new `.css` file, no inline styles.

## Risks
- The mobile failure may only reproduce on a real device (Open Question 2, B). Then the fix is best effort and needs your retest.
- Changing the shell height (issue 2) can affect every page's layout and the editor height; the responsive specs and the other pages' checks cover it.
- A darker sign-in background must keep the card readable in both themes.

## Rollout Order
1. Sign-in background (smallest).
2. Dashboard overflow fix and its cross-page check.
3. Mobile editor fix.
4. Tests, QA, your approval.

## Revision 1 (what the implementation found, 2026-10-28)
- **Dashboard double scrollbar, cause:** a screen-reader-only `p.sr-only` on the Dashboard is absolutely positioned and no ancestor was positioned, so it sat about 890 px down the document and made it taller than a short viewport. Fix: `relative` on the root element in `frontend/src/components/AppShell.tsx` (covers every page).
- **Mobile editor, cause:** scrolling never failed in the emulated cases (swipe and slider drag work). The slider was a faint grey square (about 1.7:1 against the dark editor) with no track and, on a long line, only Monaco's 20 px minimum width, so on a phone it looked like a selection box and not a scrollbar. The earlier colour override never took effect because Monaco's own CSS outranks Tailwind utilities. Fix: new tokens for a light slider (about 9:1) on a visible track, set as Monaco's own variables on the main editor's scrollbars in `CodeEditor.tsx` (popups unchanged), in both editors at every width. A case where the code refuses to scroll was not reproduced; a real-phone retest (especially iOS Safari) is still needed.
- **Sign-in card:** `bg-card` is `#e0e5ee` in the light theme, which would nearly vanish on the new background, so a second token `--color-sign-in-card` (white in light, the old dark card colour in dark) is added.

## Revision 2 (QA round 1 and your feedback, 2026-10-28)
QA passed round 1 with two Low findings, and your feedback at the approval gate added more. All of these are now in scope:
- **F1:** error text contrast is 3.76:1 (light) and 4.24:1 (dark), below 4.5:1. Add an error-text token (about `#dc2626` light, `#f87171` dark) and use it in `TextField`, `PasswordField`, `LoginPage`, `RegisterPage`.
- **F2 and your feedback "input borders are not visible at all in all the application forms":** input borders are 1.23:1 against the card on the sign-in/register pages, and you do not see them in any form. Add one input-border token with at least 3:1 against the card and the page background in both themes (about `#8a94ab` light), and apply it to every form control in the app (sign-in, register, Settings password and Security forms, Help/Contact Support, GitHub link field, search/filter fields, selects, textareas, review name input), not only the sign-in page.
- **Your feedback "in /login a default password appears, the field should be empty":** find where it comes from (a `defaultValue`/initial state, a `placeholder`, the browser autofilling saved credentials, or the JSON/test seed) and make the password field empty on `/login`, `/register` and the password-change form. Add `autocomplete` values that stop the browser from prefilling a wrong password (`current-password` on login, `new-password` on register and change) and a test that asserts the field is empty on load. This overlaps the backlog item "in Signup, Login and Update password: the password that appears is not the user password"; if this fix covers it, say so and that item is closed with this plan.
- **Your feedback "I still can't see the horizontal scrollbar in the mobile Chrome emulator":** QA sees a 16 px bar with a 21 px slider on a track at 375x667 after a long line is typed, but you do not. Find out why in your exact conditions: Chrome DevTools device toolbar (Responsive and the presets), the page at `/review/new` and `/review/:id`, with the default text and with a long line, zoom level, whether the editor is below the fold or under the bottom nav on your preset, whether Monaco shows no horizontal scrollbar when no line is wider than the screen (it only appears when the content overflows), and whether the page `viewport` meta tag is present and correct. If the scrollbar only exists when a line overflows, make a horizontal scroll affordance clearly visible on phones anyway (for example a wider, always-visible track and a longer minimum slider length) and say what you chose.
- **I1:** the older Monaco specs wait only 5 s; use the shared 30 s Monaco wait.

## Revision 3 (QA round 2 and your decision, 2026-10-28)
QA round 2 passed (token contrast, read-only password field, always-visible phone track). You decided:
- **Backlogged:** the three error messages still on the old red, the double focus ring, and the 5 s Monaco wait in `responsive.spec.ts` (added as the last backlog item).
- **In scope now:** on phones (below `md`), the code editor with its horizontal scrollbar must be visible on load. On a 375x667 phone the whole editor starts below the fold (top at y about 620 to 670, under the bottom nav, track at about y 1004), so the scrollbar cannot be found without scrolling the page. Make the editor and its bottom track reachable within the first screen on phones: for example a shorter editor on phones (not 60% of the screen height) and/or the editor placed above the status cards, chosen by the agent so that the Summary and Generated tests editors, the Review page and `/review/new` all show the editor and its horizontal track above the bottom nav on 375x667, 390x844 and 412x915 without scrolling the page. Tablet and desktop layouts stay as they are.

Validation additions:
- [ ] On 375x667, 390x844 and 412x915 portrait, on `/review/new` and an existing review, the editor's bottom edge and its horizontal track are fully inside the visible area above the bottom nav on load, without scrolling the page (Playwright geometry test, also after the page settles); the editor stays usable (at least about 8 lines visible) and the findings summary is still reachable by scrolling.
- [ ] Tablet and desktop layouts are unchanged (existing `responsive` and `page-layout` specs pass).

## Rollback
- Revert the branch `fix/ui-login-dashboard-mobile-editor`. No data, contract or schema changes.
