# GitHub Sign-In (OAuth)

Status: done
Owner: Ilana
Last updated: 2026-11-02

## Goal
A user can register and sign in with their GitHub account ("Continue with GitHub") as an option next to the user name and password form, and can link GitHub sign-in to an existing account from Settings. The OAuth flow runs on the backend (authorization code with PKCE and a single-use `state`), ends in the same server-side session cookie as password sign-in, and stores no GitHub token. Everything else (per-account data, one org per account, session expiry, encryption setting) keeps working unchanged.

## Scope
- Backlog item: "stack:full. Add an option for authentication with GitHub OAuth". **`stack:full`**: `backend/` and `frontend/` both change. No Figma. Branch: `feat/github-oauth-authentication` (created from `feat/llm-review-process`, which holds plan 039).
- **File naming:** the guardrail hook `.claude/hooks/require-approval-auth-files.js` blocks agent writes to any path containing `auth`, an env file name or `middleware/rate-limit`. New files in this plan are therefore named `github-signin*` (never `auth*` or `oauth*`). If an existing file with such a name needs an edit, the agent reports it instead of working around the hook.
- **What the code does today** (read 2026-11-02):
  - Sign-in is `POST /api/session` (user name and password, scrypt hash, rate limits), session restore is `GET /api/session`, sign-out is `DELETE /api/session` (`backend/src/route/session.route.ts`). `session.service.ts` `start()` discards any previous session id (no fixation) and the id goes in an `HttpOnly` cookie (`__Host-` and `Secure` in production, `lib/session.ts`).
  - Registration is `/register` (user name, email, password rules, `account.service.ts`); each account owns one org. `account.password_hash` is `NOT NULL` in `backend/db/schema.sql`.
  - The GitHub Integration wizard connects by typing a GitHub user name (public repositories, plan 030). `lib/github-fetch.ts` already accepts an optional `authorization` value, undefined today.
  - `.doc/product-definition.md` lists GitHub OAuth as out of scope (v1) and "defer until required for a stated goal"; this plan is that stated goal and moves it to Current.
  - `API_ENCRYPTION=on` wraps `/api/*` bodies in envelopes (plan 033); a redirect has no body, so the OAuth routes must be exempt (to verify in `app.ts`).
- **In scope:**
  1. **GitHub OAuth App settings** (`backend/src/config.ts`, `CONFIG_KEY`): `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URL` (the backend callback URL), all optional. Unset or blank means "not configured": the routes answer 404 and the button is hidden. Setting only some of the three stops the server with a message naming the settings, never a value. The secret is never logged, returned or put in an error.
  2. **OAuth client** `backend/src/lib/github-signin-client.ts` behind a narrow interface (`exchangeCode(code, verifier) -> accessToken`, `fetchProfile(accessToken) -> { id, login, name, email?, emailVerified }`), using the existing fetch discipline (timeouts, no redirects followed, size cap). The access token lives in memory for one callback request and is discarded; it is never stored or logged. Scopes: `read:user user:email` only (Open Question 1).
  3. **Routes** (new `backend/src/route/github-signin.route.ts`, mounted under `/api/auth/github`):
     - `GET /api/auth/github` (public): creates `state` and a PKCE verifier, stores them in a short-lived (10 min) single-use `HttpOnly` cookie bound to this browser, answers `302` to GitHub's authorize URL. Optional `returnTo` accepts only a relative app path (validated, no open redirect).
     - `GET /api/auth/github/callback` (public): checks `state` (constant-time, single use, then deleted), exchanges the code, reads the GitHub profile, signs in or creates or links per Open Questions 2 to 4, starts a session through `sessionService.start()` and answers `302` to the frontend (`FRONTEND_URL` + `returnTo`). Every failure (denied, bad state, GitHub error, unverified email, conflict) answers `302` to `/login?auth_error=<code>` with a fixed code from a closed list, never a message from GitHub.
     - `POST /api/auth/github/link` and `DELETE /api/auth/github/link` (signed in; Open Question 2): link the current account to the GitHub identity from a fresh authorize round trip, or remove the link (refused when the account would be left with no way to sign in).
     - Per-IP rate limit on start and callback (same limiter style as sign-in); `security-log` lines `auth.github.start`, `auth.github.callback` with outcome and reason code, never the code, token, state, email or profile body.
  4. **Data model** (migration `backend/db/migration/006-github-identity.sql`, mirrored idempotently in `backend/db/schema.sql`, `database-schema` skill): new table `account_identity (provider text, provider_user_id text, org_id text REFERENCES org(id), login text, created_at, PRIMARY KEY (provider, provider_user_id))` with an index on `org_id`; `account.password_hash` becomes nullable (Open Question 4). `MemoryStore` and `PgStore` implement `findIdentity`, `createIdentity`, `deleteIdentity` and the account-with-identity creation in one transaction. The identity key is GitHub's numeric user id, never the login (logins can be renamed and reused).
  5. **Account creation from GitHub** (Open Question 3): user name from the GitHub login passed through the existing user name rules, with a numeric suffix on collision; full name from the profile name or login; email from the verified primary email; no password.
  6. **Frontend** (`frontend/`): a "Continue with GitHub" button (`lucide-react` icon, Tailwind utilities, no new CSS file) on `LoginPage.tsx` and `RegisterPage.tsx`, a plain navigation to `/api/auth/github` (not `fetch`), shown only when `GET /api/health` reports `githubOAuth: true`; `/login` reads `auth_error` and shows a specific message per code (constants in `frontend/src/lib/session.constants.ts`) and removes the parameter from the URL; Settings > Account shows "GitHub sign-in: connected as @login" with Link / Unlink (Open Question 2); the Security tab for a passwordless account says it signs in with GitHub and hides the password change form. After the redirect the existing session restore (`GET /api/session`) signs the user in.
  7. **Contract** `.orchestrate/api-contract.yaml` 0.14.0 -> **0.15.0** (additive): the four routes (redirect responses documented), `GET /api/health.githubOAuth`, `Account.signInMethod` (`password`, `github`, `both`) and `Account.githubLogin`, the closed `auth_error` code list.
  8. **Docs:** `.doc/architecture.md` (sign-in flow, routes, data model, External Dependencies, Operational Concerns, changelog line), `.doc/product-definition.md` (OAuth moves from Out of scope to Current; private repositories stay out), `.doc/glossary.md` (`github identity`, `oauth state`, `signInMethod`), `.rule/database-rules.md` if it lists tables, `README.md` (how to create the GitHub OAuth App and fill the settings; the human step in Assumptions).
- **Out of scope:**
  - Private repositories, the `repo` scope, storing or refreshing a GitHub token, and using the sign-in in the wizard beyond Open Question 5 (the wizard stays public-repositories-only).
  - Other providers (Google and so on), SSO, teams, password reset by email, email verification, setting a password on a GitHub-only account.
  - Deploying publicly (the app is still local-only; the backlog deployment item is separate).

## Assumptions
- The human creates a GitHub OAuth App (Settings > Developer settings > OAuth Apps) with the callback URL equal to `GITHUB_OAUTH_REDIRECT_URL` and puts the three values in the backend environment file and its example file. The agents cannot read or edit any environment file (the hooks block it), so the backend agent works through `loadConfig(environment)` and the human adds the values.
- Frontend and backend run on different local ports of `localhost`; cookies are not port-scoped, so the session cookie set at the callback is sent by the frontend's later `fetch` calls exactly as it is after a password sign-in. If the installed cookie settings disagree, the backend agent follows the code, not this sentence.
- GitHub's user emails endpoint returns the verified primary email with the `user:email` scope; an account with no verified email cannot sign in with GitHub (code `email_unverified`).
- One backend instance (product constraint), so the in-memory rate limit is enough; the `state` lives in the browser's cookie, not server memory.
- E2E and unit tests never reach `github.com`: the client interface has a fake, switched on by the same kind of test-only flag as `GITHUB_FAKE` (never in the example environment file).

## Open Questions
1. **What does GitHub OAuth give the app?**
   - A) **Recommended:** sign-in only (scopes `read:user user:email`), no token stored, public repositories as today. Smallest security surface; private repositories become a later plan.
   - B) Sign-in plus the `repo` scope: private repositories in the wizard. Needs an encrypted token per account at rest, refresh and revoke handling, and a much bigger plan.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
2. **Linking to an existing password account.** An unverified-email match must never grant access to someone else's account.
   - A) **Recommended:** never auto-link by email. A first GitHub sign-in creates a new account; if the verified GitHub email already belongs to a password account, refuse with `email_in_use` ("sign in with your password, then link GitHub in Settings > Account"). Linking and unlinking live in Settings > Account (needs the current session).
   - B) Auto-link when GitHub reports the email as verified (convenient, but trusts GitHub's email verification for takeover protection).
   - C) No linking at all: GitHub accounts are always separate from password accounts.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
3. **First GitHub sign-in with no account.**
   - A) **Recommended:** create the account automatically (user name from the GitHub login with a suffix on collision, verified email, no password) and open the Dashboard.
   - B) Send the user to a short "finish registration" form to choose the user name first.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
4. **Password for GitHub-only accounts.**
   - A) **Recommended:** `password_hash` becomes nullable; a GitHub-only account has no password, cannot use `POST /api/session`, and the Security tab explains this. Setting a password later is a follow-up.
   - B) Generate a random unusable hash instead of a nullable column (no schema change on `account`, but a hidden value that looks like a password).
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
5. **Wizard connection for GitHub-signed-in users.**
   - A) **Recommended:** none in this plan; the wizard keeps connecting by typing a user name. Keeps the change focused.
   - B) Prefill the wizard's connection with the account's GitHub login (still public repositories only).
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
6. **When OAuth is not configured.**
   - A) **Recommended:** the button is hidden, the routes answer 404, and `GET /api/health` reports `githubOAuth: false`, so local development and every existing test run without an OAuth App.
   - B) The button is shown but disabled with a "not configured" hint.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)

## Steps
1. **Contract** (backend agent writes it first): bump `.orchestrate/api-contract.yaml` to 0.15.0 per Scope 7 and the answers to Open Questions 2, 4 and 6.
2. **Config and client:** the three settings in `config.ts` / `CONFIG_KEY` with the all-or-none rule; `lib/github-signin-client.ts` (interface, real implementation, in-memory fake); PKCE and `state` helpers in `lib/github-signin-state.ts` (random, constant-time compare, short-lived cookie).
3. **Data layer:** migration `006-github-identity.sql` + `schema.sql`; nullable `password_hash`; identity methods in `store.ts`, `memory-store.ts`, `pg-store.ts`, `pg-schema.ts`; every place that reads `password_hash` handles `null` (password check, password change).
4. **Service and routes:** `github-signin.service.ts` (sign in, create, link, unlink, per the answers); `github-signin.route.ts`; mount in `app.ts` outside the session guard for start and callback and inside it for link and unlink; exempt the redirect routes from the encryption envelope; health field; `Account.signInMethod` and `githubLogin` in the DTO and account service.
5. **Frontend:** health flag in the session or config slice; the GitHub button on Login and Register; `auth_error` messages and cleanup; Settings > Account link / unlink; Security tab for passwordless accounts; services and store changes follow the existing layers (`frontend/src/services/session.service.ts`, `frontend/src/store/session.slice.ts`).
6. **Tests** (see Validation): backend unit and route tests with the fake client, DB test for the new table, Playwright flow against the fake.
7. **Docs and README:** Scope 8, including the step-by-step GitHub OAuth App setup.
8. **Linear tickets** (Frontend, Backend, QA) and the agents' reports, per the dev loop.

## Validation
QA checklist; each item is provable by a test or command.
- `cd backend && npm test`, `npm run test:db`, `npm run test:encrypted` pass; `cd frontend && npm test` passes; Playwright covers the sign-in flow; `npm run lint` and `npx tsc --noEmit` are clean in both apps (the two known `String.isWellFormed` typecheck errors are the only allowed ones).
- Config: all three settings blank -> feature off, 404 on all four routes, `/api/health` `githubOAuth: false`; one or two set -> startup stops and the message names the settings but contains no value (canary secret asserted absent).
- Start route: `302` to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `state`, `code_challenge` (S256) and the two scopes only; sets the single-use state cookie (`HttpOnly`, `SameSite=Lax`, 10 min); `returnTo` with an absolute URL, `//host` or backslash is ignored.
- Callback: missing, wrong, reused or expired `state` -> `/login?auth_error=invalid_state`, no session; user denies -> `access_denied`; GitHub error or timeout -> `provider_error`; no verified email -> `email_unverified`; verified email of a password account -> `email_in_use` and no session (Open Question 2 A); success for a new user creates the account and org, sets the session cookie, redirects to the frontend; success for a returning user signs in to the same org (identity found by GitHub id, even after a login rename).
- Session safety: a pre-existing session id is discarded on callback (no fixation); the cookie flags equal the password sign-in's; the GitHub access token, code, state and secret appear in no response, log line or stored row (canaries asserted absent in captured logs and a DB dump).
- Rate limit: more than the limit per IP on start / callback -> 429, same style as sign-in.
- Link / unlink: link needs a session; linking a GitHub id already used by another account is refused; unlinking the only sign-in method is refused; the password sign-in keeps working after link.
- GitHub-only account: `POST /api/session` for it answers the same generic 401 as a wrong password; the Security tab shows the GitHub note and no password form; password change is refused.
- Encryption: with `API_ENCRYPTION=on` the redirect routes still work and the other routes are unchanged.
- Existing behavior: the password sign-in, registration, per-account data isolation, session restore and sign-out suites pass unchanged.
- UI: the button is absent when `githubOAuth` is false, present on `/login` and `/register` when true, keyboard reachable with a visible focus ring, readable at 375 px width and in both themes; each `auth_error` code shows its own message and the parameter is removed from the URL; no new CSS file and no inline styles.
- Migration `006` runs twice without error and leaves existing accounts untouched (`npm run db:setup` twice).

## Risks
- **Account takeover through email matching.** Mitigated by Open Question 2 A: no auto-link, verified email required, identity keyed by GitHub's numeric id.
- **Open redirect or login CSRF.** Mitigated by the single-use `state` bound to a browser cookie, PKCE, a fixed redirect target and a validated relative `returnTo`.
- **Nullable password hash breaks a password path.** Mitigation: step 3 lists every reader of `password_hash`; a test signs in with a GitHub-only account through the password route.
- **Cookie not sent after the redirect** because of the local dev ports or `SameSite`. Mitigation: an e2e test of the full redirect round trip on the dev ports; `Lax` is correct for a top-level GET redirect.
- **GitHub outage or rate limit** during the callback. Mitigation: timeouts, the closed `provider_error` code, password sign-in unaffected.
- **Secret handling.** The client secret exists only in the environment file and process memory; a config test and a log canary guard it. Rotating it means editing that file and restarting.
- **Existing files with `auth` in the path** (if any need edits) are blocked for agents by the hook; the agent must report them instead of working around the hook.
- **Local-only constraint** stays: the app has no CAPTCHA or email check, so it should not be deployed publicly as is.

## Rollout Order
1. Contract and docs skeleton. 2. Config, client and fake. 3. Migration and store. 4. Service and routes with backend tests. 5. Frontend. 6. Playwright flow. 7. QA, then the human creates the GitHub OAuth App and runs one real sign-in by hand (the only real GitHub call).

## Rollback
Everything is additive and gated by configuration: blanking the three settings turns the feature off (routes 404, button hidden) without a code change. To revert the code, revert the branch; migration `006` only adds a table and relaxes `password_hash` to nullable, so earlier code still runs on the new database as long as no GitHub-only account exists. If one exists, delete its `account_identity` and `account` rows (or give it a password hash) before rolling back.
