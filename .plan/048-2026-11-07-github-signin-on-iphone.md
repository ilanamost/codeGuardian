# Plan 048: "Continue with GitHub" sign-in on iPhone

Status: active (approved 2026-11-07; Q1 = A the login page with no message, Q2 = A URL fragment and Q3 = A 60 s in memory, both taken as the recommended answers)
Owner: orchestrator (backend and frontend agents implement)
Last updated: 2026-11-07
Branch: feat/github-signin-on-iphone
Backlog task: "stack:full. When trying to connect from a real iphone 13 device through github, I'm getting an incorrect username or password error."
Figma: none
Related: plan 040 (GitHub sign-in), plan 047 (session token fallback), plan 042 (`COOKIE_SAMESITE`), plan 043 (redirect base path)

## Goal
- On an iPhone 13 (Safari), with the web app on GitHub Pages and the API on Render (different sites), a user who taps "Continue with GitHub" and approves on GitHub ends up signed in and stays signed in after a reload.
- Browsers that keep the cookie behave exactly as today.

## Scope
`stack:full`: backend, frontend, API contract, docs. Only the GitHub sign-in and register path. No change to the password sign-in, the wizard, the review flow, or the GitHub rate limit (a separate backlog item).

In scope:
- Backend: after a successful GitHub sign-in, hand the browser a short-lived, single-use code, and a public endpoint that swaps the code for the session token (only when `SESSION_TOKEN_FALLBACK=on`, as in plan 047).
- Frontend: on return from GitHub, read the code, swap it, run the plan 047 cookie check, keep the token only when the cookie did not stick, restore the session.
- Contract bump (next minor after 0.18.0), tests, `deployment.md`, `.rule/security-rules.md`, `.doc/architecture.md`.

Out of scope: private repositories or a stored GitHub token; the Settings > Account "Link GitHub" flow (the user is already signed in there and the redirect only changes the link, no session starts); other sign-in providers; changing session lifetimes; `trust proxy` and the wizard's GitHub rate limit (own backlog item); the zoom and cookie-message work of plan 047.

## Findings from the code
- Flow today: the button is a plain link to `GET /api/auth/github` (`frontend/src/components/GithubSignInButton.tsx`). The callback `GET /api/auth/github/callback` (`backend/src/route/github-signin.route.ts:53-70`) sets the session cookie in its `302` and redirects to the web app (`result.redirect`, e.g. `https://<user>.github.io/<repo>/`). That cookie is set by the API host while the browser is on `github.com` and then lands on the web app's site, so it is a third-party cookie. Safari drops it.
- The app then starts, calls `GET /api/session` (restore), gets 401, and shows the login page. No `auth_error` is set, so no GitHub message is shown.
- Plan 047's token fallback cannot help here: the token is returned in the JSON body of `POST /api/session` and `POST /api/account`, and a redirect has no body. Plan 047 recorded this as out of scope (Q3).
- The message in the report, "incorrect user name or password" (`SESSION_ERROR_MESSAGE.signInFailed`, `frontend/src/utils/error-messages.ts:448`), is the password sign-in's text for a 401. The GitHub flow never produces it by itself; it appears if the user, back on the login page, types credentials, or if their GitHub-created account has no password. See Q1.
- Reusable pieces: `readSessionId()` already accepts a bearer token (plan 047); `SESSION.idPattern` is the 43-character id; the frontend `api.service` already runs the cookie check and stores `cr.sessionToken` in token mode.
- Sessions are stored by hash only (`session.id` holds the hash). A code that is exchanged for the raw session id must therefore keep the raw id somewhere for a moment. The backend runs as a single instance (product definition), so a small in-memory map with a 60-second life is enough; a restart simply invalidates codes in flight and the user taps the button again.

## Design
1. **Switch.** Same `SESSION_TOKEN_FALLBACK` (default off). When off, nothing changes (no code, no new endpoint).
2. **Code on return.** When the switch is on and a GitHub sign-in succeeds, the callback still sets the cookie and redirects, and appends a code to the URL **fragment**: `<frontend><returnTo>#auth_code=<code>` (a fragment is never sent to a server and not put in a `Referer`). The code is 32 random bytes (base64url, 43 characters), single-use, valid 60 seconds, held in memory as a hash of the code mapped to the raw session id.
3. **Exchange.** New public endpoint `POST /api/auth/github/exchange` with body `{ "code": "<43 chars>" }`, the CSRF header and the Origin check as for any state-changing request, and the same per-address rate limit bucket as the other GitHub auth routes. A valid code returns `200` with `{ "sessionToken": "<43 chars>" }` and `Cache-Control: no-store`, and is deleted at once. An unknown, expired, reused or malformed code returns the same generic `401` (no detail). It does not set a cookie.
4. **Frontend on start.** Before the router renders, read `auth_code` from the URL fragment and remove it with `history.replaceState` (so it never stays in the address bar or history). If present, call the exchange, then run the plan 047 cookie check (`GET /api/session` with the cookie only): 200 means the cookie works, drop the token; 401 means store it as `cr.sessionToken` and use it as a bearer. Then restore the session as usual. A failed exchange shows the existing `invalid_state` text ("The GitHub sign-in expired or was not started here. Please try again.").
5. **Unchanged.** The state cookie and PKCE check of plan 040, the failure redirects (`/login?auth_error=...`), email-in-use rules, the Link and Unlink flows, and the cookie path for browsers that keep cookies.

## Assumptions
- The deployment is GitHub Pages (web) plus Render (API) with `COOKIE_SAMESITE=none` and `SESSION_TOKEN_FALLBACK=on` set on Render.
- A single backend instance (in-memory codes); noted as a limit in `deployment.md`.
- The web app uses a browser router with a base path (plan 043), so `#auth_code=` does not clash with a route.
- Code style: no trailing semicolons. Terms: `sessionToken` already in the glossary; `authCode` is added (singular, short).

## Open Questions
Answer inline under each. Recommended answer first.

**Q1. What exactly do you see on the iPhone after tapping "Continue with GitHub" and approving on GitHub?**
- (A, matches the code) The page reloads and I am back on the login page, with no message.
- (B) The login page with the message "Incorrect user name or password."
- (C) A different message (please paste it).
- (D) You cannot say, and the plan should go ahead on the cookie explanation.
Answer: A

If the answer is B or C, the plan's cause may be incomplete; I will re-check the backend callback before building.

**Q2. Where should the code travel?**
- (A, recommended) In the URL fragment (`#auth_code=`): never sent to a server, not in a `Referer`, removed at once.
- (B) In the query string (`?auth_code=`): simpler for the router, but it reaches server logs and the `Referer`.
Answer: A (taken as the recommended answer when the plan was approved)

**Q3. Code life and storage.**
- (A, recommended) 60 seconds, single-use, in memory (single instance; a restart drops codes in flight).
- (B) Stored in the database (survives restarts, needs a migration and a sweep).
Answer: A (taken as the recommended answer when the plan was approved)

## Steps
1. **Contract and glossary first** (`.orchestrate/api-contract.yaml`, version 0.19.0): `POST /api/auth/github/exchange`, the `AuthCodeExchange` body, the `SessionTokenResult` response, the fragment note on the callback, `authCode` in `.doc/glossary.md`.
2. **Backend** (backend agent), failing tests first: code store (create, consume once, expire at 60 s, hash only, size cap); callback appends the fragment only when the switch is on and a session started; the exchange route (valid, reused, expired, malformed, wrong length, missing CSRF header, foreign Origin, rate limit, `no-store`); logs never contain a code or a token; behaviour with the switch off. Update `deployment.md` section 7 and 8, `.rule/security-rules.md`, `.doc/architecture.md`, `.doc/summary-backend.md`.
3. **Frontend** (frontend agent), failing tests first: read and strip `auth_code` at start; exchange call; reuse of the plan 047 cookie check and token storage; failure shows the `invalid_state` text; nothing happens when no fragment is present; the token never reaches Redux or toasts; Playwright with the fake GitHub sign-in (`GITHUB_OAUTH_FAKE`) and the session cookie stripped, so the flow ends signed in and survives a reload. Add `frontend/tests/utils/backendHarness.ts` options as needed; a unit test that imports it must be added to the `--exclude` list in `.github/workflows/deploy-frontend.yml`.
4. Run `cd backend && npm test`, `cd frontend && npm test`, `npm run typecheck` (2 known errors), `npm run lint`, and the new Playwright spec.

## Validation
1. Switch off: the callback redirect has no fragment and `POST /api/auth/github/exchange` answers 404 (no new surface).
2. Switch on, successful GitHub sign-in: the redirect carries `#auth_code=` of 43 URL-safe characters, still sets the cookie, and the code is not in any query string, log or response body.
3. The exchange returns a `sessionToken` that works as `Authorization: Bearer` for `GET /api/session`; the same code used a second time returns 401.
4. A code older than 60 s, a malformed code, a code of the wrong length, and no code all return the same generic 401.
5. The exchange without the CSRF header returns 403; from a foreign Origin it is refused; it is rate limited with the other GitHub auth routes.
6. The responses of the exchange carry `Cache-Control: no-store`.
7. Playwright, cookie stripped, fake GitHub sign-in: tapping "Continue with GitHub" ends on the Dashboard signed in; a reload keeps the session; `auth_code` is gone from `location` and history after start; `cr.sessionToken` exists.
8. Playwright, cookie working: the same flow ends signed in and `cr.sessionToken` is never written.
9. A failed GitHub sign-in (`access_denied`) still shows its existing message and creates no token.
10. Plan 040, 043 and 047 tests still pass; typecheck shows only the 2 known errors; lint is clean.
11. Manual (owner): the real iPhone 13 on the deployed app with `SESSION_TOKEN_FALLBACK=on` on Render: "Continue with GitHub", approve, land signed in, reload, still signed in.

## Risks
- The cause in the plan (a dropped redirect cookie) comes from reading the code; the report said "incorrect user name or password", which the GitHub flow does not produce. Q1 and step 2's first test settle this before the build.
- A code in a URL fragment is visible in the address bar for an instant and in browser history if not replaced; the frontend replaces it before any render. Anyone with the URL within 60 seconds could swap it once; the 256-bit random value, single use and short life limit this.
- In-memory codes are lost on restart or lost on a second backend instance; the user taps the button again.
- Storing a bearer token in `localStorage` has the XSS trade-off stated in plan 047; it is used only when the cookie fails.

## Rollout Order
1. Contract and glossary. 2. Backend with the switch as it is (off or on). 3. Frontend. 4. Deploy the backend, keep `SESSION_TOKEN_FALLBACK=on`. 5. Deploy the web app. 6. Owner tests on the iPhone.

## Rollback
Set `SESSION_TOKEN_FALLBACK=off`: no code is issued and the exchange route is gone, so GitHub sign-in is as it is today. Full rollback: revert the branch; no migration and no schema change. Nothing is committed without your approval.
