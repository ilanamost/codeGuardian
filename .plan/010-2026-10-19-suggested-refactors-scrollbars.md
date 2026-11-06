# Suggested Refactors Style, Tab Scrolling and Thin Scrollbars

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Restyle the "Suggested refactors" tab to match the "Findings" tab, make overflowing tab content scroll, and give the whole app one consistent, much thinner scrollbar style defined in a single place.

## Scope
- Frontend only (no `stack:full`); mock data only. No Figma attached.
- In scope:
  1. **Suggested refactors tab**: replace the bullet list with cards in the same style as the Findings tab (rounded `bg-card` item, round icon badge, bold title, muted description), one card per suggestion. Add a section heading like "Suggested Refactors" as Key Issues has.
  2. **Scrolling**: wherever tab content can be taller than the page, it gets its own scrollbar. Applies to Summary (findings side panel), Findings, Suggested refactors and Generated tests (file list in the sidebar, editor stays in its fixed-height container). Page header, status bar and the tab strip stay in view; the tab panel scrolls.
  3. **Scrollbars**: one global style, defined once, applied to every scrollable element in all pages (thin, theme colors).
  4. Update types and mock data so suggestions are objects (title and description) instead of plain strings.
- Out of scope: Review History page, responsiveness, the `/review/:id` route (separate backlog items), real data.

## Assumptions
- Suggestion shape: `Suggestion = { id, title, detail }` mirroring `Finding` (`message`, `detail`). Mock text comes from the three existing strings, split into a short title and a description (for example title "Encode the id in the URL", detail "Use encodeURIComponent before building the fetch URL").
- Card icon: a `Wrench`/`Lightbulb` icon in a round `bg-primary-soft` badge (new `SuggestionBadge`, mirroring `SeverityBadge`), since suggestions have no severity.
- Layout: the app shell becomes a fixed-viewport layout (`h-dvh`, sidebar fixed, `main` is a flex column with `min-h-0`), and the tab panel is `flex-1 min-h-0 overflow-auto`. This keeps tabs and header visible while content scrolls.
- **Scrollbar style, one place**: in `styles/basics/base.css` a global rule on `*` (universal) using CSS variables defined in `styles/setup/variables.css` (`--scrollbar-size: 6px`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-track`). It uses the standard `scrollbar-width: thin` and `scrollbar-color` plus `::-webkit-scrollbar*` rules for the width in Chromium/WebKit. No component sets its own scrollbar styling.
- Monaco draws its own scrollbars and ignores CSS; its scrollbar size reads the same value from one shared constant (`scrollbarSize` in `src/lib/config.ts`), set to match `--scrollbar-size`, and is used by `CodeEditor`. Only the editor is configured this way.
- Theme tokens only (no hard-coded hex outside `variables.css`), `lucide-react` icons, `bg-card` cards, left-aligned text, no clipping (`min-w-0`, `truncate` where needed).

## Open Questions
1. Scroll behavior: should the **header, status bar and tab strip stay fixed** with only the tab panel scrolling (recommended), or should the whole page scroll as one? Recommended: **fixed header and tabs, scrolling tab panel**.
2. Scrollbar thickness? Recommended: **4px**, thumb in a soft neutral (`--color-neutral` at reduced opacity feel, darker on hover), transparent track. Previous browser default is about 15px.
3. Suggestion card icon: **Lightbulb** (recommended) or Wrench?
4. Should each suggestion card show the related finding or line number (like "Line 2")? Recommended: **no**, only title and description for now (the mock suggestions are not linked to findings).

## Steps
1. Branch `feat/suggested-refactors-scrollbars` from the current branch.
2. Types and mocks: add `Suggestion`, change `ReviewMock.suggestion` to `Suggestion[]`; update `src/mocks/review.ts`.
3. New `SuggestionList` + `SuggestionBadge` components styled like `KeyIssues` and `SeverityBadge`; use them in the Suggested refactors tab; update the tab label count.
4. Scrollbar tokens in `variables.css` (and `theme.css` only if utilities are needed); global scrollbar rule in `base.css`; `scrollbarSize` constant in `src/lib/config.ts` passed to Monaco options in `CodeEditor`.
5. Layout: fixed-viewport shell in `App.tsx`; `main` pages use `flex flex-col min-h-0`; `ReviewTabs` tab panel `flex-1 min-h-0 overflow-auto`; make the Summary side panel, Findings, Suggested refactors and the Generated tests sidebar list scroll inside their containers; keep other pages (Dashboard, GitHub) scrolling in `main`.
6. Tests (Vitest + RTL): suggestion cards render title and description (no bullet list), tab count, tab panel has the scroll container, `base.css` defines the scrollbar variables and the global rule (token test in the style of `theme.test.ts`), the Monaco options receive `scrollbarSize` from the shared constant. Update existing assertions that expected the old bullet list.
7. Docs: `.doc/architecture.md` (scrollbar style location, layout, component list, change log) and `.doc/glossary.md` (suggestion) as needed.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check with `npm run dev`: cards match the Findings tab; long content scrolls inside the tab panel while header and tabs stay; scrollbars are thin on every page, including the sidebar lists and Monaco.

## Risks
- Changing the shell to a fixed viewport can regress page scrolling on Dashboard and GitHub pages; covered by running their tests and a visual check.
- `::-webkit-scrollbar` and `scrollbar-width` behave differently across browsers (Firefox ignores width in pixels; "thin" only).
- jsdom cannot verify layout or scrollbar rendering, so tests assert on markup and CSS text only.
- Monaco's scrollbar must be kept in sync by hand with `--scrollbar-size` (one shared constant mitigates this).

## Rollout Order
1. Types, mocks and the suggestion cards. 2. Scrollbar tokens and global rule. 3. Layout and scroll containers. 4. Tests and docs.

## Rollback
- Revert the branch commit(s); the tab returns to the bullet list and the default scrollbars.
