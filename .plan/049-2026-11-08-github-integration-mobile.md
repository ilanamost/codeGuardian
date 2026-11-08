# Plan 049: GitHub Integration on mobile — GitHub token and proxy address

Status: done (approved 2026-11-08; Q1 to Q5 = A, the recommended answers; QA passed items 1 to 8 and 10, item 9 as the audit-only check, item 11 is the owner's iPhone check)
Owner: orchestrator (backend agent implements; frontend agent runs a phone check)
Last updated: 2026-11-08
Branch: feat/github-integration-mobile
Backlog task: "stack:full. github integration on mobile doesn't work." Merged with the second pending item (the GitHub unauthenticated rate limit and `trust proxy`): both describe the same failure.
Figma: none
Related: plan 023 (link import), plan 030 (real repository selection), plan 040 (GitHub sign-in), plan 042 (environments), plan 045 (Render and Neon), plan 047 and 048 (session token, iPhone)

## Goal
- The GitHub Integration wizard and the "Paste a GitHub link" import work on a phone, and stop showing "GitHub's limit of requests without sign-in is used up. Try again in an hour."
- The backend sends a GitHub token from an environment variable on every GitHub API call when one is set (5000 requests an hour instead of 60), never stores, logs or returns it, and keeps working without it.
- The per-address limits (login, register, GitHub sign-in) see the real client address behind the host's proxy.

## Scope
`stack:full`: backend, API contract, docs, and a frontend phone check.

In scope:
- Backend: a new optional setting `GITHUB_API_TOKEN` read at start-up; the shared GitHub client (`backend/src/lib/github-fetch.ts`, which already accepts an `authorization` value that is undefined today) sends `Authorization: Bearer <token>`; a new optional setting `TRUST_PROXY` (number of proxy hops) applied to the Express app.
- Contract bump to 0.20.0: no new route or field; the description of the GitHub rate-limit 429 and of the shared limit changes (documentation).
- Tests, `deployment.md` (variable table, Render step, checklist, troubleshooting row), `backend/.env.example`, `.rule/security-rules.md`, `.doc/architecture.md`, `.doc/summary-backend.md`, `.doc/product-definition.md` (the 60-requests-an-hour sentences).
- Frontend: a phone-viewport walkthrough of the wizard and the link import as a check (see Q4). No frontend source change is planned.

Out of scope: GitHub OAuth sign-in (plan 040, its own client id and secret, unchanged); private repositories and any user-supplied token; caching GitHub answers; GitHub's secondary limits; a new wizard design. Per Q4 (A), a layout defect found by the phone check becomes a new backlog item, not part of this plan.

## Findings from the code
- The failure in the report is GitHub's unauthenticated limit, 60 requests an hour per server address, shared by every visitor. `createGithubClient` in `backend/src/lib/github-fetch.ts` maps a 403 with `x-ratelimit-remaining: 0` (or `retry-after`, or a 429) to `rate_limited` with the reset time; the wizard and the link import share one client (`backend/src/app.ts:155`).
- The client is built as `createGithubClient({ fetch: globalThis.fetch })` with no token, and the header block in `request()` already adds `Authorization` when `authorization` is set. The change is wiring, config and tests, not a new client.
- SSRF rules stay: every call goes to the constant `https://api.github.com` origin, redirects are not followed, no URL from a response is read, so the token can only reach GitHub's API.
- `backend/src/config.ts` follows one pattern for optional settings (`CONFIG_KEY`, a parser that never echoes a value, an `AppConfig` field, `AppRuntimeConfig` for tests). The token follows `ANTHROPIC_API_KEY`: trimmed, blank means not set, never logged, returned or put in an error.
- `createApp` never calls `app.set('trust proxy', ...)`, so behind Render's proxy `req.ip` is the proxy's address and the per-address limiters (`createLoginLimiter`, `githubSignInLimiter`) share one bucket for all clients.
- GitHub's 5000-an-hour limit is per token. A message that says "without sign-in" is slightly wrong once a token is in use and is exhausted; the text stays (Q5).

## Assumptions
- Production is GitHub Pages (web) plus Render (API) with `NODE_ENV=production`, `COOKIE_SAMESITE=none`, `SESSION_TOKEN_FALLBACK=on`; Render's proxy adds one hop.
- The owner creates the token on GitHub (a fine-grained personal access token with no repository permissions, which reads public data only, or a classic token with no scopes) and sets it in the Render environment. The token is never put in git, a `VITE_*` variable or the frontend.
- Single backend instance, as before.
- Code style: no trailing semicolons. Terms: `GITHUB_API_TOKEN` is a setting name, not a domain term; no glossary change expected.

## Open Questions
Answer inline under each. Recommended answer first.

**Q1. Name of the environment variable.**
- (A, recommended) `GITHUB_API_TOKEN`: it cannot be mistaken for the `GITHUB_TOKEN` that GitHub Actions injects, or for the `GITHUB_OAUTH_*` sign-in settings.
- (B) `GITHUB_TOKEN`.
Answer: (not answered yet)

**Q2. A token that GitHub refuses (revoked, expired, mistyped: a 401).**
- (A, recommended) Retry that call once without the token, log one warning line that names the setting and never the value, and keep working at the 60-an-hour limit. Rationale: "keeps working without it".
- (B) Fail the call with the existing generic upstream error (502) so the problem is visible.
Answer: (not answered yet)

**Q3. How `trust proxy` is set.**
- (A, recommended) A new optional `TRUST_PROXY` setting, a whole number of proxy hops; blank or `0` means off (today's behaviour), `1` on Render. An invalid value stops the start with a message that names the setting, not the value.
- (B) Always `1` when `NODE_ENV=production`, no setting. Simpler, but wrong behind two proxies and unsafe if the API is reached directly (a client could spoof its address).
Answer: (not answered yet)

**Q4. The phone check in the frontend.**
- (A, recommended) Run the wizard and the link import at 390x844 and 320x568 with touch against the test backend; list any layout defect in the report and add it to the backlog. No frontend source change in this plan.
- (B) Fix the layout defects found here too (touch targets, bottom navigation overlap). This widens the plan and needs a re-approval of the frontend scope.
- (C) Skip the phone check; the server fix is the whole task.
Answer: (not answered yet)

**Q5. Wording when the limit is hit with a token.**
- (A, recommended) Keep the message as it is; the 5000-an-hour limit is rarely reached, and `details.resetAt` stays correct.
- (B) Use a second message when a token is configured ("GitHub's hourly request limit is used up") on the backend and the frontend.
Answer: (not answered yet)

## Steps
1. **Contract and docs first** (`.orchestrate/api-contract.yaml`, version 0.20.0): the 429 description of `POST /api/github/import`, `POST /api/github/connect` and the repository routes (token raises the limit; the answer is unchanged), the info text; `deployment.md` variable table rows for `GITHUB_API_TOKEN` (secret: yes) and `TRUST_PROXY`.
2. **Backend** (backend agent), failing tests first:
   - Config: unset, blank and whitespace token mean none; a token is trimmed; it never appears in a `ConfigError`, in `console` output, in `GET /api/health` or in any response; `TRUST_PROXY` accepts blank, `0`, `1`, `2`, rejects `-1`, `abc`, `1.5`, `true` with a message that names the setting only.
   - Client: with a token the injected fake `fetch` sees `Authorization: Bearer <token>` on `getFile`, `getPull`, `listPullFile`, `getUser`, `listUserRepo`, `getTree`; without one, no `Authorization` header; the header goes only to the `api.github.com` origin; a 3xx is still a 502 and the token is never sent to a redirect target.
   - Q2 (A): a 401 with a token retries once without it; a second 401 or any other failure is the existing error; one warning line, no value; the retry shares the call and total timeouts of the request.
   - Rate limit: a 403 with `x-ratelimit-remaining: 0` is still `rate_limited` with `resetAt`.
   - Logs and errors: no log line, error body or response contains the token (a canary token string is searched for across a full wizard flow).
   - `trust proxy`: with `TRUST_PROXY=1`, two requests with different `X-Forwarded-For` values fall in separate limiter buckets; with it off, the header is ignored (no spoofing).
   - Wiring: `index.ts` passes the token from `AppConfig` to `createGithubClient`; the fake GitHub (`GITHUB_FAKE`) ignores it.
3. **Docs**: `deployment.md` section 3 (table), section 6 step 3 (Render variables), section 9 checklist, section 10 troubleshooting row for the "limit is used up" message ("set `GITHUB_API_TOKEN`; create a token with no scopes"), `backend/.env.example`, `.rule/security-rules.md` (a third-party token: where it is read, where it goes, never stored or logged), `.doc/architecture.md`, `.doc/summary-backend.md`, `.doc/product-definition.md`.
4. **Frontend phone check** (frontend agent, per Q4 A): a Playwright run with `devices['iPhone 13']` and a 320x568 viewport over the wizard (connect by user name, search, pick a repository, Next, tick files, Import) and the link import, with the session cookie stripped and `cr.sessionToken` set; results in `.orchestrate/frontend-agent-report.md`. A new spec is kept only if it passes; a unit test that imports `frontend/tests/utils/backendHarness.ts` goes in the `--exclude` list of `.github/workflows/deploy-frontend.yml`.
5. **Backlog**: on completion, check off the first item and mark the second as merged into this plan.
6. Run `cd backend && npm test`, `cd frontend && npm test`, `npm run typecheck` in both (2 known `String.isWellFormed` errors in the frontend), `npm run lint`, and the new phone spec.

## Validation
1. Config: `GITHUB_API_TOKEN` unset or blank starts the server with no token; `TRUST_PROXY` invalid stops the start with a message that names the setting and does not contain the value (backend unit tests).
2. With a token set, every GitHub call made by the link import and by the wizard (connect, repository list, file list, file import) carries `Authorization: Bearer <token>` and goes to `https://api.github.com` only (backend tests over a fake `fetch`).
3. Without a token, no `Authorization` header is sent and the behaviour is the same as before this plan (backend tests, plan 023 and 030 suites unchanged).
4. The token is absent from: `GET /api/health`, every response body and header of the GitHub routes, error bodies, security log lines, console output, and the config error text (canary-string test over a full flow).
5. A GitHub 401 with a token: the call is retried once without it and succeeds; one warning line without the value is logged (Q2 A).
6. A GitHub 403 with `x-ratelimit-remaining: 0` still returns 429 `rate_limited` with `details.resetAt`.
7. `TRUST_PROXY=1`: requests with different `X-Forwarded-For` values use separate rate-limit buckets; with `TRUST_PROXY` unset, the header is ignored.
8. Contract 0.20.0 is valid; the contract test (every endpoint has a test) passes.
9. Frontend phone check (Q4 A): at 390x844 and 320x568 with touch and the cookie stripped, the wizard and the link import reach the editor against the test backend; any defect found is listed in the report. The existing frontend unit and Playwright suites show no new failure.
10. `cd backend && npm test` and `cd frontend && npm test` pass; typecheck shows only the 2 known frontend errors; lint is clean in both.
11. Manual (owner): set `GITHUB_API_TOKEN` and `TRUST_PROXY=1` on Render and redeploy; on the iPhone 13, connect by user name, pick a repository and a file, import it, and import a link; no "limit is used up" message appears.

## Risks
- A token on a public server is a secret: it is read only from the environment, sent only to the fixed GitHub API origin, and checked absent from logs and responses by test. If it leaks, revoke it on GitHub.
- All visitors still share one token's 5000 requests an hour; a popular deployment can still hit it (the existing 429 message and `resetAt` apply).
- A wrong `TRUST_PROXY` value is unsafe: too high lets a client spoof its address and dodge the limits; too low keeps one shared bucket. Default is off, and `deployment.md` states `1` for Render.
- The 401 retry (Q2 A) can hide a bad token behind the 60-an-hour limit; the warning line is the signal, and the troubleshooting row names it.
- Playwright's WebKit emulation is not a real iPhone; Validation 11 stays manual.
- Nothing is committed without your approval.

## Rollout Order
1. Contract and docs. 2. Backend with the token and `TRUST_PROXY` unset (no behaviour change). 3. Frontend phone check. 4. Deploy the backend. 5. Owner creates the token, sets `GITHUB_API_TOKEN` and `TRUST_PROXY=1` on Render, redeploys. 6. Owner tests on the iPhone.

## Rollback
Remove `GITHUB_API_TOKEN` and `TRUST_PROXY` from the environment and redeploy: the backend behaves as before (no token, no proxy trust). Full rollback: revert the branch `feat/github-integration-mobile`; no migration, no schema change, no frontend source change.
