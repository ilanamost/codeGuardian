# Plan 047: iPhone sign-in: no zoom on focus, a clear session message and a bearer-token session fallback

Status: active (approved 2026-11-07; Q1 = B same branch, Q2 = A localStorage, Q3 = A not now, Q4 = A default off). Waiting for the owner's real-iPhone test.
Owner: orchestrator (backend and frontend agents implement)
Last updated: 2026-11-07
Branch: feat/iphone-login-session-ended-and-zoom (one plan, one PR; nothing committed yet)
Backlog task: "When trying to connect from a real iphone 13 device with user name or password, I'm getting a message: your session has ended, and I cannot sign in. Also, when I fill in the login credentials, the app zooms in and the page contents become too close to the edges of the device." Part B is `stack:full`.
Figma: none
Related: plan 042 (`COOKIE_SAMESITE`), plan 028 (sessions)

History: this plan first covered only Part A (frontend-only). The same-site custom domain it documented is not possible for this deployment, so Part B (token fallback) was added and the two parts were merged into this one plan (the former separate plan was deleted at the owner's request).

## Part A: zoom and clear message (frontend, implemented)
Findings: the sign-in inputs used `text-sm` (14px) and iOS Safari zooms into any focused input under 16px, which also pushes the page against the screen edges. The "Your session has ended" text after a successful sign-in is what a browser that drops the `Set-Cookie` of the sign-in response produces (the next request has no cookie and gets 401); the web app (GitHub Pages) and the API (Render) are different sites, and Safari blocks third-party cookies.
Done:
- Every text, email, password and search input, select and textarea uses `text-base sm:text-sm` (16px on phones, 14px from 640px up). Checkbox, radio and file inputs unchanged. No `maximum-scale` or `user-scalable` (accessibility).
- When a 401 ends the session within 5 s of `signIn.fulfilled`, the toast says the browser did not keep the session (`SESSION_ERROR_MESSAGE.cookieBlocked`, `COOKIE_BLOCKED_WINDOW_MS`); a Help entry under "Can't access my account"; `deployment.md` section 7 iPhone and Safari paragraph.
Part A validation (all passed in QA except the manual item): inputs >= 16px on `/login` and `/register` (WebKit iPhone 13 spec); side margin >= 16px; no horizontal scroll; desktop inputs 14px from 640px; the `cookieBlocked` toast shows once after a 401 right after sign-in and `sessionEnded` after the window; a wrong password stays inline. Manual only: no zoom on focus on a real iPhone 13.

## Part B: bearer-token fallback (stack:full)

## Goal
- A user on Safari/iPhone, where the web app (GitHub Pages) and the API (Render) are different sites, can sign in with user name and password and stay signed in across reloads, without a shared domain.
- Browsers that keep the cookie keep using the cookie exactly as today. The fallback is used only when the cookie did not stick.

## Scope
`stack:full`. Backend, frontend, API contract, docs.

In scope:
- Backend: an optional deployment switch; sign-in and registration can return the session id as a token in the body; the session guard accepts `Authorization: Bearer <token>` in place of the cookie; CORS allows the new headers.
- Frontend: after sign-in or registration, check that the cookie works; if not, keep the token and send it on every request; clear it on sign-out and on a 401.
- Contract bump (next minor after the current version in `.orchestrate/api-contract.yaml`), tests, `deployment.md`, `.rule/security-rules.md`, `.doc/architecture.md`.

Out of scope (see Q3, Q4): GitHub sign-in on the fallback path, refresh tokens, JWTs, a second token store, changing the 7-day idle/absolute session rules, removing the cookie, any change to the plan 042 `COOKIE_SAMESITE` behaviour.

## Findings from the code
- One choke point reads the session id: `readSessionId()` in `backend/src/lib/session-guard.ts:38` (cookie only). It is used by the guard, `session.route.ts` (sign-in, restore), `account.route.ts` (register) and `github-signin.route.ts`. Adding a bearer source there covers every route.
- The session id is a 43-character random value; the database stores only its hash (`idHash`). A bearer token can be the same id: no new table, same expiry, same sign-out (`DELETE /api/session`).
- CSRF (`backend/src/lib/csrf.ts`) needs the `X-CSRF-Protection: 1` header and a matching `Origin` on state-changing requests. A bearer token is not sent by the browser on its own, so it adds no CSRF risk; keep the CSRF guard unchanged anyway (it also protects the cookie path).
- CORS (`backend/src/app.ts:110`) allows only `Content-Type` and `X-CSRF-Protection`; `Authorization` and the opt-in header must be added or the preflight fails.
- The frontend sends `credentials: 'include'` on every request (`frontend/src/services/api.service.ts:127`) and already detects "401 right after sign-in" (plan 047, `listener.ts`).
- Trade-off to state plainly: a token kept in browser storage can be read by script injected through an XSS bug, which an `HttpOnly` cookie prevents. The design limits this: the switch is off by default, the token is used only when the cookie fails, and it is never put in a URL.

## Design
1. **Switch.** Backend env `SESSION_TOKEN_FALLBACK=on|off`, default `off`. When off, nothing changes. When on, the two responses below include the token.
2. **Issue.** `POST /api/session` and `POST /api/account` (register), when the request has `X-Session-Mode: token` and the switch is on, return `sessionToken` (the new session id) in the JSON body in addition to `Set-Cookie`. Without the header, the response is unchanged.
3. **Accept.** `readSessionId()` returns the bearer token when `Authorization: Bearer <43 chars>` is present, otherwise the cookie. A bearer token wins over a stale cookie. A malformed value is treated as no session (401), never an error detail.
4. **Cookie check (frontend).** The sign-in request always sends `X-Session-Mode: token`. Right after success, the frontend calls `GET /api/session` with the cookie only. If it answers 200, the cookie works: the token is dropped from memory and nothing is stored. If it answers 401, the frontend switches to token mode: keeps the token, sends `Authorization: Bearer` from then on (and stops showing the plan 047 `cookieBlocked` toast for this case).
5. **Storage.** In token mode the token lives in `localStorage` key `cr.sessionToken` through `frontend/src/services/storage.service.ts` (Q2). Removed on sign-out, on any 401, and when a later cookie check succeeds.
6. **Restore on reload.** If `cr.sessionToken` exists, the app sends it on `GET /api/session` at start.
7. **Unchanged.** Rate limits, password rules, session lifetime, `DELETE /api/session` (works with either credential), CSRF header and Origin check.

## Assumptions
- The deployment is GitHub Pages (web) plus Render (API), cross-site, as in `deployment.md` section 7.
- The session id stays a 43-character URL-safe value; hashing at rest is unchanged.
- `Authorization` is not logged anywhere (check `backend/src/lib/security-log.ts` and request logging; add a test).
- Code style: no trailing semicolons. Naming: `session` (singular), `org`, `sessionToken` as the one new term (add to `.doc/glossary.md`).

## Open Questions
Answer inline under each. Recommended answer first.

**Q1. Branch.** Part A's changes are uncommitted on `feat/iphone-login-session-ended-and-zoom`.
- (A) Commit Part A first, then a new branch for Part B.
- (B) Keep both parts on one branch and one PR.
Answer: B

**Q2. Where is the token kept in the browser?**
- (A, recommended) `localStorage`: survives reload and new tabs, which a phone user expects; readable by injected script (accepted, see Findings).
- (B) `sessionStorage`: dies with the tab; safer, but the user signs in again often on iPhone.
- (C) Memory only: signs the user out on every reload; not usable.
Answer: _

**Q3. GitHub sign-in on the fallback path.** The GitHub callback sets the cookie and redirects, so on Safari the session is lost the same way. A fix needs a one-time code in the redirect and an exchange endpoint (more backend and tests).
- (A, recommended) Not in this plan; do it in the separate backlog item "iPhone GitHub sign-in" using the same switch.
- (B) Include it now.
Answer: _

**Q4. Should the switch default to `on`?**
- (A, recommended) Default `off`; you set `SESSION_TOKEN_FALLBACK=on` on Render. Nobody gets a token body unless the deployment chooses it.
- (B) Default `on`.
Answer: _

## Steps
1. Contract first: update `.orchestrate/api-contract.yaml` (`X-Session-Mode`, `sessionToken` on the two 200/201 bodies, `bearerAuth` security scheme, CORS headers note, version bump) and the glossary.
2. Backend (backend agent): config `SESSION_TOKEN_FALLBACK` (`backend/src/config.ts`, `utils/constants.ts`, env examples); `readSessionId()` bearer support; token in the sign-in and register responses; CORS `allowedHeaders` plus `Authorization` and `X-Session-Mode`; tests with Vitest and Supertest. Failing tests first.
3. Frontend (frontend agent): `api.service.ts` sends the opt-in header on sign-in/register and `Authorization` in token mode; the cookie check; `cr.sessionToken` handling; sign-out and 401 cleanup; reuse the plan 047 `cookieBlocked` text only when the fallback switch is off or the token mode also fails. Failing tests first.
4. Docs: `deployment.md` section 7 (the new option, how to turn it on, its trade-off), `.rule/security-rules.md` (token rules), `.doc/architecture.md`, README env table, both env examples.
5. Run `cd backend && npm test`, `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, and a Playwright spec that blocks the cookie (a request interceptor that strips `Set-Cookie`) to simulate Safari.

## Validation
1. Switch off (default): `POST /api/session` with `X-Session-Mode: token` returns no `sessionToken`; behaviour identical to before (existing backend suite passes).
2. Switch on, header sent: sign-in and register return a `sessionToken` of 43 URL-safe characters that is also the session; without the header, no token.
3. `Authorization: Bearer <token>` authorises `GET /api/review` (and any protected route) with no cookie; a wrong, malformed, expired or signed-out token gets the generic 401.
4. `DELETE /api/session` with the bearer token signs out; the token then gets 401.
5. Bearer wins over a stale cookie; an invalid bearer with a valid cookie gets 401 (no silent fallback to the cookie).
6. CORS preflight allows `Authorization` and `X-Session-Mode` for `FRONTEND_URL` only; a foreign Origin is still refused; the CSRF header is still required on state-changing requests with a bearer token.
7. The token never appears in logs, error bodies or URLs (a test greps the captured logs of a full sign-in and a failed request).
8. Playwright with the cookie stripped: sign-in succeeds, a reload keeps the user signed in, sign-out clears `cr.sessionToken`, a 401 clears it and returns to `/login`.
9. Playwright with the cookie working: `cr.sessionToken` is never written.
10. Plan 028 tests and the Part A items above still pass; `npm run typecheck` shows only the 2 known errors.
11. Manual (owner): deployed app, `SESSION_TOKEN_FALLBACK=on` on Render, sign in on the real iPhone 13, reload, stay signed in.

## Risks
- XSS exposure of a stored token (see Findings); mitigated by the off-by-default switch and by using the token only when the cookie fails. React escapes output and there is no `dangerouslySetInnerHTML` use to confirm: QA greps for it.
- The cookie check adds one request after sign-in.
- A user can have the token in `localStorage` on a shared device; sign-out removes it, and the idle expiry still applies.
- GitHub sign-in stays broken on Safari until Q3's follow-up.
- Contract drift: the frontend must not ship before the backend supports the header; rollout order below.

## Rollout Order
1. Contract and glossary. 2. Backend with the switch `off`. 3. Frontend. 4. Deploy the backend, set `SESSION_TOKEN_FALLBACK=on`. 5. Deploy the frontend. 6. Owner tests on the iPhone.

## Rollback
Set `SESSION_TOKEN_FALLBACK=off` (sign-in then returns no token and the frontend falls back to cookie-only behaviour). Full rollback: revert the branch; no migration and no schema change, so there is nothing to undo in the database. Nothing is committed without your approval.
