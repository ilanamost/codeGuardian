# Settings Pages UI (mock data)

Status: done
Owner: Ilana
Last updated: 2026-10-20

## Goal
- Add a `/settings` page with five sections (Account, Security, Notifications, Appearance, AI preferences), based on `frontend/src/assets/code-reviewer-settings.png`, running on mock data only.

## Scope
- Frontend only (no `stack:full`); no Figma attached. Reference image: `frontend/src/assets/code-reviewer-settings.png`. Branch: `feat/settings-pages-ui`.
- In scope:
  1. **Route and nav**: `/settings` route; the Sidebar "Settings" button becomes a `NavLink`; `MobileNav` gets a Settings icon (5 items) so it is reachable on mobile.
  2. **Layout** (as in the image): page title and subtitle, inner left section list (Account, Security, Notifications, Appearance, AI preferences) in a card, content panel on the right. Below `lg` the section list becomes a horizontally scrollable tab row above the panel. The image's "Integrations" item is **not** built (the backlog lists five options).
  3. **Account**: avatar (initials "JD"), full name, email, "Member since" date, all from mock data. No edit.
  4. **Security**: read-only masked "Current password" with an "Update password" button. Only after clicking it are "New password" and "Confirm password" shown, each with a working reveal (eye) toggle; Current password also has a reveal toggle. Mock validation (min length, match), then a success toast. A simple "Sign Out" button replaces "Active Sessions" (mock: toast only).
  5. **Notifications**: four toggles (Review completed, Review failed, Critical security findings, Email notifications) with descriptions. Enabled types raise a `sonner` toast in the app when the matching event happens (see Open Question 3).
  6. **Appearance** (radio groups, each with an applied default): Theme (Light default / Dark / System default, which follows the OS appearance; functional), Editor font size (Small 12 / Medium 14 default / Large 16, applied to Monaco), Review history density (Comfortable default / Compact, applied to the history list).
  7. **AI preferences**: Review focus (All categories default / Bugs / Security / Performance / Readability), Review strictness (High-confidence only / Balanced default / Comprehensive), Explanation detail (Concise / Detailed default), Generated tests (toggle, on by default), Programming language (Auto-detect default / fixed list).
  8. **State**: a `SettingsProvider` (React context) persisted to `localStorage` (guarded with try/catch), consumed by the pages that apply the settings. Mock account data in `src/mocks/settings.ts`; types in `src/types/index.ts`.
- Out of scope: backend/API, real auth or password change, real notification delivery or email, profile editing, Help page, Integrations section.

## Assumptions
- Dark theme is done by overriding the colour tokens in `styles/setup/variables.css` under `:root[data-theme="dark"]`; components already use tokens, so no per-component dark classes. Monaco stays `vs-dark`.
- Settings are local to the browser (`localStorage`); there is no per-user storage until the backend exists.
- "Appear in the application" for notifications means an in-app toast triggered by the mock review lifecycle (the "Regenerate"/review actions already in the UI plus a dev-only "send test notification" button in the Notifications panel), since no real events exist yet.
- Reuse existing tokens, `Card`-style classes, `cursor-pointer` on clickable items, thin scrollbars and `rem` units per the earlier plans.
- Terms added to `.doc/glossary.md`: "settings section", "notification type".

## Open Questions
1. Should settings persist across reloads (localStorage)? Recommended: **yes**.
2. Reveal icon on "Current password" too? Recommended: **yes**, a mock value like `••••••••` revealed as `mock-password`.
3. How do notifications fire with no real events? Recommended: **toasts from the existing mock actions plus a "Send test notification" button per type**. Alternative: only the button.
4. Mobile reach: add Settings as a 5th icon in `MobileNav`? Recommended: **yes**.
5. Programming language list: recommended **Auto-detect plus the languages already in `CodeEditor`'s `languageList`**.
6. Dark theme: should it also flip the sidebar and code editor chrome? Recommended: **keep sidebar and editor dark as today, flip page, cards, text and borders only**.

## Steps
1. Branch `feat/settings-pages-ui` (done).
2. Types and mocks: `SettingsState`, option unions, `mockAccount`, defaults in `src/mocks/settings.ts`.
3. `SettingsProvider` + `useSettings` in `src/lib/` (load/save, apply `data-theme` and `data-density` on `<html>`); wrap in `main.tsx`.
4. Dark token overrides in `variables.css`; verify contrast on the page, cards and borders.
5. Nav: `/settings` route in `App.tsx`; Sidebar Settings becomes a `NavLink`; `MobileNav` icon.
6. Components: `SettingsPage`, `SettingsNav`, `AccountPanel`, `SecurityPanel` (+ `PasswordField` with reveal), `NotificationsPanel` (+ `ToggleSwitch`), `AppearancePanel` and `AiPreferencesPanel` (+ `RadioGroup`), each under `src/components/`.
7. Apply settings: Monaco font size in `CodeEditor`, default layout in `ReviewPage`, density in `ReviewHistoryList`/`ReviewRow`, notification toasts through a `notify(type, message)` helper that checks the setting.
8. Tests (Vitest + RTL): section switching; Security hides new/confirm until "Update password", reveal toggles flip input `type`, mismatch error; toggles update state and `notify` respects them; theme radio sets `data-theme`; defaults are selected and applied; persistence round trip. Playwright: `/settings` at 375 and 1280px has no horizontal overflow and the dark theme persists after reload.
9. Docs: `.doc/architecture.md` (route, provider, theming), `.doc/glossary.md`.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass; `npm run test:e2e` passes.
- Manual check with `npm run dev`: every section renders, defaults are selected, theme switch works, no horizontal scroll at 375 to 1920px.

## Risks
- Dark theme may expose hard-coded colours in existing components; fix by moving to tokens only where visibly broken.
- Layout and density settings touch existing pages; keep the changes minimal and covered by existing tests.
- `localStorage` can be unavailable; all access is wrapped and the defaults are used.

## Rollout Order
1. Types, mocks, provider. 2. Nav and route. 3. Account, Security, Notifications. 4. Appearance and theming. 5. AI preferences. 6. Applying settings elsewhere. 7. Tests and docs.

## Rollback
- Revert the branch commits; `/settings` disappears, the Sidebar Settings button returns to a placeholder and the app keeps its light-only look.
