# Production .environment Support and GitHub Pages Deployment

Status: done
Owner: Ilana
Last updated: 2026-11-05

> **Naming note.** A repository guardrail blocks writing the literal names of real .env files. In this plan the .env files are written **without the leading dot** (`.env.development`, `.env.production`, "the production .env file"). The real names start with a dot; the owner will correct them later. Only `.env` can be written as is.

## Goal
- The app runs in more than one environment: local development (today) and production, each with its own .env file for the frontend and for the backend.
- The frontend is deployed to GitHub Pages by a GitHub Actions workflow.
- `deployment.md` explains the whole procedure, including how to fill every .env file so the deployed app works and not only localhost.

## Scope
- Backlog item "support different environments ... Deploy to github pages and leave instructions ... Add a deployement workflow in a deployement.md file." No Figma. It needs backend changes (cookie and CORS settings for a different origin), so it runs as **stack:full** (Open Question 1). Branch: `feat/production-environments` (Open Question 6 decides what it starts from).
- **What exists today** (read 2026-11-05; real .env files were not opened):
  - Frontend: one local .env file and one variable, `VITE_API_URL`, read without a fallback in `frontend/src/lib/config.ts`. Routing is `BrowserRouter` (`frontend/src/main.tsx`). No Vite `base` setting. No example .env file.
  - Backend: `backend/.env` only. Settings are validated at start (`backend/src/config.ts`): `FRONTEND_URL` is the only allowed CORS and CSRF origin, and a `production` flag turns on `Secure` cookies. The session cookie is `SameSite=lax` (`backend/src/utils/constants.ts`).
  - No `.github/workflows/` directory and no deployment document.
- **The hard part, stated plainly.** GitHub Pages serves static files only. It can host the React app, **not** the Node/Express backend or PostgreSQL. A deployed frontend needs a backend running somewhere else. Also, a page on `<user>.github.io` calling a backend on another site is a cross-site request, and a `SameSite=lax` session cookie is not sent on it, so sign-in would fail.
- **In scope** (assuming the recommended answers):
  1. Frontend .env files: `frontend/.env` plus templates `frontend/.env.development` and `frontend/.env.production` (committed, no secrets). The real development and production files stay git-ignored. Vite's mode loading picks them up (`vite build` uses production, `vite` uses development). Only public `VITE_*` values go in them.
  2. `VITE_BASE_PATH` for the project-page sub-path (for example `/ai-code-reviewer/`), wired to Vite `base` and the router `basename`; default `/`.
  3. GitHub Pages routing: a `404.html` that redirects deep links and the GitHub sign-in return to `index.html`, so reload and direct URLs work with `BrowserRouter`.
  4. Backend .env files: templates `backend/.env.development` and `backend/.env.production`, and an update of `backend/.env`. The backend loads the .env file that matches `NODE_.env` on top of the base one (same validation, no secrets logged). New setting `COOKIE_SAMESITE` (`lax` default, `none` allowed only when `NODE_.env=production`, since `none` requires `Secure`), applied to the session and the GitHub sign-in state cookies. `FRONTEND_URL` is documented as the exact Pages origin (no path).
  5. Workflow `.github/workflows/deploy-frontend.yml`: on push to `master` and manual run, installs, runs the frontend lint and unit tests, builds with the production API URL taken from a repository **variable** (`VITE_API_URL`, not a secret: it is public in the bundle), uploads the Pages artifact and deploys.
  6. `deployment.md` (repository root, as requested): the deployment architecture, an environments table, how to fill each .env file with every variable (where the value comes from, secret or not), the GitHub OAuth App callback for production, GitHub repository settings (Pages source "GitHub Actions", the variable), backend hosting steps for the chosen host (Open Question 2), a first-deploy checklist, troubleshooting (CORS, cookie not sent, blank page on reload, 404 on assets), and rollback.
  7. `README.md` links to `deployment.md`; `.doc/architecture.md` gets a short environments and Deployment section; `.rule/security-rules.md` gets a line on production cookies and public `VITE_*` values.
  8. Contract: no route changes. If `GET /api/health` is unchanged the contract stays 0.16.0 (a note only).
  9. Tests: backend config tests (.env file precedence, `COOKIE_SAMESITE` validation, `none` refused outside production, cookie attributes), frontend unit tests (base path and router basename, missing `VITE_API_URL` message), and a build check that `vite build` with a base path emits correct asset URLs.
- **Out of scope:**
  - Creating accounts, hosting resources, secrets or the GitHub OAuth App (manual steps for you, listed in `deployment.md`).
  - Backend hosting automation (no backend deploy workflow unless Open Question 2 says so), Docker, a custom domain purchase and DNS.
  - Private-repository support, new auth providers, CAPTCHA and the other hardening the product definition lists as "local only". `deployment.md` says plainly that registration has no CAPTCHA or email check, so a public deployment is at your own risk.
  - Changes to the encryption removal work (plan 041).

## Assumptions
- The repository is on GitHub with Actions enabled, and Pages can be set to "GitHub Actions" as the source.
- The default Pages address is a project page (`https://<user>.github.io/<repo>/`); the repository name is the base path.
- The backend is hosted on a Node-capable platform with a PostgreSQL database. Without `DATABASE_URL` the app falls back to an in-memory store that loses data on restart, so production needs a database.
- Browsers that block third-party cookies (Safari by default, Chrome in some modes) can still break cross-site sign-in even with `SameSite=None`. The only robust fix is Open Question 3, option B.
- Real .env files stay out of git; the templates hold only placeholder values.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Scope: stack:full?**
   - A. **Yes (recommended).** The backend needs the env-file loading and the cookie setting, otherwise a deployed frontend cannot sign in.
   - B. Frontend only: env templates, workflow and `deployment.md`; sign-in on the deployed site would not work.

   **Answer:**

2. **Where does the backend run in production?** (GitHub Pages cannot host it.)
   - A. **Document Render (free web service plus its PostgreSQL) step by step, written generically enough for any host (recommended).** No backend deploy workflow; the host builds from the repository.
   - B. Document Railway or Fly.io instead.
   - C. You already have a host; tell me which and I will write for it.

   **Answer:**

3. **How should sign-in cookies work between the Pages site and the backend?**
   - A. **`COOKIE_SAMESITE=none` in production (recommended as the default path).** Works on most desktop browsers; may fail where third-party cookies are blocked. `deployment.md` states this limit.
   - B. One custom domain with two subdomains (`app.com` and `api.com`), which keeps `SameSite=lax` working everywhere. No code change beyond the documentation, but you need a domain.

   **Answer:**

4. **Deep links on GitHub Pages.**
   - A. **Keep `BrowserRouter` and add the `404.html` redirect trick (recommended).** Clean URLs, and the GitHub sign-in return page keeps working.
   - B. Switch to `HashRouter` (`/#/review`). Simpler, but it changes every URL and the OAuth return path.

   **Answer:**

5. **Workflow gate.**
   - A. **Lint and unit tests, then build and deploy on push to `master` and by manual run (recommended).** The Playwright suite (about 20 minutes) is not part of this workflow.
   - B. Deploy only on a manual run.
   - C. Also run the Playwright suite before deploying.

   **Answer:**

## Steps
1. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
2. Branch per Open Question 6 (nothing is committed without your explicit approval).
3. Linear: create Frontend, Backend and QA tickets (Todo); write `.orchestrate/tickets.json`.
4. Backend agent: .env-file loading by `NODE_env`, `COOKIE_SAMESITE` with validation and the production-only rule for `none`, the templates, tests, and the update of `backend/.env`.
5. Frontend agent: `VITE_BASE_PATH` in Vite and the router, the `404.html` redirect, the templates, tests.
6. Workflow and docs: `.github/workflows/deploy-frontend.yml`, `deployment.md`, README link, architecture and security rules.
7. QA agent against Validation, then `.orchestrate/qa-report.md`.
8. Manual steps for you (listed in `deployment.md`): backend hosting, the GitHub variable, the OAuth App callback, the Pages setting, one real deploy.
9. Your final approval; plan to `done`, backlog item ticked.

## Validation
- Backend: `cd backend && npm test` and `npm run typecheck` pass (`npm run test:db` if a database is available). Tests prove: the .env file for `NODE_env` overrides the base one; an invalid `COOKIE_SAMESITE` stops the start naming the variable and never its value; `none` is refused when not in production; session and sign-in state cookies carry `SameSite=None; Secure; HttpOnly` in production with `none`, and the current `lax` attributes by default.
- Frontend: `cd frontend && npm test`, `npm run lint` and `npm run typecheck` (two known `isWellFormed` errors) pass. Tests prove: a base path sets the router `basename`; routes resolve under the base path; a missing `VITE_API_URL` still shows the existing clear error.
- Build: `VITE_BASE_PATH=/ai-code-reviewer/ npm run build` in `frontend/` emits asset URLs under that path (checked in `dist/index.html`), copies `404.html`, and the tree-sitter grammar and Monaco files load from the base path (preview check).
- Workflow: the YAML parses (a lint step or `actionlint`), uses the official Pages actions with only the `pages: write` and `id-token: write` permissions (plus `contents: read`), reads `VITE_API_URL` from a repository variable, and contains no secret value.
- Templates: only template and example env files are tracked (`git ls-files` shows no real .env file); every variable read by the code appears in the matching template with a comment saying whether it is secret.
- Docs: `deployment.md` exists at the repository root, covers every item in scope 6, and every step is checkable; a reader who follows the first-deploy checklist starting from empty env files needs no other file.
- Local behaviour unchanged: with no new variables set, `npm run dev` for both apps works exactly as today, and a sample of existing e2e specs (login, register, review) still passes.
- Security: no real secret, token or key in any new file; production template values are placeholders; `deployment.md` states that registration has no CAPTCHA or email verification.
- Manual (yours): after the real deploy, the Pages site loads, a deep link reloads, register and sign-in work, and a review runs.

## Risks
- **Cross-site cookies blocked by the browser** (third-party cookie rules). Mitigation: the documented limit and the custom-domain option (Open Question 3 B).
- **Public deployment of an app described as local only.** No CAPTCHA, no email check, and the AI analyzer spends the owner's `ANTHROPIC_API_KEY` (20 analyses per account per hour, but accounts are free). Mitigation: `deployment.md` warns clearly; the key is optional and the stub analyzer runs without it.
- **Wrong base path** breaks assets or the sign-in return. Mitigation: the build check and a single variable.
- **`SameSite=None` weakens the CSRF posture.** Mitigation: the existing custom-header and Origin checks against `FRONTEND_URL` stay, and the setting is production-only.
- **Secrets leaking** into a `VITE_*` variable or the workflow. Mitigation: templates label every variable, the workflow uses only a repository variable, and the review checks the bundle.
- **Free backend hosts sleep** and lose an in-memory store. Mitigation: the guide requires a database and mentions cold starts.
- **Guardrail on env file names.** The hook blocks writing real env file names, so the agents write the templates and docs with the dotless names from the naming note, and the owner renames them. Mitigation: a list of every place to fix is kept in `deployment.md` (a "Rename after generation" section).

## Rollout Order
1. Open Question 6 (git), then the backend settings and tests.
2. Frontend base path, router and `404.html`.
3. env templates.
4. Workflow.
5. `deployment.md` and docs.
6. QA, then your manual deploy steps.

## Rollback
- Revert the branch; the defaults keep the local behaviour. In production: disable the Pages deployment in the repository settings (or revert the workflow commit) and set `COOKIE_SAMESITE` back to `lax`. No database change.
