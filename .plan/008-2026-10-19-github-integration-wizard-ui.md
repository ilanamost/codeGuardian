# GitHub Integration Wizard UI (mock data)

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Build the GitHub Integration page as a multi-step wizard (not a dialog), based on the "Select Repository" design in `frontend/src/assets/code-reviewer-concept.png`, with mock data only.

## Scope
- Frontend only (no `stack:full`); no backend, no GitHub OAuth, no API calls. No Figma attached.
- In scope:
  - Route `/github` (the sidebar "GitHub Integration" item becomes a link and highlights).
  - `GithubWizardPage` with a step indicator and two steps:
    1. **Select Repository**: title; a GitHub connect card with a "Connect GitHub" button. After connecting, the card shows the connected user's email and a "Switch account" action. Below it a search input that filters repositories by name, then a radio-style repository list (name, description) with one selectable item. Bottom buttons: **Cancel** and **Next** (Next disabled until a repository is selected).
    2. **Select File**: shows the chosen repository, a file list (mock) with one selectable file, bottom buttons **Cancel** and **Approve**. Approve imports the file (mock): shows a success toast (`sonner`) and returns to the first step.
  - Wizard state kept in React state only (connected, selected repo, selected file, search text).
  - Mock data in `src/mocks/github.ts`; types in `src/types/index.ts`.
- Out of scope: real OAuth/GitHub API, real import into the review editor, back-end, persistence, branch/folder navigation in the file list (flat list only), pagination.
- "Cancel" resets the wizard to step 1 (no dialog to close).

## Assumptions
- Reuse theme tokens and existing patterns (cards, buttons, `Sidebar` routing). No hard-coded hex in components.
- Icons from `lucide-react` (it has no `Github` icon in the installed version; use `GitBranch` as in the sidebar, or an inline SVG mark if a closer match is wanted, see Question 2).
- Mock connect: clicking "Connect GitHub" connects as `john@company.com`; "Switch account" disconnects back to the connect state (mock, no real switching).
- Mock repositories from the concept: `frontend-app`, `backend-api`, `mobile-app`, `shared-components`; each with mock files.
- Step 2 only offers reviewable source files (e.g. `.ts`, `.tsx`, `.js`, `.py`).
- Accessibility: radio inputs with labels for selection, `aria-current="step"` on the step indicator, search input has a label.

## Open Questions
1. Step indicator: show a visible stepper (1 Select repository, 2 Select file)? Recommended: **yes**, a simple 2-step stepper above the card.
2. GitHub logo: use `GitBranch` (consistent with the sidebar) or an inline GitHub SVG mark? Recommended: **`GitBranch`** for consistency, no new asset.
3. Should "Switch account" re-show the connect button, or cycle through a second mock account? Recommended: **return to the Connect state** (simplest, matches "switch account" intent).
4. After "Approve": stay on the page with a success toast and reset, or navigate to New Review? Recommended: **toast and reset to step 1**; wiring into New Review is a later task.
5. Repository list when the search has no match? Recommended: **show an empty-state message** ("No repositories match").

## Steps
1. Branch `feat/github-integration-wizard` from the current branch.
2. Types: `GithubRepo`, `GithubFile`, `GithubAccount`, `WizardStep`.
3. `src/mocks/github.ts`: account, repositories, files per repository.
4. Components in `src/components/`: `WizardStepper`, `GithubConnectCard`, `RepoSearch` (filter input), `RepoList`, `FileList`, `WizardFooter` (Cancel + primary action).
5. `src/pages/GithubWizardPage.tsx` holding wizard state and the two steps; add the `/github` route in `App.tsx`; link the sidebar item.
6. Styles with Tailwind utilities and theme tokens; add tokens only if needed.
7. Tests (Vitest + RTL): connect shows email, switch account returns to connect, search filters and shows empty state, Next disabled until a repo is selected, Next goes to step 2, file selection enables Approve, Cancel resets, Approve shows a toast and resets, sidebar link navigates and highlights.
8. Update `.doc/architecture.md` (component list, route, change log) and `.doc/glossary.md` (wizard, repository, connected account) as needed.

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check with `npm run dev` against the concept image (first step similar to the "Select Repository" dialog, but as a page).

## Risks
- The design is a dialog; translating it to a page layout is by judgment, so the layout is approximate.
- GitHub OAuth is out of scope per `.doc/product-definition.md` for v1; this UI is mock only and must not imply real connectivity (no tokens stored).
- Toast assertions in tests need the `Toaster` mounted or `sonner` mocked.

## Rollout Order
1. Types and mocks. 2. Leaf components. 3. Page, route and sidebar link. 4. Tests and docs.

## Rollback
- Revert the branch commit(s); remove the `/github` route and sidebar link.
