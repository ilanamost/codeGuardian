# Responsive Layout, Mobile Bottom Navigation

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Make every page usable from small phones to wide desktops using the breakpoints from the backlog (480 / 768 / 1024 / 1280). On mobile, the sidebar is removed and replaced by clickable icons in a bottom footer bar.

## Scope
- Frontend only (no `stack:full`); no Figma attached. Mobile reference: `src/assets/code-reviewer-concept.png`.
- In scope:
  1. **Breakpoints** as Tailwind v4 theme tokens in `styles/setup/theme.css` (`--breakpoint-xs: 480px`, `md`=768, `lg`=1024, `--breakpoint-xl: 1280px`), so utilities `xs:`, `md:`, `lg:`, `xl:` are the single definition.
  2. **Navigation**: below `lg` the sidebar is not rendered; a fixed bottom `MobileNav` shows icon links (Dashboard, New Review, Review History, GitHub) with `aria-label`s and active state. From `lg` up the sidebar shows as today. Page content gets bottom padding equal to the nav height.
  3. **Dashboard**: stat bar is a 2x2 grid on mobile (already 2 columns; keep 2 per row, 4 per row from `lg`); the four chart/list blocks stack one per row below `lg`, 2x2 from `lg`. Charts use responsive containers and relative heights.
  4. **Review pages** (`/review/new`, `/review/:id`): status bar 2x2 grid on mobile; header stacks; tabs scroll horizontally if needed; code editor full width with `min-w` removed on small screens, taller `min-h` in `vh`, larger Monaco font on mobile (via `useMediaQuery`-style hook); Findings / Suggested Refactors / Generated Tests panels stack (sidebar panel above the editor) below `lg`.
  5. **History, GitHub wizard**: single-column lists, stepper compacts (labels hidden on mobile), footer buttons full-width on mobile.
  6. **Units**: fonts and spacing in `rem`/`em` (theme tokens already rem); `vw`/`vh`/`dvh` where useful (editor height, page padding via `clamp()`); no new fixed-px widths.
- Out of scope: backend/API, new features, touch gestures, dark mode, changes to mock data.

## Assumptions
- `Sidebar` stays as the desktop component; new `MobileNav` shares the `navList` (extracted to `src/lib/navList.ts`) so links are defined once.
- Footer-only items (Settings, Help, user avatar) are not shown on mobile (they are non-functional placeholders).
- Visibility is done with CSS (`hidden lg:flex` / `lg:hidden`), not JS, except the Monaco font size, which needs a small `useBreakpoint` hook (matchMedia; guarded for jsdom).
- Page backgrounds, cards and tokens are unchanged; only layout classes change.
- Terms: "mobile navigation" added to `.doc/glossary.md`.

## Open Questions
1. Mobile nav: **icons only with `aria-label`s (recommended, per backlog)** or icon + tiny label?
2. Keep Settings/Help reachable on mobile? Recommended: **no** (placeholders).
3. Monaco mobile font size: recommended **15px** under `md`, 13px otherwise. OK?
4. Breakpoint names: recommended **`xs`/`md`/`lg`/`xl`** (Tailwind defaults for md/lg/xl, custom `xs`), skipping `sm`. OK?

## Steps
1. Branch `feat/responsive-layout` (done).
2. Tokens: breakpoints in `theme.css`; `--mobile-nav-height` in `variables.css`; `useBreakpoint` hook in `src/lib/`.
3. Navigation: extract `navList`; `MobileNav` component; `App.tsx` renders `Sidebar` (`hidden lg:flex`) and `MobileNav` (`lg:hidden`); main area padding for the nav.
4. Dashboard: grid classes for stat bar and blocks; chart sizing.
5. Review pages: header, status bar grid, tabs overflow, editor sizing and font, panel stacking (Findings, Refactors, Generated Tests incl. `TestConfigPanel`).
6. History list, GitHub wizard (`WizardStepper`, `WizardFooter`, `RepoList`, `FileList`), `ReviewRow` wrapping.
7. Tests (Vitest + RTL): `MobileNav` renders the 4 links with active state and labels; `App` renders both nav components with expected visibility classes; `theme.test.ts` asserts the four breakpoint tokens; `useBreakpoint` returns by matchMedia mock; Playwright at 375px, 768px, 1280px: no horizontal overflow on every route, bottom nav visible at 375px and sidebar hidden, sidebar visible at 1280px, dashboard blocks stacked at 375px, editor visible with width > 90% of viewport.
8. Docs: `.doc/architecture.md` (layout, breakpoints, components, change log), `.doc/glossary.md`.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass; `npm run test:e2e` viewport specs pass.
- Visual check with `npm run dev` at 375, 480, 768, 1024, 1280 and 1920 widths on every route: no horizontal page scroll, no clipped content, editor readable on mobile.

## Risks
- Monaco inside flex containers needs explicit min-height/`min-w-0` or collapses; covered by the Playwright editor-size check.
- Recharts needs a sized parent; use `ResponsiveContainer` with fixed-height wrapper.
- jsdom has no layout, so unit tests assert classes/DOM only; real layout is verified in Playwright.
- `100vh` on mobile browsers includes the URL bar; use `dvh` (already used in `App`).

## Rollout Order
1. Tokens and hook. 2. Navigation. 3. Dashboard. 4. Review pages. 5. History and GitHub wizard. 6. Tests and docs.

## Rollback
- Revert the branch commit(s); the sidebar returns as the only navigation and layouts go back to desktop-only.
