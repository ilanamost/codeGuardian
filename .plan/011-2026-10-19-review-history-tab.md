# Review History Tab, Review by Id Route, Pointer Cursor

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Add a Review History page listing all previous reviews; clicking a review opens `/review/:id` showing that review's contents (instead of `/review/new`). Remove the back arrow on "Review Results". Every clickable item in the app shows a pointer cursor on hover.

## Scope
- Frontend only (no `stack:full`); mock data only. No Figma attached.
- In scope:
  1. **Review History page** at `/history`, wired to the sidebar "Review History" item. Lists all reviews (title, language, time, status badge, severity dots) as clickable rows/cards, styled like the Dashboard "Recent Reviews" and Findings cards (`bg-card`, `border-border`, `shadow-card`, theme tokens).
  2. **Open a review**: clicking a row navigates to `/review/:id`. `ReviewPage` reads `:id`, looks up the review in mock data and displays its contents (status bar, tabs, editor). `/review/new` keeps working as the empty/new-review route. Unknown id shows a "Review not found" state with a link to History.
  3. **Editing**: the opened review's code is editable in the Monaco editor and its language can be changed (local state only, no save, as on the New Review page today).
  4. **Remove the back arrow** in the "Review Results" header.
  5. **Pointer cursor**: one global rule so all clickable items (`button`, `a[href]`, `[role=button]`, `[role=tab]`, `select`, `summary`, `label` for inputs) get `cursor: pointer`; disabled ones keep `not-allowed`/default. Defined once in `styles/basics/base.css`.
  6. Dashboard "Recent Reviews" rows also link to `/review/:id`.
- Out of scope: responsiveness (separate backlog item), backend/API, real persistence, pagination/search in the history list.

## Assumptions
- Mock data: extend `src/mocks/review.ts` with a `reviewById` record. The 9 reviews in `src/mocks/dashboard.ts` (`recentReviewList`) are the source of the history list; each id (`r1`...`r9`) maps to a `ReviewMock` (reuse the existing mock content for all, with per-review title, language and status overrides) so every row opens something.
- New `ReviewHistoryPage` + `ReviewHistoryList` component; reuse `ReviewStatusBadge` and `SeverityDot`. Extract the shared row from `RecentReviews` into `ReviewRow` so both lists stay consistent (rows become `Link` elements).
- Routes: `/history`, `/review/:id`; `/review/new` declared before `:id` so `new` is not treated as an id.
- Pointer cursor is CSS-only (Tailwind v4 preflight resets buttons to `cursor: default`), no per-component classes.
- Sidebar `navList` gets `to: '/history'` for Review History and highlights as active like the other items.
- Terms: "review history" added to `.doc/glossary.md`.

## Open Questions
1. History list layout: **cards/rows list like Recent Reviews (recommended)** or a table with columns?
2. Should the history page have a title/sub-title "Review History - All your previous reviews" and a "New review" button? Recommended: **yes, both**.
3. Unknown id behaviour: **"Review not found" state with link back to History (recommended)** or redirect to `/review/new`?
4. For non-completed reviews (queued, failed...), should the opened page show the mock content anyway? Recommended: **yes, mock content with the real status in the status bar** (no backend yet).

## Steps
1. Branch `feat/review-history-tab` (done).
2. Types and mocks: `reviewById` in `src/mocks/review.ts`, helper `findReview(id)`; reuse `ReviewSummary`.
3. Components: `ReviewRow` (shared, a `Link`), `ReviewHistoryList`; refactor `RecentReviews` to use `ReviewRow`.
4. Pages and routing: `ReviewHistoryPage`; `/history` and `/review/:id` in `App.tsx`; `ReviewPage` reads `useParams`, handles `new` and not-found; remove `ArrowLeft`; Sidebar link.
5. Global pointer cursor rule in `styles/basics/base.css`.
6. Tests (Vitest + RTL): history lists all mock reviews; row links to `/review/:id`; `ReviewPage` renders the review for an id and the not-found state; no back arrow; Sidebar History link active; `base.css` contains the pointer rule (token-style test like `theme.test.ts`); Dashboard rows link. Playwright: history -> open review -> editor visible.
7. Docs: `.doc/architecture.md` (routes, components, change log), `.doc/glossary.md`.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check with `npm run dev`: history list matches app style; click opens `/review/<id>` with that review's content; no back arrow; hover pointer on buttons, tabs, links, dropdowns.

## Risks
- `/review/new` vs `/review/:id` ordering; covered by a routing test.
- jsdom cannot verify the real cursor; tests assert CSS text only.
- A global cursor rule can mark non-interactive `label`/`button` wrongly; limited to enabled elements via `:not(:disabled)`.

## Rollout Order
1. Mocks and shared row. 2. History page and routes. 3. ReviewPage by id and back-arrow removal. 4. Cursor rule. 5. Tests and docs.

## Rollback
- Revert the branch commit(s); the History item returns to a non-link and `/review/new` remains the only review route.
