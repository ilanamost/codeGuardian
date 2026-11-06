# Deploy the Backend to Render with a Neon Database

Status: draft
Owner: Ilana
Last updated: 2026-11-06

## Goal
- The backend (Node/Express API) runs on **Render** as a web service and stores its data in a **Neon** PostgreSQL database.
- The frontend already deployed on GitHub Pages (plan 042) talks to it, and register, sign-in (and optionally GitHub sign-in) and a review all work.
- You follow this plan by hand. Nothing is implemented or tested by the agent.

## Scope
- **Documentation plan only.** No application code, schema or contract change, so it is not `stack:full` work. Branch: `docs/deploy-backend-render-neon` (only needed if you later want the findings of this plan written into `deployment.md`).
- **What exists today** (read 2026-11-06):
  - `deployment.md` section 6 already describes Render **with Render's own PostgreSQL**. This plan replaces the database part with Neon and keeps the rest; the variable table (section 3.2), cookies (section 7) and sign-in return (section 8) of `deployment.md` stay valid.
  - The backend reads `DATABASE_URL` and opens a `pg.Pool` from the connection string alone (`backend/src/store/pg-store.ts`), so the SSL setting must come from the URL (`sslmode=require`). There is no separate SSL setting.
  - `npm run db:setup` (`backend/db/setup.ts`) applies the idempotent `backend/db/schema.sql` to `DATABASE_URL`, and the server stops at start if a table is missing. Migrations 001 to 006 are already folded into the schema, so there is no separate migration step.
  - The server runs through `tsx` (a dev dependency), so the Render build must install dev dependencies. The start command must not use `npm start` (its script passes a `--env-file` for a file that does not exist on the server).
- **Out of scope:** creating accounts for you, Docker, a custom domain, Neon branching for previews, backups beyond Neon's defaults, automating the backend deploy with a workflow, and the frontend deploy (plan 042).

## Assumptions
- You have a GitHub account with this repository pushed, and you can create free Render and Neon accounts.
- The frontend is already on GitHub Pages, or will be deployed after this plan (step 9 closes the loop).
- The web app (`https://<user>.github.io/<repo>`) and the API (`https://<service>.onrender.com`) are different sites, so production uses `COOKIE_SAMESITE=none` (`deployment.md` section 7). Browsers that block third-party cookies can still break sign-in.
- Free tiers: Render's free web service sleeps after about 15 minutes idle (first request takes tens of seconds), and Neon's free compute suspends after idle and wakes on the first query (about a second). Check both providers' current limits before relying on them.
- Registration has no CAPTCHA or email check; a public API is at your own risk (`deployment.md` warning). Leave `ANTHROPIC_API_KEY` blank unless you accept the cost.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Which Neon connection string does the backend use?** Neon offers a *direct* host and a *pooled* host (the host name contains `-pooler`).
   - A. **Direct for `db:setup`, pooled for the running server (recommended).** The schema file takes an advisory lock, which a transaction-pooled connection can break; the server's own pool works fine through the pooler. Costs two values to manage.
   - B. Direct for both. One value, simplest. Free tier connection limits are small, but this app has one small pool.

   **Answer:**

2. **How does the schema get created on Render?**
   - A. **In the start command: `npm run db:setup && npx tsx src/index.ts` (recommended).** Same as `deployment.md` section 6; idempotent, so every deploy is safe. With A and the pooled URL (question 1 A) `db:setup` would also use the pooled URL, so use question 1 B, or run step 4 once by hand and use `npx tsx src/index.ts` as the start command.
   - B. Run the schema once by hand from your computer (step 4) and start the server only. Fewer moving parts on Render, but you must repeat step 4 yourself whenever `schema.sql` changes.

   **Answer:**

3. **Render plan and region.**
   - A. **Free web service, region closest to the Neon project (recommended).** Cheapest; cold starts are expected.
   - B. A paid always-on instance. No cold starts.

   **Answer:**

## Steps
Do them in order. Replace `<...>` placeholders. Never paste a secret into this file, a commit or a chat.

### Part A. Neon database
1. Sign up at neon.tech, **Create project**. Name it (for example `ai-code-reviewer`), choose the Postgres version offered by default, and a region **near the Render region** you will pick (for example both in Frankfurt or both in US East). Keep the default database name and role.
2. On the project dashboard click **Connect**. Copy the connection string. Choose the **direct** string (host without `-pooler`) and, if question 1 is A, also the **pooled** string. Each looks like `postgresql://<role>:<password>@<host>/<db>?sslmode=require`. Keep `sslmode=require` at the end. Store them in your password manager. The password is a secret.
3. (Optional check) from `backend/` on your computer, with the direct string in your shell only, not in a file that git tracks:
   - PowerShell: `$env:DATABASE_URL='<direct string>'; npm run db:setup`
   - Expect the JSON log line saying the setup finished. This creates all tables in Neon, and proves the string works before Render is involved. Closing the shell forgets the variable.
4. (Only for question 2 B, or question 1 A with a manual setup) run the command of step 3 now and again after any change to `backend/db/schema.sql`.

### Part B. Render web service
5. Sign up at render.com with GitHub and authorize access to this repository. **New > Web Service > Build and deploy from a Git repository** > select the repository.
6. Fill the form:
   - **Name**: for example `ai-code-reviewer-api` (it becomes the URL `https://ai-code-reviewer-api.onrender.com`).
   - **Region**: the one chosen for question 3.
   - **Branch**: `master`.
   - **Root Directory**: `backend`.
   - **Runtime**: Node.
   - **Build Command**: `npm install --include=dev`
   - **Start Command**: per question 2: `npm run db:setup && npx tsx src/index.ts` (A) or `npx tsx src/index.ts` (B).
   - **Instance type**: per question 3.
   - **Health Check Path** (Advanced): `/api/health`
7. **Environment variables** (same form, Advanced, or the Environment tab). Use the exact names:

   | Name | Value | Secret? |
   |---|---|---|
   | `NODE_ENV` | `production` | no |
   | `FRONTEND_URL` | `https://<user>.github.io/<repo>` (project page) or `https://<user>.github.io` (root site). No trailing path mismatch: it must agree with the frontend `VITE_BASE_PATH`. | no |
   | `COOKIE_SAMESITE` | `none` | no |
   | `DATABASE_URL` | the Neon string from step 2 (direct, or pooled per question 1) | **yes** |
   | `NODE_VERSION` | `20` or newer (if Render's default is older; the server needs Node 20+) | no |
   | `ANTHROPIC_API_KEY` | leave unset (stub analyzer) or your key | **yes** |
   | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URL` | all three or none (step 10) | secret, secret, no |

   Do not set `PORT` (Render provides it). Never set the test-only flags (`ENABLE_TEST_ROUTE`, `GITHUB_FAKE`, `GITHUB_OAUTH_FAKE`, `TEST_DATABASE_URL`).
8. Click **Create Web Service** and wait for the first deploy. In the logs look for the `db:setup` finished line (question 2 A) and the server listening line. Then open `https://<service>.onrender.com/api/health`: it should answer `{"status":"ok", ...}` (the first request may take about 30 seconds).

### Part C. Connect everything
9. **Frontend.** In the GitHub repository, Settings > Secrets and variables > Actions > **Variables**: set `VITE_API_URL=https://<service>.onrender.com` (no trailing slash) and `VITE_BASE_PATH=/<repo>/` (or `/` for a root site). Re-run **Actions > Deploy frontend to GitHub Pages**. The URL is baked in at build time, so any change needs a new run.
10. **(Optional) GitHub sign-in.** GitHub > Settings > Developer settings > OAuth Apps > New OAuth App. Homepage URL: the Pages address. Callback URL: `https://<service>.onrender.com/api/auth/github/callback`. Copy the Client ID, generate a secret (shown once), then add the three `GITHUB_OAUTH_*` variables on Render (the redirect URL equals the callback URL above) and let Render redeploy.
11. **Smoke test in a browser**: open the Pages site; register an account; sign out and in; run a review; reload a deep link (for example `/<repo>/history`); reload the page and check the data is still there. In the Neon dashboard, **Tables** (or the SQL Editor: `select count(*) from account;`) shows the new account. Check the demo account password (`john.doe`) if it exists: change it or delete the account.

## Validation
Each item is a command or a visible result you can check yourself.
- Step 3: `npm run db:setup` against the Neon direct string prints the finished line and exits with code 0 (`$LASTEXITCODE` is `0` in PowerShell).
- Neon dashboard > Tables lists the application tables from `backend/db/schema.sql` (see `.doc/data-model.md` for the list).
- `curl https://<service>.onrender.com/api/health` returns HTTP 200 and `"status":"ok"`.
- Render logs show no `ConfigError` line (a start failure names the setting, never the value).
- Browser DevTools > Network on the Pages site: API calls go to `https://<service>.onrender.com/api/...`, return 2xx, and the session cookie is `Secure; HttpOnly; SameSite=None`.
- Register, sign out, sign in, run a review all succeed; after clicking **Manual Deploy > Restart** on Render, the account and review are still there (proves the data is in Neon, not in memory).
- `git status` shows no new tracked file with a connection string or key, and the Render environment variables are the only place the secrets live.
- (If used) "Continue with GitHub" returns you inside the app, not on a 404.

## Risks
- **Cold starts** (Render free sleeps, Neon free suspends): the first request after idle is slow and a request may time out in the browser. Mitigation: retry; paid instance (question 3 B).
- **Wrong connection string** (pooled used for `db:setup`, missing `sslmode=require`): setup or start fails with a database error. Mitigation: question 1, step 3 check before Render.
- **Cross-site cookies blocked** by Safari or strict Firefox: sign-in appears to work and then signs you out. Mitigation: `deployment.md` section 7 (one custom domain with two subdomains).
- **`FRONTEND_URL` and `VITE_BASE_PATH` disagree**: CORS errors or a 404 after GitHub sign-in. Mitigation: the side-by-side table in `deployment.md` section 9.
- **Secret exposure**: a connection string pasted in a commit or chat. Mitigation: only the Render environment and your password manager; if one leaks, reset the Neon role password (Neon dashboard > Roles) and update Render.
- **Public API cost and abuse**: no CAPTCHA, shared per-IP rate limits behind Render's proxy (`deployment.md` section 6, note 6). Mitigation: leave the Anthropic key blank.
- **Free-tier limits change.** Mitigation: read both providers' pricing pages on the day.

## Rollout Order
1. Open Questions answered, plan approved (status to `active`).
2. Part A (Neon), including the step 3 check.
3. Part B (Render), health check green.
4. Part C steps 9 and 11 (frontend and smoke test); step 10 later if wanted.

## Rollback
- **Bad deploy:** Render > the service > Events > **Rollback** to the previous deploy, or redeploy an earlier commit.
- **Take the API down:** Render > Settings > **Suspend Service** (the frontend then shows API errors). Delete the service to stop it for good.
- **Database:** Neon keeps a short history window on the free tier (Backup & Restore); otherwise `schema.sql` recreates the tables empty. To start over, delete the Neon project (all data is lost) and repeat Part A.
- **Secrets leaked:** reset the Neon role password and the GitHub OAuth client secret, update Render, redeploy.
- **Frontend:** set `VITE_API_URL` back and re-run the workflow, or follow `deployment.md` section 11.
