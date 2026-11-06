# Dashboard Page UI (mock data)

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Build the Dashboard as the application home page from `frontend/src/assets/code-reviewer-concept.png` (top-left "Dashboard" panel), with mock data only.

## Scope
- Frontend only (no `stack:full`); no backend, no API calls. No Figma attached.
- In scope:
  - `DashboardPage` at the home route, with a top stats bar (reuse the style of `ReviewStatusBar`): Total Reviews, Completed, Failed, Avg. Quality Score.
  - Four blocks:
    1. `FindingsBySeverity`: donut chart with total in the center and a legend (count and %).
    2. `FindingsByCategory`: horizontal bar chart.
    3. `ReviewActivity`: line/area chart with a date-range dropdown (Last 7 days, Last 14 days, Last 30 days); mock data per range.
    4. `RecentReviews`: list of reviewed items (title, language, relative time, status badge, severity dots) with a **View all** button that shows the full list (inline expand or a full list view, see Open Question 4).
  - `ReviewStatus` expanded to the 6 values: `pending`, `queued`, `in_progress`, `completed`, `failed`, `cancelled`, each with a label, meaning and badge color.
  - `SeverityDot`: colored dot with a count and a tooltip above the dot explaining its meaning (red = High, yellow = Medium, blue = Low, green = No findings; the number is the count of issues in that severity).
  - Navigation: Dashboard is the home page, New Review stays reachable from the sidebar.
  - Mock data in `src/mocks/dashboard.ts`; types in `src/types/index.ts`.
- Out of scope: API calls, real filtering or search, review history page, GitHub page, responsive/mobile layout beyond not breaking.

## Assumptions
- Chart library: **Recharts** (React-native API, declarative donut/bar/line components, TypeScript types, most widely used for React dashboards). New dependency `recharts`.
- Use theme tokens from plan 005 for all colors (severity and status tokens); chart colors read from CSS variables, no hard-coded hex.
- Tooltips on dots: a small accessible tooltip component (CSS-only with `role="tooltip"` and `aria-describedby`), no extra library.
- Dots follow the backlog definition: red High, yellow Medium, blue Low, green none. The mock data carries `high`, `medium`, `low` counts per review.
- `ReviewStatus` is shared with the New Review page. Its mock (`status: 'completed'`) stays valid.
- Icons via `lucide-react`.

## Open Questions
1. Routing: add `react-router-dom` (real `/` and `/review/new` routes, sidebar highlights the active page) or keep a simple state-based view switch in `App.tsx`? Recommended: **`react-router-dom`**, since Dashboard is the "home page" and Review History/GitHub pages come next.
2. Severity dots and `critical`: the backlog lists only High, Medium, Low and none, while the severity type also has `critical` (the concept's red). Recommended: **treat the red dot as High and fold critical into it for the dots only**; the donut keeps all four severities (Critical, High, Medium, Low) as in the concept.
3. Date ranges for the dropdown? Recommended: **Last 7 days, Last 14 days, Last 30 days** (default 7).
4. "View all" on Recent Reviews: **inline expand** of the list in place, or a separate full-list page (`/reviews`, which would overlap with the later Review History page)? Recommended: **inline expand/collapse toggle** (no new route) so it does not pre-empt Review History.
5. Glossary and product definition currently list `status` as `pending|completed|failed` and the backend contract may mirror that. Recommended: **update `.doc/glossary.md` and `.doc/product-definition.md` to the 6 statuses now** (frontend types first; backend contract change is deferred to its own plan).

## Steps
1. Branch `feat/dashboard-page` from the current branch; add `recharts` (and `react-router-dom` per Question 1).
2. Types: expand `ReviewStatus`; add `ReviewSummary`, `DashboardStat`, `SeverityCount`, `CategoryCount`, `ActivityPoint`, `ActivityRange`.
3. `src/mocks/dashboard.ts`: stats (24 / 21 / 3 / 78), severity counts (48 total), category counts, activity series per range, recent reviews covering several statuses, including at least one each of pending, queued, in_progress and cancelled.
4. Components in `src/components/`: `DashboardStatBar`, `FindingsBySeverity`, `FindingsByCategory`, `ReviewActivity`, `RecentReviews`, `ReviewStatusBadge`, `SeverityDot` (with tooltip).
5. `src/pages/DashboardPage.tsx` composes the stat bar and the 4 blocks; wire routes in `App.tsx`; make `Sidebar` highlight the active route and link Dashboard and New Review.
6. Styles with Tailwind utilities and theme tokens; add missing status tokens to `styles/setup/variables.css` and `theme.css` only if needed.
7. Tests (Vitest + RTL; mock or stub Recharts `ResponsiveContainer` for jsdom): stat bar values, four blocks render, status badge for each of the 6 statuses, dot tooltips show the right text, range dropdown changes the data, View all expands the full list, sidebar navigation.
8. Update `.doc/architecture.md` (component list, routing, charts, change log), `.doc/glossary.md` (6 statuses, dot meanings, new terms) and `.doc/product-definition.md` (statuses).

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check with `npm run dev` against the concept image (donut center total, bar colors, dots, tooltips, range dropdown).

## Risks
- Recharts in jsdom needs sizing stubs; tests may be flaky without them.
- Adding the router changes how the existing New Review tests mount the app.
- Expanding `ReviewStatus` to 6 values diverges from the backend contract (`pending|completed|failed`) until a backend plan aligns it.
- Bundle size grows with Recharts and Monaco.

## Rollout Order
1. Dependencies, types and mocks. 2. Leaf components (badge, dot, charts). 3. Page, routing and sidebar. 4. Tests and docs.

## Rollback
- Revert the branch commit(s); remove `recharts` (and `react-router-dom`) from `package.json`.
