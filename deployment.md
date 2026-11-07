# Deployment

How to run AI Code Reviewer outside your machine: the web app on GitHub Pages, the API and PostgreSQL on a Node host (Render is written out step by step; any host works). Plan: [042](.plan/042-2026-11-05-environments-and-github-pages.md).

> **Read the warning first.** The app was built to run locally. Registration has **no CAPTCHA and no email verification**, so anyone who finds the public site can create unlimited free accounts. If you set `ANTHROPIC_API_KEY`, every analysis spends **your** Anthropic quota (20 analyses per account per hour, but accounts are free). Leave the key blank (the stub analyzer runs) unless you accept that. Demo credentials (`john.doe` / `mock-password`) exist in a database created by `db:setup`: change that password right after the first sign-in. A public deployment is at your own risk.

> **Naming note.** A repository guardrail stopped the agents from writing the real names of env files, so every env file below is written **without the leading dot** (`env.production`, `env.production.example`). The real files start with a dot. The list of every place to fix is in [Rename after generation](#rename-after-generation).

## 1. Architecture

```
Browser ──► GitHub Pages  (static files of frontend/dist: HTML, JS, CSS, wasm)
   │
   └──────► Backend API (Node/Express) ──► PostgreSQL     (both on a Node host, e.g. Render)
            https://<your-api-host>/api/...
```

- **GitHub Pages hosts only the static frontend.** It cannot run the Node backend or a database.
- The backend and PostgreSQL run on another host. Without `DATABASE_URL` the backend uses an in-memory store that loses everything on restart, so production needs a database.
- The web app (`https://<user>.github.io/...`) and the API (`https://<api-host>`) are different sites. Browser requests between them are cross-site; see [Cookies](#7-cross-site-cookies-and-their-limit).
- The frontend workflow ([.github/workflows/deploy-frontend.yml](.github/workflows/deploy-frontend.yml)) deploys on every push to `master` and on a manual run. The backend is built by the host from the repository; there is no backend deploy workflow.

## 2. Environments

| Environment | Frontend | Backend | Env files |
|---|---|---|---|
| Development (local) | `npm run dev` in `frontend/`, `http://localhost:5173` | `npm run dev` in `backend/`, `http://localhost:3001` | the development env file of each package (from `env.development.example`) |
| Production | GitHub Pages, built by the workflow | a Node host with PostgreSQL | frontend: the **repository variables** (the workflow sets them, no file is committed); backend: the host's environment variables, or the production env file on the server |
| Test / e2e | started by Playwright, ports 5174 / 3101 | `ENABLE_TEST_ROUTE=true`, optional `TEST_DATABASE_URL` | set by the test config; never use these flags anywhere else |

Vite picks the frontend env file by mode (`vite` = development, `vite build` = production). The backend reads the base env file, then the file named after `NODE_ENV` on top, then real process variables on top of both (process variables always win). A missing file is skipped.

## 3. Variables

### 3.1 Frontend (public: Vite copies every `VITE_*` value into the bundle)

**Never put a secret in a `VITE_*` variable.**

| Variable | Required | Value and where it comes from | Secret? |
|---|---|---|---|
| `VITE_API_URL` | yes | Public HTTPS URL of the deployed backend, no trailing slash (for example `https://ai-code-reviewer-api.onrender.com`). You get it from the backend host after step 5. Locally `http://localhost:3001`. | No (public) |
| `VITE_BASE_PATH` | no (default `/`) | The Pages sub-path: `/` + repository name + `/` for a project page (for example `/ai-code-reviewer/`). Use `/` for a user site (`<user>.github.io` repository) or a custom domain at the root. Must equal the repository name exactly (case matters). | No (public) |

In production both come from GitHub **repository variables**, not from a file: Settings > Secrets and variables > Actions > **Variables** tab.

### 3.2 Backend

| Variable | Required | Value and where it comes from | Secret? |
|---|---|---|---|
| `NODE_ENV` | production: yes | `production`. Turns on `Secure` cookies and the `__Host-` cookie name (HTTPS only); also the only mode where `COOKIE_SAMESITE=none` is accepted. Hosts such as Render may set it for you; set it explicitly. | No |
| `PORT` | yes | Port the API listens on. Most hosts inject it; Render uses `10000` by default. | No |
| `FRONTEND_URL` | yes | The **full web app address**. Project page: `https://<user>.github.io/<repo>` (must match `VITE_BASE_PATH`). User site or custom domain at the root: `https://<user>.github.io` or `https://app.example.com`. No query or fragment (the backend refuses to start); a trailing slash is ignored. CORS and CSRF use only the origin part, the path is used only to bring the browser back after GitHub sign-in (see [Sign-in return](#8-github-sign-in-return-and-the-base-path)). | No |
| `COOKIE_SAMESITE` | no (default `lax`) | `lax`, `strict` or `none`. Use `none` in production when the web app and the API are on different sites (the Pages case). `none` is refused unless `NODE_ENV=production`. Any other value stops the start (the message names the variable, never the value). | No |
| `SESSION_TOKEN_FALLBACK` | no (default `off`) | `on` or `off`. `on` lets sign-in and registration return a `sessionToken` for browsers that block the third-party cookie (see [section 7](#7-cross-site-cookies-and-their-limit)). Any other value stops the start (the message names the variable, never the value). | No |
| `DATABASE_URL` | production: yes | PostgreSQL connection string from your database host (Render: the database's **Internal Database URL** when both run on Render, otherwise the External URL with `?sslmode=require`). Blank = in-memory store (data lost on restart). | **Yes** (has a password) |
| `ANTHROPIC_API_KEY` | no | From console.anthropic.com. Blank = stub analyzer. Spends your quota, see the warning above. | **Yes** |
| `ANTHROPIC_MODEL` | no | Model id; blank = the default (`claude-sonnet-5-5`). | No |
| `GITHUB_OAUTH_CLIENT_ID` | no (all three or none) | Client ID of your GitHub OAuth App ([section 4](#4-github-oauth-app-for-production)). | No |
| `GITHUB_OAUTH_CLIENT_SECRET` | no (all three or none) | Client secret of that OAuth App; shown once on GitHub. | **Yes** |
| `GITHUB_OAUTH_REDIRECT_URL` | no (all three or none) | `https://<api-host>/api/auth/github/callback`, identical to the callback URL registered on GitHub. | No |
| `ENABLE_TEST_ROUTE`, `GITHUB_FAKE`, `GITHUB_OAUTH_FAKE`, `TEST_DATABASE_URL` | never in production | Test-only flags for the e2e suite. Do not set them on a deployed backend. | No |

The templates `backend/env.production.example` and `backend/env.development.example` list every variable the code reads (including the optional `ANTHROPIC_MODEL`, blank = default), each with a "secret or not" comment. The test-only flags are deliberately left out.

## 4. GitHub OAuth App for production

Optional ("Continue with GitHub" is hidden when the three settings are blank). A separate OAuth App from your local one:

1. GitHub > **Settings > Developer settings > OAuth Apps > New OAuth App**.
2. **Homepage URL**: your Pages URL (`https://<user>.github.io/<repo>/`, or the custom domain).
3. **Authorization callback URL**: `https://<api-host>/api/auth/github/callback` (the **backend**, not the Pages site).
4. Register, copy the **Client ID**, **Generate a new client secret**, copy it once.
5. Put the three `GITHUB_OAUTH_*` values in the backend host's environment (the secret only there, never in git or in a `VITE_*` variable).
6. The callback URL stays the backend address in every case. For a project page, set `FRONTEND_URL` to `https://<user>.github.io/<repo>` so the browser comes back inside the app ([section 8](#8-github-sign-in-return-and-the-base-path)).

## 5. GitHub repository settings

1. **Settings > Pages > Build and deployment > Source: GitHub Actions.**
2. **Settings > Secrets and variables > Actions > Variables > New repository variable** (variables, **not** secrets):
   - `VITE_API_URL` = the backend URL, no trailing slash.
   - `VITE_BASE_PATH` = `/<repository-name>/` (omit for a root site).
3. **Settings > Actions > General**: Actions enabled, workflow permissions can stay read-only (the workflow requests `pages: write` and `id-token: write` itself).
4. If **Settings > Environments > github-pages** has branch protection, allow `master`.
5. Run it: push to `master`, or **Actions > Deploy frontend to GitHub Pages > Run workflow**. The workflow runs `npm ci`, lint, the unit tests, `vite build` with the two variables, then uploads `frontend/dist` and deploys.

The workflow builds with `npx vite build`, not `npm run build`, because `tsc -b` currently fails on two known `isWellFormed` type errors. Switch the step back once they are fixed.

## 6. Backend and database on Render (step by step)

Written for Render's free tier; every step has an equivalent on Railway, Fly.io or any Node host.

1. **Database.** Render dashboard > New > **PostgreSQL**. Name it, pick a region, create. Copy its **Internal Database URL** (same region as the web service) once it is available.
2. **Web service.** New > **Web Service** > connect this GitHub repository.
   - **Root Directory**: `backend`
   - **Runtime**: Node (20 or newer)
   - **Build Command**: `npm install --include=dev` (the server runs through `tsx`, a dev dependency, so dev dependencies must be installed even though `NODE_ENV=production`)
   - **Start Command**: `npm run db:setup && npx tsx src/index.ts` (applies the idempotent schema, then starts the API). Do not use `npm start` on a host: its script passes Node's `--env-file` for a base env file that does not exist on the server, which fails.
   - **Health Check Path**: `/api/health`
3. **Environment variables** (Environment tab): `NODE_ENV=production`, `FRONTEND_URL=https://<user>.github.io/<repo>` (a root site: `https://<user>.github.io`), `COOKIE_SAMESITE=none`, `DATABASE_URL=<Internal Database URL>`; optionally `ANTHROPIC_API_KEY`, and the three `GITHUB_OAUTH_*`. Do not set `PORT` on Render unless you must; it provides one.
4. Deploy. Open `https://<api-host>/api/health`: it answers `{"status":"ok", ...}`. Copy the service URL: it is your `VITE_API_URL`.
5. **Free-tier behaviour.** A free web service sleeps after idle time; the first request takes tens of seconds. A free database may expire after a period; check Render's current terms and back it up if the data matters.
6. **Proxy note.** The backend does not set `trust proxy`, so behind the host's proxy the per-IP rate limits (registration, GitHub import) see one shared address. Expect those limits to be shared by all visitors until that changes.

The same flow on another host: Node 20+, build with dev dependencies, start with the command above, set the same variables, HTTPS in front, a PostgreSQL URL in `DATABASE_URL`.

## 7. Cross-site cookies and their limit

Pages (`<user>.github.io`) and the API (`<api-host>`) are different sites, so the session cookie is a **third-party cookie**. A `SameSite=lax` cookie is not sent on those requests and sign-in would not work. Therefore production uses:

- `COOKIE_SAMESITE=none` (cookie sent cross-site; requires `Secure`, so HTTPS and `NODE_ENV=production`),
- the existing CSRF protections stay: the `X-CSRF-Protection` header and the Origin check against `FRONTEND_URL`.

**The limit.** Browsers that block third-party cookies (Safari by default, Firefox in strict mode, Chrome in some modes or with the setting on) can still drop the cookie, and sign-in then appears to work and immediately signs you out. That cannot be fixed in code.

**iPhone and Safari.** Symptom: on an iPhone (every iOS browser uses WebKit) you sign in and the app answers "Sign-in was accepted, but your browser did not keep the session..." (a 401 within 5 seconds of a successful sign-in; older builds said "Your session has ended"). Why: with the web app on `github.io` and the API on another host, the session cookie is third-party, and Safari blocks it by default, also with `SameSite=None; Secure`. iOS has no setting that changes this for the user. Fix: turn on the bearer-token fallback below (quick, weaker), or use the same-site setup below (robust) (custom domain, `app.` and `api.` subdomains, `COOKIE_SAMESITE` unset). Verify: open the app on the iPhone in Safari, sign in, reload the page, and you stay signed in. On a Mac, Safari > Develop > Web Inspector > Storage shows the `cr_session` cookie after sign-in. For local development, open the dev server by your computer's LAN IP only if `VITE_API_URL` also uses that IP (on the phone, `localhost` is the phone itself).

**Bearer-token fallback (plan 047, contract 0.18.0).** Off by default. Set `SESSION_TOKEN_FALLBACK=on` on the backend host (Render: Environment tab) and redeploy. Then sign-in and registration return the session id as `sessionToken` to the web app, which checks that the cookie works; if it does not, the app keeps the token in the browser (`localStorage` key `cr.sessionToken`) and sends it as `Authorization: Bearer <token>` on every request. Browsers that keep the cookie never store a token. In the app: sign-in sends `X-Session-Mode: token`, then checks `GET /api/session` with the cookie only; 200 drops the token, 401 stores it; after a reload the stored token restores the session; with the switch off the app behaves as before and shows the "browser did not keep the session" message. The CSRF header and Origin check, the rate limits and the 8-hour idle and 7-day absolute session lifetimes are unchanged; sign-out and any 401 remove the token. To turn it off, set `SESSION_TOKEN_FALLBACK=off` and redeploy (new sign-ins get no token; a token already issued keeps working until the session ends or the user signs out). GitHub sign-in is not covered by the fallback: on Safari it still needs the cookie. Trade-off: a token kept in `localStorage` can be read by script injected through an XSS bug, which an `HttpOnly` cookie prevents; the fallback is therefore opt-in, used only when the cookie fails, and the token is never put in a URL or logged. Prefer the same-site setup below when you can have a custom domain.

**The robust alternative: one custom domain, two subdomains.** Serve the web app on `app.example.com` (Pages custom domain) and the API on `api.example.com` (your host's custom domain). They are the same site, so keep `COOKIE_SAMESITE=lax` (unset), set `FRONTEND_URL=https://app.example.com`, `VITE_BASE_PATH=/`, `VITE_API_URL=https://api.example.com`. This needs a domain and DNS records (Pages: a CNAME to `<user>.github.io` and the custom domain in Settings > Pages; the API host: its custom-domain instructions). It also avoids the third-party cookie limit above.

## 8. GitHub sign-in return and the base path

How the browser comes back after GitHub sign-in (read from `backend/src/service/github-signin.service.ts`, `lib/github-signin-state.ts`, `app.ts`):

1. The web app sends the browser to `GET <API>/api/auth/github?returnTo=<router path>`. `returnTo` is a router-relative path such as `/review/abc` (only sent for pages other than home); it has no base path.
2. GitHub redirects to the callback on the API; the backend sets the session cookie and answers a redirect to `<origin of FRONTEND_URL><path of FRONTEND_URL><returnTo or "/">`. Failures redirect to the same base plus `/login?...` or `/settings?...`.
3. The path of `FRONTEND_URL` (without trailing slashes) is the base path. It comes only from `FRONTEND_URL`, never from the request.

Examples:

| `FRONTEND_URL` | Lands on (default return) | Lands on (`returnTo=/review/abc`) |
|---|---|---|
| `https://<user>.github.io/<repo>` | `https://<user>.github.io/<repo>/` | `https://<user>.github.io/<repo>/review/abc` |
| `https://<user>.github.io` | `https://<user>.github.io/` | `https://<user>.github.io/review/abc` |

**Project page rule.** `FRONTEND_URL` path and `VITE_BASE_PATH` must name the same sub-path: `https://<user>.github.io/<repo>` and `/<repo>/`. If they disagree the browser lands outside the app (GitHub Pages 404 or another site). A user site or a custom domain at the root has no path and `VITE_BASE_PATH=/`.

**What does not change.** CORS and the CSRF Origin check use only the origin of `FRONTEND_URL`. The OAuth App callback URL still points to the backend (`https://<api-host>/api/auth/github/callback`) and `GITHUB_OAUTH_REDIRECT_URL` is the same value.

## 9. First-deploy checklist

- [ ] Decide the shape: project page (`https://<user>.github.io/<repo>`) or root site / custom domain. GitHub sign-in works in all of them.
- [ ] Render (or other host): PostgreSQL created, `DATABASE_URL` copied.
- [ ] Backend web service created with the build and start commands of section 6.
- [ ] Backend variables set: `NODE_ENV=production`, `FRONTEND_URL`, `COOKIE_SAMESITE=none`, `DATABASE_URL`; `ANTHROPIC_API_KEY` only if you accept the cost.
- [ ] `https://<api-host>/api/health` answers ok.
- [ ] Repository variables `VITE_API_URL` and `VITE_BASE_PATH` created (variables, not secrets).
- [ ] `FRONTEND_URL` and `VITE_BASE_PATH` agree, side by side:

  | Shape | `FRONTEND_URL` (backend) | `VITE_BASE_PATH` (repository variable) |
  |---|---|---|
  | Project page | `https://<user>.github.io/<repo>` | `/<repo>/` |
  | User site or custom domain | `https://<user>.github.io` or `https://app.example.com` | `/` |
- [ ] Pages source set to **GitHub Actions**.
- [ ] (Optional) production GitHub OAuth App created, three `GITHUB_OAUTH_*` set on the backend; the callback URL is the backend address.
- [ ] (If GitHub sign-in is on) click "Continue with GitHub" and check you land inside the app, not on a 404.
- [ ] Workflow run is green (Actions tab); the Pages URL loads the app.
- [ ] Reload a deep link (for example `/<repo>/history`): the app loads, no 404.
- [ ] Register a test account, sign out, sign in, run a review.
- [ ] Change the demo account password (`john.doe`) or delete that account.
- [ ] Browser check on a second browser (Safari or Firefox) to see the third-party cookie limit for yourself.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser console: CORS error, request blocked | The origin of `FRONTEND_URL` is not exactly the Pages origin (`http` instead of `https`, wrong host or case) | Set it to `https://<user>.github.io/<repo>` (project page) or `https://<user>.github.io`; redeploy the backend. Only the origin is compared; the path does not matter here. |
| Backend refuses to start: "FRONTEND_URL" message | `FRONTEND_URL` contains a query (`?`) or a fragment (`#`) | Remove it; keep scheme, host and the optional path only. |
| Sign-in answers OK but you are signed out at once; requests are 401 | The cookie is not sent: `COOKIE_SAMESITE` is still `lax`, `NODE_ENV` is not `production`, the API is not HTTPS, or the browser blocks third-party cookies | Set `NODE_ENV=production` and `COOKIE_SAMESITE=none`; check HTTPS; test in another browser; consider the custom domain (section 7). |
| Backend refuses to start: "COOKIE_SAMESITE" message | `none` set without `NODE_ENV=production`, or a value other than lax, strict or none | Fix the variable named in the log line. |
| Workflow fails at "Check the VITE_API_URL variable" | The repository variable `VITE_API_URL` is empty or unset | Create it (Settings > Secrets and variables > Actions > Variables) and re-run the workflow. The value is fixed at build time. |
| Site loads but every API call goes to the Pages origin (`https://<user>.github.io/api/...`) and fails | `VITE_API_URL` was empty at build time (only possible if the check step was removed) | Set the repository variable and re-run the workflow. |
| Blank page; assets 404 (`/assets/...` not found) | `VITE_BASE_PATH` does not match the repository name | Set it to `/<exact-repo-name>/` and re-run the workflow. |
| Reloading a deep link shows GitHub's 404 page | `404.html` missing from the build or the base path is wrong | Check `frontend/dist/404.html` exists in the artifact; fix `VITE_BASE_PATH`. |
| After "Continue with GitHub" you land on a 404 or the wrong page | `FRONTEND_URL` path and `VITE_BASE_PATH` disagree (for example `FRONTEND_URL` has no `/<repo>` on a project page) (section 8) | Set `FRONTEND_URL=https://<user>.github.io/<repo>` and `VITE_BASE_PATH=/<repo>/`; redeploy the backend (and re-run the workflow if you changed the base path). |
| GitHub says "redirect_uri mismatch" | `GITHUB_OAUTH_REDIRECT_URL` differs from the OAuth App callback | Make them identical. |
| First request takes ~30 s, then works | Free host was asleep | Expected on free tiers. |
| Data gone after a restart | `DATABASE_URL` blank, so the in-memory store is used | Set `DATABASE_URL`. |
| Workflow fails at "Build" | A bundle error, or an invalid `VITE_BASE_PATH` (the build stops with a message naming it) | Open the log; run the same command locally in `frontend/`. |
| Workflow fails at "Unit tests" with a timeout | A slow runner; the tests are retried twice already | Re-run the failed job. If the same test fails every time, it is a real failure. |

## 11. Rollback

- **Frontend.** Re-run the workflow on an earlier commit (Actions > select the last good run > **Re-run all jobs**), or revert the commit on `master` and push. To take the site down: Settings > Pages > unpublish, or disable the workflow.
- **Backend.** Render > the service > Events/Deploys > **Rollback** to the previous deploy, or redeploy an earlier commit.
- **Cookie setting.** Set `COOKIE_SAMESITE` back to `lax` (or remove it) and redeploy the backend. Local development is unchanged by any of this.
- **Database.** Plan 042 changes no schema, so no database rollback is needed.

## 12. Rename after generation

Because of the guardrail, these items are for you to fix by hand. Real names start with a dot.

1. **Rename the four template files** so each gets its leading dot:
   - `backend/env.development.example`
   - `backend/env.production.example`
   - `frontend/env.development.example`
   - `frontend/env.production.example`

   (Copy each to its real, git-ignored name when you use it; never commit a real env file.)
2. **Backend base env file name (open item 1 of the backend report).** In `backend/src/utils/constants.ts`, `ENV_FILE.baseName` holds the placeholder `ENV_FILE_BASE_PLACEHOLDER`. Replace it with the real base env file name (a dot followed by `env`). Until then the layering by `NODE_ENV` is inactive.
3. **Backend `package.json` scripts (open item 2).** After item 2, remove Node's `--env-file=...` option from the `dev` and `start` scripts, otherwise the base values reach the process environment and beat the per-environment file. `backend/db/setup.ts` and `backend/tests/db/helper.ts` still call `loadEnvFile()` with the default name; leave them or align them.
4. **Backend example env file (open item 3).** `backend/.env.example` was not updated (a protected-path hook refused the write): add `COOKIE_SAMESITE` and the per-variable "secret or not" comments, copying from the two backend templates.
5. **Frontend example env file (frontend open item).** `frontend/.env.example` was not written (same hook): create it with `VITE_API_URL` and `VITE_BASE_PATH`, each marked public, copying from either frontend template.
6. **Comment in the frontend production template** says "Written without the leading dot; the owner renames it": remove that line after renaming.
7. **This file**: the env file names written without the dot (`env.production`, `env.development`, `env.production.example`, `env.development.example`) in sections 2 and 3 and the naming note at the top; give them the dot.
8. **Other docs**: the same dotless names in `README.md`, `.doc/architecture.md`, `.rule/security-rules.md` (the Environments sections added by plan 042) and in the plan file `.plan/042-2026-11-05-environments-and-github-pages.md`.
9. **Root ignore file: un-ignore the four templates.** The root ignore file ignores the plain dotted env file and every dotted name that starts with it plus a dot, and un-ignores only the plain example file. After the rename in step 1 the four templates (dot + env + `.development.example` or `.production.example`, in `backend/` and `frontend/`) still match the ignore pattern, so git would silently ignore them. A negation rule is already in the root ignore file: a line that is an exclamation mark followed by `*.example`, placed after the existing patterns (later lines win). Check it is still there, then run `git status` after the rename: the four templates must show as untracked or tracked, not missing. If you prefer explicit lines, add an exclamation mark followed by the dotted template name for each of the four (four lines, one per template), after the existing patterns. Real files (without the example suffix) stay ignored.
10. **Backend `package.json` and the ignore file**: confirm the real per-environment env files (the development and production ones, both packages) are git-ignored (`git status` must not list them).
