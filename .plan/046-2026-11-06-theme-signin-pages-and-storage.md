# Plan 046: Theme on the sign-in pages and in browser storage

Status: done (Q1 to Q5: proposed defaults accepted)
Owner: orchestrator (frontend agent implements)
Last updated: 2026-11-06
Branch: fix/theme-auth-pages-and-storage
Backlog task: "Fix Bug: The light/dark theme settings do not affect the login/signup pages, and when switching the settings preference in Appearance -> theme, it doesn't update the value saved in the localStorage"
Figma: none (no design change; existing dark tokens in `frontend/src/styles/setup/variables.css` are reused)

## Goal
- The Light, Dark and System default choices apply on `/login` and `/register`, not only inside the app shell.
- Choosing a theme in Settings > Appearance writes the new value to browser storage immediately and visibly, so a reload (signed in or not) shows the same theme.

## Scope
Frontend only (no `stack:full` marker). No backend, API contract or database change; `PUT /api/settings` keeps its shape.

In scope:
- A device-level theme preference in browser storage that is independent of the account settings cache and of sign-out.
- Applying that preference on every page, including the sign-in pages and the moment after sign-out.
- Tests for both symptoms (unit and one Playwright spec).
- Doc note in `.doc/summary-frontend.md` and `.doc/architecture.md` if they describe `cr.settings` as the only theme store.

Out of scope: new themes, a theme toggle on the sign-in pages (see Q1), a pre-React inline script against first-paint flash (see Q4), changing the other settings' persistence, any server-side storage of a signed-out visitor's theme.

## Findings from the code (root cause)
How it works today:
- `frontend/src/lib/useApplySettings.ts` (called from `frontend/src/App.tsx`, above the routes) sets `document.documentElement.dataset.theme` from `settings.theme`. The dark tokens (including `--color-sign-in-bg` and `--color-sign-in-card`) are in `:root[data-theme='dark']` in `frontend/src/styles/setup/variables.css`, and `frontend/src/components/SignInLayout.tsx` uses them. So the sign-in pages are themed by CSS already; the missing piece is the value.
- The only persisted theme is inside the per-account settings cache `cr.settings` (`frontend/src/services/settings.service.ts`). That cache is removed by `clearCache()` on sign-out and on a session that ended (`frontend/src/store/session.slice.ts`, `frontend/src/store/listener.ts`), and `rootReducer` in `frontend/src/store/index.ts` resets the `settings` slice to the defaults (`theme: 'light'`, `frontend/src/models/settings.model.ts`) on every session reset.
- Result 1 (sign-in pages): a signed-out visitor always gets the default `light`. After sign-out the theme falls back to light even for a dark user, and the sign-in pages cannot reflect the user's choice because the choice only exists inside the account.
- Result 2 (storage): `settings.service.save()` writes `cr.settings` as a whole object, only when `settingsUpdated` triggers `saveSettings` through the listener. The theme is one field among many, guarded by `cacheVersion`, and any storage error is swallowed silently (`writeCache`). There is no dedicated, directly observable theme key, so nothing theme-specific changes in localStorage and nothing survives a sign-out.
- Caveat: reading the code, I could not prove that `cr.settings` itself is left stale in every case. Step 1 reproduces the symptom with a failing test before any fix, and the fix (a dedicated key written synchronously) removes the dependency on that path either way.

## Assumptions
- A theme is a device/browser preference as much as an account preference: it must be known before sign-in. The account value (from `GET /api/settings`) still wins once signed in (see Q2).
- The new key is separate from `cr.settings` and is NOT removed by `clearCache()`, like `ui.fileList` (a per-browser display preference kept on sign-out, see `frontend/tests/unit/qa-038-file-list-toggle-adversarial.test.tsx`).
- Only `frontend/src/services/storage.service.ts` touches `window.localStorage`; new code goes through it (guarded read, `AppError` of kind `storage` on write failure).
- No new domain term is needed (`theme` already exists); verify against `.doc/glossary.md` during implementation.

## Open Questions
Each has a proposed default (recommended answer). The plan is written to the defaults; please answer inline under each question to confirm or change.

- Q1. Should the sign-in and register pages get their own theme toggle, or only follow the saved preference?
  Proposed default: only follow the saved preference (device key, or the default when none). A toggle is new UI and was not requested.
  Answer:
- Q2. When a signed-in user's account theme differs from the device key (for example another browser), which wins?
  Proposed default: the account value wins after settings load, and the device key is updated to match. Signed out, the device key wins.
  Answer:
- Q3. What does a visitor with no stored theme see on `/login`?
  Proposed default: `light`, the current default for settings (keeps the "default selected and applied" rule from plan 013). Alternative: `system`.
  Answer:
- Q4. Should the saved theme also be applied by a tiny inline script in `frontend/index.html` before React starts, to avoid a light flash on reload for dark users?
  Proposed default: no, keep it out of this fix (the flash exists today for signed-in users; the store already reads storage synchronously before the first render).
  Answer:
- Q5. Key name for the device theme?
  Proposed default: `cr.theme`, value is the JSON-encoded `"light" | "dark" | "system"` (stored through the storage service), next to `cr.settings`.
  Answer:

## Steps
1. Reproduce first (frontend agent). Add failing tests, then confirm they fail for the reasons above:
   - Unit: with a dark device theme stored and no session, rendering the app at `/login` sets `data-theme="dark"` on `<html>`.
   - Unit: after a sign-out, `data-theme` stays as chosen and the device key is still stored while `cr.settings` is removed.
   - Unit/Playwright: selecting Dark in Settings > Appearance makes the theme key read `dark` in localStorage right away; Light and System likewise.
2. `frontend/src/services/settings.service.ts`: add `readTheme(): ThemeMode | undefined` (guarded with the same allowed values as the model) and `saveTheme(theme: ThemeMode): void` (never throws; a storage failure only means the choice lasts for this session). Export `themeStorageKey = 'cr.theme'` (per Q5). `clearCache()` must NOT touch it. Add both to the `SettingsService` interface and to `frontend/tests/utils/fakeServices.ts`.
3. `frontend/src/store/index.ts`: preload `settings.theme` from `readTheme()` first, falling back to the `cr.settings` value, so the first render already has the right theme.
4. Session reset: keep the device theme instead of falling to `light`. Add a reducer case (for example `themeRestored`) in `frontend/src/store/settings.slice.ts` that sets only `theme` and is NOT matched by the save listener (it matches `settingsUpdated` and `notificationSet` only, so no signed-out PUT is sent). Dispatch it from the existing `isSessionReset` listener in `frontend/src/store/listener.ts` using `services.settings.readTheme()`.
5. Persist on change: write the device key whenever `settings.theme` changes, synchronously and independent of the PUT. Preferred place: the `settingsUpdated` listener (before it dispatches `saveSettings`), writing `saveTheme(state.settings.theme)`; also after `fetchSettings.fulfilled` (Q2: account wins, device key follows).
6. `frontend/src/lib/useApplySettings.ts`: no logic change expected (it already runs above the routes). Update its comment, and verify `system` still follows `prefers-color-scheme` live on `/login`.
7. Verify `frontend/src/components/SignInLayout.tsx` and the sign-in form controls render with the dark tokens (no hard-coded light colours); fix any Tailwind class that bypasses the tokens (no new `.css` files, no inline styles, per `.claude/rules/ui-and-styling.md`).
8. Tests: unit tests next to the existing ones (`frontend/tests/unit/Settings.test.tsx`, `domain.service.test.ts`, `session.test.tsx` style) and Playwright in `frontend/tests/e2e/settings.spec.ts` (choose Dark, assert the storage value, reload, sign out, assert `/login` has `data-theme="dark"`). Existing assertions that `cr.settings` is `null` after sign-out stay true.
9. Docs: update the storage notes in `.doc/summary-frontend.md` and `.doc/architecture.md` if they list browser storage keys; update the `cr.settings` comments in `settings.service.ts`.
10. Run `npm run typecheck`, the Vitest suite and the Playwright specs touched, in `frontend/`. No commit (git-workflow rule: wait for approval).

## Validation
QA checklist, each item provable by a test or command:
1. Unit: with `cr.theme = "dark"` and no session, `/login` and `/register` have `<html data-theme="dark">`; with `"light"` they have `light`.
2. Unit: with `cr.theme = "system"` and a mocked `matchMedia` dark preference, `/login` has `data-theme="dark"`, and a media-query change event updates it live.
3. Unit: with nothing stored, `/login` has `data-theme="light"` (per Q3).
4. Unit: a theme change writes `cr.theme` synchronously (before the PUT answers) for all three values; a PUT that fails still leaves `cr.theme` updated.
5. Unit: `readTheme` ignores an invalid or corrupt value and returns `undefined`; `saveTheme` does not throw when storage is unavailable.
6. Unit/e2e: sign-out removes `cr.settings` but keeps `cr.theme`; `<html data-theme>` after sign-out equals the theme before it; no `PUT /api/settings` is sent while signed out.
7. Unit: signing in as an account whose server theme differs from `cr.theme` ends with the server theme applied and `cr.theme` updated (Q2).
8. Playwright: Settings > Appearance > Dark sets `localStorage['cr.theme']` to `"dark"`; reload keeps dark; sign out; `/login` and `/register` are dark; repeat for System and Light.
9. `frontend/tests/unit/theme.test.ts` (token contrast) still passes, so the sign-in card and inputs stay readable in dark.
10. Existing suites still pass: `Settings.test.tsx`, `session.test.tsx`, `qa-session-round2.test.tsx`, `qa-038-file-list-toggle-adversarial.test.tsx`, `frontend/tests/e2e/settings.spec.ts` (known unrelated layout flakes listed in the backlog are not regressions).
11. `npm run typecheck` shows no new errors (the 2 known `String.isWellFormed` errors are pre-existing).
12. `git diff --stat` shows no change under `backend/` and no new `.css` file.

## Risks
- Account data leaking across accounts on sign-out/sign-in. The device key holds only the theme, which is not account data, and `cr.settings` clearing stays as is (plan 028 rule). Covered by Validation 6 and 10.
- Two sources of truth for the theme (device key vs account). Mitigated by the explicit precedence in Q2 and a test.
- Restoring the theme on reset could accidentally fire a settings save while signed out; the dedicated action avoids the `settingsUpdated` listener (Validation 6 checks no PUT).
- Storage unavailable (private mode): the theme lasts for the session only; no error toast for the theme write.
- A flash of the default theme before React mounts (Q4); accepted.
- The root cause of the "localStorage not updated" symptom was not fully reproduced by reading; Step 1 may reveal a different cause, in which case the plan is revised before further work.

## Rollout Order
1. Human approval of this plan and answers to Q1 to Q5.
2. Frontend agent: steps 1 to 9 (one ticket, frontend-only).
3. QA agent: the Validation list, report in `.orchestrate/qa-report.md`.
4. Backlog item closed and committed only after explicit user approval.

## Rollback
Revert the branch `fix/theme-auth-pages-and-storage` (nothing is merged or committed before approval). The change is additive and frontend-only: the `cr.theme` key is unused by older builds and harmless if left in a browser; `cr.settings` and the API are untouched, so no data migration is needed.
