# New Review Page UI (mock data)

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Build the New Review page UI in `frontend/` from `frontend/src/assets/code-reviewer-concept.png` (the "Review Results" panel), using mock data only. UI only, no functionality.

## Scope
- Frontend only (no `stack:full`); no backend, no API calls. No Figma attached.
- In scope:
  - `Sidebar` (left, dark navy): brand, nav items (Dashboard, New Review, Review History, GitHub Integration), Settings, Help, user footer.
  - `ReviewPage` main area with a top bar `ReviewStatusBar`: Overall Status, Language, Analyzed, Quality Score.
  - Tabbed container `ReviewTabs` with 4 tabs: Summary, Findings, Suggested refactors, Generated tests.
  - `CodeEditor` (Monaco) with a language selector.
  - `FindingsSummary` (Critical / High / Medium / Low counts) and `KeyIssues` (items with title and description such as "Line 2 - Unsanitized user input in fetch URL").
  - `View all findings` and `Download report` buttons (visual only, no handlers).
  - Mock data in `src/mocks/review.ts`; shared types in `src/types/index.ts` (mirroring the domain terms in `.doc/glossary.md`).
- Out of scope: Dashboard, History, GitHub pages, routing, API/polling, PDF generation, the full findings list view, real language switching of analysis, mobile layout beyond not breaking.
- The Findings, Suggested refactors and Generated tests tabs render a simple mock-driven placeholder list/code block; the Summary tab is the full concept layout.

## Assumptions
- Use the theme tokens from plan 005 (`bg-primary`, `bg-sidebar-bg`, severity colors); no hard-coded hex in components.
- Icons via `lucide-react`; toasts via `sonner` (per `.rule/ui-rules.md`), not needed yet.
- `@monaco-editor/react` is the editor named in `.doc/architecture.md`; it is a new dependency.
- No router: `App.tsx` renders the sidebar and the New Review page directly. Nav items are non-functional.
- Brand text in the sidebar follows the concept image ("CodeGuardian / AI Code Reviewer").
- Component files follow `.doc/architecture.md` naming under `frontend/src/components/`.

## Open Questions
1. Add `@monaco-editor/react` now? Recommended: **yes** (Monaco is the stated requirement; loads from CDN by default, so tests mock it).
2. Brand name: use "CodeGuardian" from the concept image, or "AI Code Reviewer"? Recommended: **"CodeGuardian" title with "AI Code Reviewer" subtitle**, as in the image.
3. Language selector options? Recommended: **TypeScript, JavaScript, Python, Go, Java** (mock list; changing it updates the Monaco language and the top-bar Language only).
4. Git: the theme work (plan 005) is still uncommitted. Recommended: **commit the theme on `feat/create-application-theme` first, then branch `feat/new-review-page` from it**, so the page diff stays separate.

## Steps
1. Branch `feat/new-review-page` (after answer 4); add `@monaco-editor/react`.
2. `src/types/index.ts`: `Severity`, `ReviewStatus`, `Finding`, `FindingCount`, `ReviewMock` types.
3. `src/mocks/review.ts`: mock review (status completed, TypeScript, "2 minutes ago", score 72/100, counts 1/2/3/1, key issues from the concept).
4. Components in `src/components/`: `Sidebar`, `ReviewStatusBar`, `CodeEditor`, `FindingsSummary`, `KeyIssues`, `ReviewTabs`, plus `SeverityBadge` shared by summary and issues.
5. `src/pages/ReviewPage.tsx` composes the top bar, tabs, editor and side panels; `App.tsx` renders `Sidebar` + `ReviewPage`.
6. Component styles via Tailwind utilities and the theme variables; any shared classes go in `styles/cmps/`.
7. Tests (Vitest + RTL): renders 4 tabs and switches between them, summary counts, key issues list, status bar fields, language select, both buttons present. Mock Monaco in tests.
8. Update `.doc/architecture.md` (component list and change log) and `.doc/glossary.md` if new terms are introduced.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check with `npm run dev` against the concept image.

## Risks
- Monaco in jsdom/Vitest needs a mock; bundle size grows.
- Only a raster concept image exists, so spacing and sizing are approximate.
- Next backlog item and this one overlap on the "Review Results" layout; this plan covers only the New Review page.

## Rollout Order
1. Types and mocks. 2. Leaf components. 3. Tabs and page composition. 4. Tests and docs.

## Rollback
- Revert the branch commit(s); remove `@monaco-editor/react` from `package.json`.
