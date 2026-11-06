# Application Theme (CSS Variables)

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Create the application theme from `frontend/src/assets/code-reviewer-concept.png` and expose it as CSS variables usable across the whole app.

## Scope
- Frontend only (no `stack:full`); no backend, Linear-independent code changes.
- In scope: design tokens (color, severity, status, typography, spacing, radius, shadow, sizing) as CSS variables, structured per `.rule/style-rules.md`.
- Out of scope: building pages/components (next backlog task), dark/light toggle logic, Figma (none attached).

## Assumptions
- Tokens are derived from the concept image: dark navy sidebar, white cards on a light-grey page, blue primary (`#2f6bff`-ish), severity colors red/orange/yellow/blue, status green/red, dark code panel.
- Tailwind v4 is already installed; variables are exposed to utilities via an `@theme` block so classes like `bg-primary` work, while plain `var(--...)` stays usable in CSS.
- Exact hex values are estimated by eye from the image and can be tuned.

## Open Questions
1. Should `main.css` replace `src/index.css` as the entry (per `.rule/style-rules.md`)? Recommended: **yes**, and update the import in `src/main.tsx`.
2. Include a dark-mode token set now? Recommended: **no**; the concept is a single light theme with a dark sidebar and code panel.
3. Font: Inter (web font) or system stack? Recommended: **system stack with Inter first**, no new dependency.

## Steps
1. Create `frontend/src/styles/main.css` importing `setup`, `basics`, `cmps` (and `tailwindcss`).
2. `styles/setup/variables.css`: `:root` tokens.
   - Colors: `--color-primary`, `--color-primary-hover`, `--color-primary-soft`, `--color-sidebar-bg`, `--color-sidebar-text`, `--color-sidebar-active`, `--color-page-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-code-bg`, `--color-code-text`.
   - Severity: `--color-critical`, `--color-high`, `--color-medium`, `--color-low` (+ `-soft` backgrounds).
   - Status: `--color-success`, `--color-danger`, `--color-warning` (+ `-soft`).
   - Typography: `--font-sans`, `--font-mono`, size scale. Spacing scale, `--radius-sm/md/lg`, `--shadow-card`, `--sidebar-width`.
3. `styles/setup/theme.css`: Tailwind `@theme inline` mapping the variables to utilities.
4. `styles/basics/base.css`: html/body/#root height, background, text color, font, focus ring.
5. `styles/cmps/`: empty placeholder (`.gitkeep`) for component styles added later.
6. Point `src/main.tsx` at `styles/main.css`; remove `src/index.css`.
7. Add a minimal token smoke test (vitest) that checks `variables.css` defines the required tokens. Update `.doc/architecture.md` with the styles layout.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check: `npm run dev` page picks up background/font from tokens.

## Risks
- Hex values are approximations from a raster image.
- Replacing `index.css` could break the existing import or tests; covered by the build/test run.

## Rollout Order
1. Tokens and theme mapping. 2. Entry swap. 3. Test and docs.

## Rollback
- Revert the branch commit(s); `src/index.css` is restored by git.
