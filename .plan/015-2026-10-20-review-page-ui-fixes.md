# Review Page UI Fixes

Status: done
Owner: Ilana
Last updated: 2026-10-20

## Goal
- Fix four issues on the Review Results page (`/review/new`, `/review/:id`): add a Save Review button, make Download report generate a real PDF, give "View all findings" a hover style and a working full list, and remove the two unwanted scrollbars (tab titles, Findings Summary panel).
- Follow-up after QA: let the user rename a review, keep Save Review always enabled, and let the user delete a review from Review History.

## Scope
- Frontend only (no `stack:full`); no Figma attached. Branch: `feat/ui-fixes`. Mock data only.
- In scope:
  1. **Save Review button**: a secondary button next to "Download report" in the `ReviewPage` header (`Save` icon from `lucide-react`). Click saves the current review (id, language, edited code) to the browser (`localStorage`, key `saved-reviews`) through a small `savedReviews` helper in `src/lib/`, shows a `sonner` toast ("Review saved"), and briefly shows a saved state (label "Saved", disabled until the code or language changes). Saved edits are restored when the same review id is opened again.
  2. **Download report (PDF)**: clicking generates and downloads `review-<id>.pdf` client-side. Contents: title, status, language, analysed time, quality score, findings summary counts, the key issues list (severity, message, line detail), and suggested refactors. Generation logic lives in `src/lib/reportPdf.ts` (pure builder + download trigger), the button only calls it. See Open Question 1 for the library.
  3. **"View all findings"**: add `hover:` style (colour shift to `primary-hover`, underline, `cursor-pointer`) and make it display all findings. Clicking switches the active tab to **Findings**, which already lists every finding. The Summary panel keeps a short preview (first 3 key issues) so the button has a purpose (see Open Question 2).
  4. **Scrollbars**:
     - Tab titles: remove `overflow-x-auto` from the `role="tablist"` row on `lg` and wider, where the four tabs always fit. Below `lg` keep horizontal scrolling for narrow phones but hide the scrollbar track (scrollbar-width none) so no bar is visible.
     - Findings Summary panel: remove `overflow-auto` from the side panel when the content fits, and reduce its padding and gaps (`p-4` to `p-3`, `gap-5` to `gap-4`, tighter list gap) so the mock data fits without a bar. The panel keeps `overflow-auto` only as a safety net via `max-h` + `overflow-y-auto` so very long finding lists still scroll (thin global scrollbar), but the mock data must not trigger it. Also check the `tabpanel` wrapper (`lg:overflow-auto`) does not add a second bar at 1024 to 1920px wide and 600 to 1080px high viewports.
  5. **Editable review name** (added after QA, 2026-10-20): the Review Results header title becomes an editable name. A pencil icon button next to the name switches it to an input (Enter or blur commits, Escape cancels; trimmed, 1 to 80 chars, empty falls back to the previous name). The name is part of the saved review (`name` in the `savedReviews` record), is included in the saved state, in the PDF title, and is shown as the review title in Review History when a saved name exists.
  6. **Save Review always enabled** (added after QA): remove the disabled "Saved" state. The button stays enabled and labelled "Save review"; every click saves again and shows the "Review saved" toast. No change-tracking.
  7. **Delete review in Review History** (added after QA): each row gets a delete icon button (`Trash2`, `aria-label="Delete review <name>"`, pointer cursor, hover colour). Clicking asks for confirmation (inline confirm or small dialog: "Delete this review? This cannot be undone." with Cancel and Delete). On confirm the review disappears from the History list and its saved record is removed. Because history is mock-driven, deleted ids are stored in `localStorage` (`deleted-reviews`) via the `savedReviews` helper and filtered out of the list (and out of the Dashboard "Recent reviews"); a success toast "Review deleted" is shown; opening a deleted review id shows the existing "Review not found" state. Empty history shows an empty state.
  8. **Darker Save button** (added after second QA round): the Save review button currently looks like a page item rather than a button. Give it a darker, clearly button-like style using theme tokens only (a darker shade of `primary`, e.g. a dedicated `--color-primary-dark` token if no suitable one exists, with a darker hover state, visible focus ring, white text), while Download report keeps its own style. Contrast meets WCAG AA.
  9. **Coloured PDF report with icons** (added after second QA round): the PDF is plain black text. Add a styled layout in `reportPdf.ts`: coloured title band with the app name and review name, status chip, colour-coded severity badges (critical/high/medium/low using the theme severity colours), coloured section headings, summary-count tiles, and simple vector icons drawn with jsPDF primitives (no image assets and no icon font), e.g. shield or document icon in the header, a severity dot or triangle per finding, a wrench for refactors, a check or cross for status. Text stays real text (selectable). Page breaks keep headings with their content and repeat nothing wrongly; the unit test still extracts the title, counts and all finding messages.
  10. **PDF palette toned down** (added after user review): the PDF colours are too bright. Derive every PDF colour from the application theme tokens in `variables.css` (surface, border, text, muted text, primary and its dark shades) and use muted/desaturated tints of the severity colours for badges, stripes and count tiles, so the report matches the app's look. No new bright hues; keep text contrast AA on tinted backgrounds.
- Out of scope: backend or API persistence, a Review History "saved" badge, server-side PDF, print stylesheet, i18n of the report, editing findings.

## Assumptions
- Reuse existing building blocks: tokens, `cursor-pointer` on clickables, the single global thin scrollbar style, `rem` units, `lucide-react` icons, `sonner` toasts.
- "Save" before the backend exists means `localStorage` (wrapped in try/catch, the page works when storage is blocked). It is replaced by the API service in the later "model layer / services" backlog item.
- The PDF is built from the mock `ReviewMock` data plus the user's current language; the editor code is not included in the first version.
- Styling in the PDF is plain (system font, severity labels as text) so it needs no font assets.
- No new `docs/` directory; ticket and report files go to `.orchestrate/`.

## Open Questions
1. PDF library? Recommended: **`jspdf`** (small, client-only, no DOM rendering, deterministic text layout, easy to unit test the builder). Alternatives: `@react-pdf/renderer` (heavier, React-based layout) or `window.print()` (not a downloadable file, so rejected).
2. Should "View all findings" switch to the Findings tab, or open a dialog/modal? Recommended: **switch to the Findings tab** (consistent, no new component), and show only the top 3 key issues in the Summary panel.
3. Should Save Review persist to `localStorage` now? Recommended: **yes**, behind `savedReviews.ts` so the API service replaces it later.
4. Should saving also add the review to Review History? Recommended: **no** for now; history stays mock-driven until the backend is integrated.
5. Should the saved edited code be restored when reopening the review? Recommended: **yes**.
6. Delete confirmation? Recommended: **yes**, a confirm step because deletion cannot be undone.
7. Should deleting also hide the review from the Dashboard "Recent reviews"? Recommended: **yes**, one source of truth for the review list.
8. Should the edited name apply to unsaved reviews? Recommended: **name is held in the page state and persisted on Save**, like the code.
9. The remaining thin Findings Summary scrollbar at 600px height on desktop (QA, accepted as the capped safety net unless shrunk further): decided by the user: **accepted**. A scrollbar is correct when the content does not fit the container; 720px and taller never scroll.

## Steps
1. Branch `feat/ui-fixes` (done).
2. `src/lib/savedReviews.ts`: `loadSavedReview(id)`, `saveReview(id, { language, code })` with safe storage access; unit-tested.
3. `src/lib/reportPdf.ts`: `buildReportPdf(review, language)` returns the document, `downloadReportPdf` saves it; add `jspdf` dependency (`npm install jspdf`).
4. `ReviewPage.tsx`: header gets Save Review and Download report buttons wired to the helpers; lift `code` state (or expose via a callback) so Save sees the edited code; success and failure toasts.
5. `ReviewTabs.tsx`: lift `activeTab` control so "View all findings" calls `setActiveTab('findings')`; hover style on the button; Summary panel shows a preview of key issues; tab row scrollbar fix; tighter panel margins and no unwanted `overflow-auto`.
6. `KeyIssues.tsx`: optional `limit` prop for the preview.
7. Verify at 375, 768, 1024, 1280 and 1920px widths and short heights (600px): no scrollbar on the tab row, none on the Findings Summary panel with mock data, one scrollbar max per scroll region.
8. Tests (Vitest + RTL): Save button stores to `localStorage`, shows the toast, and restores on reopen; Save does not throw when storage is blocked; Download calls the PDF helper and the builder output includes the title, counts and every finding message; "View all findings" switches to the Findings tab and shows all findings; hover class is present; tab row has no overflow class at `lg`. Playwright: at 1280x720 neither the tab row nor the Findings Summary panel is scrollable (`scrollHeight <= clientHeight`, `scrollWidth <= clientWidth`); download event yields a `.pdf` file.
9. Docs: `.doc/architecture.md` (saved reviews storage, report generation), `.doc/glossary.md` ("saved review", "report").
10. Follow-up (post-QA, implemented; deviation: the editable name sits beside the Review Results heading, which stays the page `h1`, so the heading and its tests are unchanged): `savedReviews.ts` gains `name`, `deleteReview(id)`, `loadDeletedIds()`; `ReviewPage.tsx` editable name + always-enabled Save; `ReviewHistoryList.tsx` / `ReviewRow.tsx` delete button with confirmation and empty state; filter deleted ids in the Dashboard recent list; PDF title uses the name. Tests: save is enabled after saving and saves again on a second click; rename commit, cancel and validation; name persisted and restored; delete confirm and cancel; deleted review absent from History and Dashboard and shows "Review not found"; e2e for rename, double save and delete. Update `.doc/architecture.md`, `.doc/glossary.md` (term "review name"), `.orchestrate/api-contract.yaml` (future `PATCH /reviews/{id}` for name, `DELETE /reviews/{id}`), and this plan.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass; `npm run test:e2e` passes.
- Manual check with `npm run dev`: Save shows the toast and survives a reload; the downloaded PDF opens and shows all sections; "View all findings" has a visible hover state and opens the full list; no extra scrollbars on tab titles or Findings Summary at desktop sizes.

## Risks
- `jspdf` adds bundle weight; load it with a dynamic `import()` on first click so the initial bundle is unaffected.
- `localStorage` can be unavailable (private mode); wrap access and fall back to an error toast.
- Removing overflow handling can clip content on small heights; keep the capped `overflow-y-auto` safety net and verify at 600px height.
- Lifting the code state touches `ReviewTabs`, covered by existing tests; re-run them.

## Rollout Order
1. Scrollbar and spacing fixes. 2. "View all findings" hover and behaviour. 3. Save Review. 4. PDF report. 5. Tests and docs.

## Rollback
- Revert the `feat/ui-fixes` branch (or the individual commits); no data migrations. Saved reviews live only in the user's `localStorage` under `saved-reviews`, which can be cleared safely.

## Implementation notes (palette follow-up)
- PDF palette is muted: `--report-*` tokens in `variables.css` (light only), primary-dark band and headings, white bordered cards. Long review names wrap to two lines in the header band; a name that cannot wrap is hard-split.
