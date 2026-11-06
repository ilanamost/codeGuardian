# GitHub Sign-in Redirect Under a Frontend Sub-path

Status: done
Owner: Ilana
Last updated: 2026-11-06

## Goal
- After GitHub sign-in (and link, and every sign-in error), the browser returns **inside the frontend app** when the frontend is served under a sub-path, for example a GitHub Pages project page `https://<user>.github.io/<repo>/`.
- Nothing changes for an app served at an origin root (the local setup and a user site): the redirects are byte for byte the same as today.

## Scope
- Backlog follow-up of plan 042: "make the GitHub sign-in redirect work when the frontend is served under a sub-path." No Figma. It is a backend change (plus docs), so it runs as **stack:full**. Branch: `feat/signin-redirect-base-path`, created from `feat/production-environments` (plan 042 is committed there; this plan builds on its `deployment.md`).
- **What the code does today** (read 2026-11-06):
  - `backend/src/app.ts` computes `frontendOrigin = new URL(FRONTEND_URL).origin` and passes it to the GitHub sign-in service; the path of `FRONTEND_URL` is dropped.
  - `backend/src/service/github-signin.service.ts` builds every redirect as `frontendOrigin + path`: success (`returnTo ?? '/'`, two places), sign-in failure (`/login?auth_error=<code>`), link result and link failure (`/settings?section=account[&auth_error=<code>]`), and the rate-limited redirect.
  - `returnTo` comes from the browser (`frontend/src/lib/github-signin.ts` sends a router path such as `/review`), is checked by `safeReturnTo` in `backend/src/lib/github-signin-state.ts` (one leading slash, printable ASCII, resolves inside the app origin) and is stored in the state cookie.
  - The CORS check and the CSRF Origin check (`app.ts`, `backend/src/lib/csrf.ts`) compare against the **origin only**, which is correct and stays as it is.
  - The OAuth App callback URL (`GITHUB_OAUTH_REDIRECT_URL`) points to the **backend**, so it is not affected.
- **In scope** (assuming the recommended answers):
  1. A frontend base path derived from the path of `FRONTEND_URL` (for example `https://user.github.io/repo` gives `/repo`; no path gives an empty base). Trailing slashes are normalised; a `FRONTEND_URL` with a query or a fragment stops the start naming `FRONTEND_URL` and never its value.
  2. Every GitHub sign-in redirect is `frontendOrigin + base + path`: success (with or without `returnTo`), login errors, settings link results and errors, and the rate-limited redirect. The same helper is used everywhere, so no redirect can skip the base.
  3. `returnTo` stays a router path from the browser (the frontend is unchanged); the backend adds the base. `safeReturnTo` is not loosened: `//host`, backslashes, whitespace, control characters, non-ASCII and over-long values are still dropped, and the base can never come from the request.
  4. `deployment.md`: remove the "GitHub sign-in cannot complete on a project page" limitation, state that `FRONTEND_URL` for a project page is `https://<user>.github.io/<repo>` and must match `VITE_BASE_PATH`, and update the troubleshooting rows and the first-deploy checklist. The "Rename after generation" list is unchanged. The production template comment for `FRONTEND_URL` is updated.
  5. `.orchestrate/api-contract.yaml` 0.17.0 (additive): the description of the sign-in start and callback redirects says where the browser lands and that a path in `FRONTEND_URL` is kept. No route or schema change.
  6. `.doc/architecture.md` (GitHub sign-in section) and `.doc/product-definition.md` get one line each.
  7. Tests: see Validation.
- **Out of scope:**
  - Any frontend change (the router already has the base path from plan 042; the browser keeps sending router paths).
  - Detecting a mismatch between `FRONTEND_URL` and `VITE_BASE_PATH` automatically (Open Question 3).
  - A new environment setting (Open Question 1).
  - CORS and CSRF behaviour (origin only, unchanged), cookie settings, the OAuth App callback, private repositories, other providers.
  - Hosting, the real deploy and the owner's manual steps from plan 042.

## Assumptions
- The frontend is served either at an origin root (base empty) or at one sub-path such as `/repo`. Deeper paths work the same way.
- Operators configure `FRONTEND_URL` and `VITE_BASE_PATH` together; the docs say so.
- Today a path in `FRONTEND_URL` is silently ignored, so an existing setup that already has one would start to get it applied. The default local setup (`http://localhost:<port>`, no path) is unaffected.
- The Pages `404.html` redirect from plan 042 restores a deep link such as `/repo/login?auth_error=...` with its query string intact (the QA of plan 042 checked a deep link; the query string case is added to the tests of this plan where it can be checked).

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Where does the backend get the base path?**
   - A. **From the path of `FRONTEND_URL` (recommended).** No new setting; one value, easy to explain: "the full address of the frontend".
   - B. A new setting `FRONTEND_BASE_PATH` next to `FRONTEND_URL` (origin only). Explicit, but a second value that can disagree with the first.

   **Answer:**

2. **Who adds the base to `returnTo`?**
   - A. **The backend (recommended).** The browser keeps sending router paths such as `/review`; no frontend change, and the browser cannot choose the base.
   - B. The frontend sends the full path with the base and the backend checks that it starts with the base. A frontend change and a second validation.

   **Answer:**

3. **Mismatch between `FRONTEND_URL` and `VITE_BASE_PATH`.**
   - A. **Document it only (recommended).** `deployment.md` shows both values side by side in the checklist and a troubleshooting row for "sign-in lands on a 404".
   - B. Add a start-up warning or a health field so the frontend can compare. More code for a setup mistake that is visible at once.

   **Answer:**

## Steps
1. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
2. Branch `feat/signin-redirect-base-path` from `feat/production-environments` (nothing is committed without your explicit approval).
3. Linear: create the Backend and QA tickets (Todo); there is no frontend ticket because the frontend does not change. Write `.orchestrate/tickets.json`.
4. Backend agent: contract 0.17.0 first, then the base path in the config, the single redirect helper in the sign-in service, the tests.
5. Docs: `deployment.md`, the production backend template comment, architecture, product definition.
6. QA agent against Validation, then `.orchestrate/qa-report.md`.
7. Your final approval; plan to `done`, backlog item ticked (the backlog entry keeps your wording).

## Validation
- Backend: `cd backend && npm test` and `npm run typecheck` pass (`npm run test:db` if a database is available).
- No path (`http://localhost:5173`): every redirect equals today's value (a table test over success, `returnTo`, login errors, settings link result, settings link errors and the rate-limited redirect).
- With a path (`https://user.github.io/repo` and `https://user.github.io/repo/`): the same table gives `https://user.github.io/repo/...`, with no double slash and no missing slash; query strings (`auth_error`, `section=account`) are kept.
- `returnTo`: `/review` becomes `/repo/review`; `//evil.example`, `/\evil`, values with whitespace, control or non-ASCII characters, a value over the length limit and `https://evil.example` are still dropped, and the result still lands inside the frontend origin and base; a `returnTo` that starts with the base text cannot escape or double it.
- Start-up: a `FRONTEND_URL` with a query or a fragment stops the start naming `FRONTEND_URL` and not the value; one with no path starts as before.
- CORS and CSRF: with a path in `FRONTEND_URL`, an `Origin` equal to the origin is accepted, any other origin (including the origin plus the path as an Origin) is still refused, and no CORS header is sent to others.
- Cookies: the session and sign-in state cookies are unchanged (names, attributes, `SameSite` setting from plan 042).
- Link flow: `POST /api/auth/github/link` then the callback returns to `<base>/settings?section=account...`.
- Contract: `api-contract.yaml` is 0.17.0 and `backend/tests/contract.test.ts` expects it; no route or schema changed.
- Docs: `deployment.md` has no leftover statement that GitHub sign-in cannot work on a project page; a reader who follows the checklist sets `FRONTEND_URL` and `VITE_BASE_PATH` consistently; a search for the old limitation text returns nothing.
- Frontend unchanged: `git diff --stat -- frontend` shows no change for this plan.
- Manual (yours, after a real deploy): GitHub sign-in on the Pages project page returns to the app, a failed sign-in shows the login error, and Settings > Account link and unlink return to the account tab.

## Risks
- **A path in `FRONTEND_URL` starts to matter.** An existing setup that had a path there (ignored until now) changes behaviour. Mitigation: the local default has no path, the docs and the production template state the value to use, and the change is in the contract note.
- **Open redirect.** Building redirects from configuration plus a user-supplied path is the classic place for one. Mitigation: the base comes only from `FRONTEND_URL`, `safeReturnTo` is not loosened, and the tests include the hostile inputs above.
- **Double or missing slashes.** Mitigation: one helper, a table test with and without trailing slashes.
- **`FRONTEND_URL` and `VITE_BASE_PATH` disagree.** Mitigation: documented side by side (Open Question 3 A).
- **Pages `404.html` and query strings.** The restore script must keep `?auth_error=...`. Mitigation: a test of the generated redirect where possible, and the manual check above.

## Rollout Order
1. Contract 0.17.0.
2. Base path in the config and the redirect helper, then its tests.
3. Docs.
4. QA, then your manual deploy check.

## Rollback
- Revert the branch. Redirects return to `origin + path`, and `FRONTEND_URL` with a path is ignored again. No database change and no frontend change.
