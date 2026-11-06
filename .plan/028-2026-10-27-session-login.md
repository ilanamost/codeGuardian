# Session Login, Registration, and Settings Applied End to End

Status: done
Owner: Ilana
Last updated: 2026-10-27 (revision 1: answers to Open Questions 1, 2, 4 and 5)

## Goal
- **With the real backend** (`VITE_DATA_SOURCE=api`), the app is usable only when signed in.
  - A signed-out visitor goes to `/login` (user name and password). After signing in, they land on the page they asked for.
  - A new user creates an account at `/register` (user name, email, password, confirm password).
  - Each account sees only its own data.
- **In mock mode** (`VITE_DATA_SOURCE=json`) there is no login at all. Every page opens directly, as today.
- Sign-in creates a server-side session. Its random session id goes in an `HttpOnly` cookie. A refresh keeps the user signed in, on the same page, with the same data. Signing out (after a confirmation dialog) and changing the password end the session on the server.
- Settings work end to end:
  - **Account:** the real user data, plus profile photo upload.
  - **Security:** the password change and sign-out.
  - **Notifications** and **AI Preferences:** each one visibly changes what the app does.
  - The bottom-left sidebar shows the same user data and photo.

## Scope
- Backlog item 1 (`stack:full`). No Figma. Branch: `feat/session-authentication` (already created; the plan file name avoids `auth` because of the guardrail hook, see Risks).
- **Your decisions (2026-10-27):**
  - **Q1:** registration is required with the real backend. In mock mode there is no login at all.
  - **Q2:** follows from Q1. Several accounts exist, so all data is isolated per account. Each account gets its own org (Scope 4).
  - **Q4:** answer A.
  - **Q5:** answer A.
  - **Q3:** still open. Questions 6 to 8 are new.
- **What the code does today** (read 2026-10-27):
  - **Single user, no auth.** The backend has one account row per org (`account`, PK `org_id`, only the `default` org). It is seeded from `backend/src/data/settings.json` (John Doe, `john@company.com`, password `mock-password` as a scrypt hash, `backend/src/lib/password.ts`).
  - **Account routes.** `GET /api/account` returns the profile with no check. `PUT /api/account/password` verifies the current password and stores a new hash. `POST /api/account/sign-out` does nothing (`backend/src/service/account.service.ts`).
  - **No org from a request.** Every route runs unauthenticated. The `Store` interface (`backend/src/store/store.ts`) takes no org id: `PgStore` hardcodes `default` and `MemoryStore` has one state.
  - **CORS.** `cors({ origin: frontendUrl })`, without credentials. `backend/tests/qa-adversarial.test.ts` asserts that `access-control-allow-credentials` is absent.
  - **Frontend.**
    - `App.tsx` renders the shell (Sidebar, routes, MobileNav) with no guard.
    - `SidebarProfile` and `AccountPanel` read `GET /api/account` through `useAccount`, and show initials (`avatarUrl` is always `null`).
    - The `SecurityPanel` Sign Out calls the no-op route with no dialog and shows a "Signed out" toast.
    - `api.service.ts` sends no cookies (no `credentials`).
    - The JSON data source serves the account routes from session memory.
  - **Settings applied today:**
    - Theme, density, font size, default language and the Generated tests tab toggle.
    - The "Review completed" and "Review failed" notices (`store/listener.ts`, `notification.service.ts`).
  - **Settings not applied today:**
    - "Critical security findings": `notifyCriticalFinding` is never called.
    - "Email notifications": there is no email system.
    - Review focus, strictness and explanation detail: the analyzer never reads them, they are only stored.
- **In scope:**
  1. **Server-side session** (contract 0.8.0):
     - **Session id:** 32 random bytes (base64url). It is stored only as its SHA-256 hash.
     - **Cookie:** `HttpOnly`, `SameSite=Lax`, `Path=/`. With `NODE_ENV=production` it is also `Secure` and uses the `__Host-` name prefix.
     - **Expiry:** rolling idle expiry plus an absolute expiry (Open Question 3).
     - **Rotation:** a new id on sign-in and on password change. Any session id the browser already had is discarded (no session fixation).
     - **Invalidation:**
       - Sign-out deletes the session.
       - A password change deletes every other session of the account and rotates the current one.
       - An expired, unknown or deleted id gets 401.
  2. **Registration** (`POST /api/account`, public; the `/register` page):
     - **Body:** `{ username, email, password }`, zod strict. Confirm password is checked on the client only and never sent.
     - **Validation, the same on client and server:**
       - **user name:** trimmed, 3 to 32 characters, `[A-Za-z0-9._-]`, unique regardless of case;
       - **email:** trimmed, a valid address, at most 254 characters, unique regardless of case (stored lower-cased);
       - **password:** the rules in Open Question 7.
     - **Hashing:** the existing scrypt (`backend/src/lib/password.ts`).
     - **Creation, in one transaction:**
       - a new org (random id, named after the user name);
       - the account (`fullName` defaults to the user name, since editing the full name is out of scope; `memberSince` is today);
       - the default settings;
       - the GitHub connection row.
     - **Taken user name or email:** 409 `conflict` with one generic message, "This user name or email cannot be used.", which never says which field or whether an account exists. Field-format errors stay field-specific (422 `details.issue[]`).
     - **Rate limit:** 5 sign-ups per client IP per hour, then 429 with `Retry-After`.
     - **On success:** per Open Question 6.
     - **Links:** the login page links to "Create an account", and the register page links back to "Sign in".
  3. **Session routes:**
     - `POST /api/session`: sign in with `{ username, password }`. Returns 200 with the `Account`, or 401 with one generic message for an unknown user or a wrong password.
     - `GET /api/session`: session restore ("who am I"). Returns 200 `{ account, expiresAt }`, or 401.
     - `DELETE /api/session`: sign out, 204, and the cookie is cleared.
     - `POST /api/account/sign-out` is removed (its replacement is `DELETE /api/session`).
  4. **Authentication on every route.** One central middleware resolves the session and puts `{ orgId }` on the request (the account's own org). Every route except these gets 401 `unauthorized` without a valid session:
     - `GET /api/health`;
     - `POST /api/account` (registration);
     - `POST /api/session` and `GET /api/session`;
     - the test-only reset route, when it is enabled.
  5. **Per-account data isolation, through one org per account.** This reuses the existing `org_id` design: every table already has `org_id`, and `account`'s primary key is already `org_id`. So "one account per org" stays true, while the number of orgs grows with registrations.
     - Every `Store` method takes the org id, and services pass the session's org. Nothing is hardcoded to `default` any more.
     - `MemoryStore` keeps its state per org.
     - Background analysis and `resumeUnfinished` carry the review's org.
     - Isolated per account: reviews (including saved edits and generated tests), the Dashboard aggregates, settings, the GitHub connected state, support requests, the profile photo and sessions.
     - Another account's review id gets 404, never 403, so ids do not leak.
     - `POST /api/test/reset` empties every org and re-seeds per Open Question 8.
  6. **CSRF.**
     - `SameSite=Lax`.
     - Every state-changing request (POST, PUT, PATCH, DELETE) must carry the custom header `X-CSRF-Protection: 1`. Because the header is not a simple header, the browser sends a CORS preflight, which only `FRONTEND_URL` passes.
     - When an `Origin` header is present, it must equal `FRONTEND_URL`.
     - Otherwise the request gets 403 `forbidden`.
     - No token store is needed.
  7. **CORS with credentials.** `credentials: true`, the origin is exactly `FRONTEND_URL` (never `*`, never reflected), and the allowed headers include `Content-Type` and `X-CSRF-Protection`. The frontend sends `credentials: 'include'`.
  8. **Brute-force protection** on `POST /api/session`, and on a wrong current password in `PUT /api/account/password` (sign-up has its own limit, Scope 2):
     - **Limits:** 5 failures per user name in 15 minutes, and 20 attempts per client IP in 15 minutes.
     - **When a limit is hit:** 429 `rate_limited` with a `Retry-After` header and `details.retryAfterSecond`. The response is the same whether or not the user name exists.
     - **Timing:** an unknown user name is checked against a dummy scrypt hash, so it takes about as long as a real check.
     - **Storage:** the counters live in memory (one backend instance, plan 022). They reset on restart and on the test reset.
  9. **Login and register pages** at `/login` and `/register`, API mode only, with no sidebar or mobile nav. The register page has the four fields of Scope 2 (reusing `PasswordField`) and the same validation and pending behavior as login. The login page:
     - **Fields:** user name and password (reveal toggle, reusing `PasswordField`).
     - **Client validation:** both fields required; the user name trimmed, 1 to 64 characters; the password 1 to 200 characters. Errors are shown under each field, and Submit is disabled while a request is in flight.
     - **Server validation:** zod strict, so unknown fields get 422.
     - **Messages:** one generic "Incorrect user name or password." for any 401. The 429 message gives the wait time.
     - **Autocomplete:** `username` and `current-password`.
  10. **Mock mode, with no login** (`VITE_DATA_SOURCE=json`). A flag `AUTH_REQUIRED` in `frontend/src/lib/config.ts` is true only for `api`. It can be injected through `createAppStore` and the guard, so unit tests (pinned to `json`) can test both modes. When it is false:
      - **Routes:** `/login` and `/register` are not registered. A new catch-all route (`*`) in `App.tsx` redirects them, and any unknown path, to `/`; today unknown paths render an empty shell. The guard lets every route through.
      - **No session code runs:** no session restore, no session slice transitions, no cookie handling and no CSRF header. Those live only in `api.service.ts` and `session.service.ts`, which are never called.
      - **Security panel:** the Sign Out button is hidden, and the panel shows the note "Mock mode: no sign-in. Sign out and accounts need the real backend." Update password stays a mock-only action against the JSON data source, as today, with its validation, so the form can still be tried.
      - **Account panel and sidebar:** the mock account from `src/mocks/settings.json`. The photo upload works for the browser session only (a data URL).
      - The JSON data source does **not** serve the session or registration routes.
  11. **Route guard** (API mode). A layout route wraps every app route:
     - While the session is unknown, a full-page "Checking your session..." status is shown, never a flash of `/login`.
     - A signed-out visitor is redirected to `/login` with the target path, search and hash kept in router state. After sign-in, the app navigates there.
     - Only an internal path is accepted as the target (it starts with a single `/` and is not `/login`); otherwise `/`. This prevents an open redirect.
     - A signed-in visitor who opens `/login` or `/register` is sent to `/`.
  12. **Session restore on load** (API mode). `GET /api/session` is sent once when the app starts (StrictMode shares it through the plan 026 in-flight GET). It fills a new `session` slice and the account in the `account` slice, so no extra `GET /api/account` is sent on load.
  13. **Session ended mid-use** (API mode). When any rejected thunk has HTTP status 401 (except the restore, sign-in and registration themselves):
      - the listener dispatches `sessionEnded`;
      - the guard redirects to `/login`, keeping the current path as the target;
      - one toast is shown: "Your session has ended. Sign in again.";
      - the 401 is not also shown as a separate error toast.
  14. **Sign out** (API mode; mock mode per Scope 10):
      - The Security panel's Sign Out opens a confirmation dialog first: "Sign out?", with Cancel and Sign out. It is accessible (`role="dialog"`, `aria-modal`, focus moved into it and returned after, Escape and Cancel close it).
      - Confirming sends `DELETE /api/session`. On success, the Redux state is reset (reviews, dashboard, account, settings cache key `cr.settings`), the app navigates to `/login`, and the toast "Signed out" is shown.
      - On failure, an error toast is shown and the user stays signed in.
  15. **Update password end to end:**
      - The existing form and field errors stay. The new password follows the Open Question 7 rules, on both client and server.
      - On success, the other sessions end, the current session cookie is rotated, and the toast "Password updated" is shown.
      - Afterwards, the old password fails to sign in and the new one works.
  16. **User data:**
      - The Account tab shows the full name, user name, email, member since and the photo (or initials).
      - The desktop sidebar's bottom-left profile shows the photo (or initials), the full name and the email, from the session account.
      - Both update at once after a photo change.
  17. **Profile photo:**
      - **Upload:** `PUT /api/account/avatar` with the raw image as the body (`express.raw` only on that route, `Content-Type` `image/png`, `image/jpeg` or `image/webp`, at most 2 MB). The type is checked on the file's magic bytes, never on the client's MIME type or filename, and SVG is refused.
      - **Remove:** `DELETE /api/account/avatar`.
      - **Serve:** `GET /api/account/avatar` sends the account's own photo with the sniffed `Content-Type` and these headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`, `Cache-Control: private`. It needs a valid session.
      - **`avatarUrl`:** set to `/api/account/avatar?v=<digest prefix>`, so a change busts the cache.
      - **Storage (Open Question 4, answer A):** PostgreSQL `bytea`, or `MemoryStore` without `DATABASE_URL`. Stored as uploaded, with no new dependency.
      - **Frontend:** the same type and size checks before upload, then a preview, then "Change photo" and "Remove photo". Errors use the existing toast and 413/422 hints.
  18. **Notifications applied:**
      - "Review completed" and "Review failed": already applied; covered by tests.
      - "Critical security findings": now raised when a review the page was polling completes with a critical finding (`Review.hasCriticalFinding`), and only when the toggle is on.
      - "Email notifications" (Open Question 5, answer A): the toggle stays and is saved, with the note "Email delivery is not available yet". No email is sent.
  19. **AI Preferences applied:**
      - **When:** the backend reads the account's saved settings when an analysis starts (create, run, resume) and passes them to the analyzer in `AnalyzerInput.preference`.
      - **What the stub analyzer does with them (Open Question 5, answer A):**
        - review focus keeps that category's findings and suggestions only ("Readability" also keeps maintainability);
        - "Only high-confidence" keeps critical and high only;
        - "Concise" shortens `detail` to `Line N`;
        - generated tests off produces no tests;
        - the defaults give today's output.
      - **Language:** the default language stays as it is today.
  20. **Contract** `.orchestrate/api-contract.yaml` goes from 0.7.0 to **0.8.0**:
      - the cookie security scheme, applied globally, with the public routes marked `security: []`;
      - the `X-CSRF-Protection` header parameter;
      - 401, 403, 409 and 429 responses;
      - `POST /api/account` (registration) with the `Registration` schema;
      - the `Session`, `SignIn` and `Account` changes (`username`, and `avatarUrl` as a relative API path);
      - the avatar routes;
      - the removed sign-out route.

      0.x allows a breaking change in a minor bump, as in earlier plans.
  21. **Schema** (`.rule/database-rules.md`, the `database-schema` skill):
      - **`account`** keeps its primary key `org_id`, one account per org; the table now has many rows. It gets:
        - `username text`, with a unique index on `lower(username)`;
        - `email` unique, with a unique index on `lower(email)`. The column already exists.
      - **New `session` table:** `id` (the hash, PK), `org_id` (`REFERENCES account(org_id) ON DELETE CASCADE`), `created_at`, `last_seen_at`, `expires_at`, `absolute_expires_at`, with an index on `org_id`.
      - **New `account_avatar` table:** `org_id` PK and FK to `account(org_id)`, `content_type`, `data bytea`, `digest`, `updated_at`.
      - **Indexes:** every existing table already filters by `org_id`; the review index already leads with it. Indexes are added where a query now filters by an org other than `default`: `support_request(org_id)`.
      - **New migration `backend/db/migration/002-session.sql`**, in one transaction: the columns, indexes and tables above, and a backfill of `username` for the existing `default` account (Open Question 8).
      - **`schema.sql`** gets the same changes, idempotently (`ADD COLUMN IF NOT EXISTS`, `CREATE ... IF NOT EXISTS`), so an existing local database upgrades on `npm run db:setup`. The rule is updated to allow additive `ADD COLUMN IF NOT EXISTS`. Rows and data already in `default` are kept (Open Question 8).
      - **Seeds:** `schema.sql` keeps seeding only the `default` org row. The backend seeds the demo account per Open Question 8.
      - **Expired sessions** are deleted when read, and swept on each sign-in.
  22. **JSON data source** (`VITE_DATA_SOURCE=json`): no session or registration routes (Scope 10).
      - `PUT /api/account/password` stays mock-only, as today.
      - New avatar routes are served for the browser session (a data URL).
      - `frontend/src/mocks/settings.json` gets `username` like the backend seed, so the seed-equality test still holds.
  23. **Logging:**
      - sign-in success and failure, registration success, refusals and conflicts, rate-limit hits, CSRF and Origin refusals, and 401s on protected routes;
      - each entry has `requestId`, org (when known), operation, and a reason code;
      - never the password, the session id or its hash, the cookie header or the image bytes; the user name only as a short hash.
  24. **Tests and docs:** see Steps and Validation.
- **Out of scope:**
  - Password reset by email, email verification, multi-factor auth, deleting an account.
  - Login or registration in mock mode.
  - GitHub OAuth (backlog item 3).
  - Editing the full name or email.
  - Several accounts sharing one org, teams and roles. Each account has its own org.
  - A real email delivery system.
  - A real AI analyzer.
  - Restoring unsaved editor text on `/review/new` after a refresh. Saved reviews are restored as today.
  - The known TS2550 typecheck bug (separate backlog item).

## Assumptions
- **Accounts come from registration** (API mode). Each registered account gets its own org. The isolation tests register two accounts through `POST /api/account`. The demo account is optional (Open Question 8), and the e2e fixture uses whatever the test reset seeds.
- **Same site, so cookies are sent.** The frontend and backend run on `localhost` with different ports (5173/3001, and 5174/3101 in e2e). Ports do not change the site, so a `SameSite=Lax` cookie is sent with `credentials: 'include'`. Both must use the same host name (`localhost`, not `127.0.0.1`), and the README says so.
- **Production setting.** `NODE_ENV=production` (read by `backend/src/config.ts`; any other value or unset is development) turns on `Secure` and the `__Host-` prefix. It is listed in the README. Agents do not edit env files (guardrail), so you add any placeholder lines.
- **Sessions follow the store.** Without `DATABASE_URL`, sessions live in `MemoryStore` and end on a backend restart, so the user signs in again. With PostgreSQL, sessions survive a restart.
- **Where the profile shows.** Below the `lg` breakpoint the sidebar is hidden (plan 012), so on mobile the user data appears in the Account tab only.
- **"Continue where he left off"** means the same URL (including `?topic=` and the review id) and the server data after a refresh. The Settings section is added to the URL (`/settings?section=security`), so a refresh keeps it too.
- **Mock mode is the unit-test default.** Unit tests are pinned to `json`, so most frontend unit tests need no session. The guard, login, register and 401 tests inject `AUTH_REQUIRED=true`.
- **Existing tests need a signed-in state**, so each test harness is updated:
  - Backend unit tests use a signed-in Supertest agent from `backend/tests/helper/app.ts`. It registers or seeds an account in a fresh `MemoryStore`.
  - The frontend cross-stack harness (`frontend/tests/utils/backendHarness.ts`) uses a fetch with a cookie jar.
  - Frontend unit renders preload an authenticated session (`tests/utils/renderWithStore.tsx`) only where `AUTH_REQUIRED` is injected.
  - The e2e auto fixture (`frontend/tests/e2e/fixture.ts`) resets the backend, then signs in through `page.request`, so the browser context holds the cookie. The direct API helpers (`createReview`, `setReviewFailed`) send the cookie and the CSRF header.

## Open Questions
Answer inside this file, on the `**Answer:**` line under each question. If you only write "approved", the recommended answer is used.

1. **Who can sign in, and with which user name?** No registration is requested.
   - A. **(Recommended)** One seeded account per org:
     - user name `john.doe` (new `username` field in both `settings.json` seeds);
     - password `mock-password`, the existing demo password, documented in the README as a local demo credential to change after first sign-in;
     - the e2e and unit tests use the same seed.
   - B. Like A, but the seed password comes from an env variable (`SEED_PASSWORD`) and there is no committed password. The e2e suite then needs the variable as well.
   - C. Sign in with the email address instead of a separate user name. The field would be labeled "Email".

   **Answer:** Registration to the application is required, unless the app runs in mock mode; then there is no login at all. (2026-10-27. Applied in Scope 2 and Scope 10; the demo account is now Open Question 8.)

2. **Does data become per user, or stay shared in one org?**
   - A. **(Recommended)** Stay org-scoped:
     - reviews, dashboard, settings, GitHub state and support requests belong to the session's org, and the org now always comes from the session, never from a constant;
     - one account per org, as today;
     - tests prove that a second org and account cannot read or change the first org's data (404 on another org's review id).
   - B. Per account: every table gets an `account_id`, and several accounts share an org. This is more schema and store work, and it is not needed until there are teams or registration.

   **Answer:** Decided by answer 1: data is isolated per account. Each registered account gets its own org, so the existing `org_id` scoping is the isolation boundary and no table needs a new `account_id` (Scope 5).

3. **How long does a session last?**
   - A. **(Recommended)** 8 hours idle (rolling: each request extends it, written at most once a minute), and at most 7 days in total. After that, sign in again.
   - B. 30 minutes idle and 12 hours in total (stricter, more sign-ins).

   **Answer:** A. (2026-10-27)
   - C. Other values (state them).

   **Answer:**

4. **Profile photo: where is it stored, and what is accepted?**
   - A. **(Recommended)**
     - Stored in PostgreSQL (`account_avatar`, `bytea`), or in `MemoryStore` without `DATABASE_URL`, so nothing is written to disk.
     - PNG, JPEG or WebP, at most 2 MB, checked by magic bytes.
     - Stored as uploaded, with no new dependency. JPEG metadata (for example location) stays in the file, but only the signed-in account itself can fetch it.
   - B. Like A, but re-encode with `sharp` (new dependency): strips metadata and caps the size at 512x512 px.
   - C. A local folder (`backend/upload/`) with random file names, served by the same authenticated route.

   **Answer:** A.

5. **What does "applied" mean for AI Preferences and Email notifications?** The stub analyzer stands in until the real one exists.
   - A. **(Recommended)** AI Preferences:
     - **review focus:** keeps only that category's findings and suggestions; "Readability" also keeps maintainability, and "All" keeps everything;
     - **strictness:** "Only high-confidence" keeps critical and high only; "Balanced" and "Comprehensive" keep everything, as today, so the default output does not change;
     - **explanation:** "Concise" shortens each finding's `detail` to `Line N`; "Detailed" is today's text;
     - **generated tests off:** no generated tests are produced, and the tab stays hidden as today.

     Email notifications: the toggle stays and is saved, with the note "Email delivery is not available yet". No email is sent.
   - B. Same AI mapping, and remove the Email toggle until email exists.
   - C. Also build email sending (SMTP and a new dependency). This is a larger task, best kept separate.

   **Answer:** A.

6. **After a successful sign-up, is the user signed in?**
   - A. **(Recommended)** Yes. `POST /api/account` returns 201 with the `Account`, starts a session (a new session id and cookie, as at sign-in), and the app opens the target path or `/`. This is one step for the user, and no email verification exists that would need to come first.
   - B. No. It returns 201 with no session, and the app goes to `/login` with the toast "Account created. Sign in."

   **Answer:** A. (2026-10-27)

7. **Password rules** (registration and password change)?
   - A. **(Recommended)**
     - 8 to 200 characters;
     - at least one letter and one digit;
     - not equal to the user name or the email;
     - not in a small built-in list of common passwords (about 100 entries in `backend/src/utils/`, shared with the frontend as a constant, no new dependency).

     The register form shows the rules and a live checklist. The server checks the same rules (422 with `details.issue[]` on `password`). The existing seeded `mock-password` does NOT pass these rules (it has no digit): it still signs in, because sign-in never checks the rules, but it cannot be set as a new password (corrected after QA round 1).
   - B. Length only: 8 to 200 characters, as today.
   - C. Stricter: 12 or more characters with upper case, lower case, a digit and a symbol.

   **Answer:** A. (2026-10-27)

8. **The demo account and the data already in your local database.** Today all data is in the `default` org.
   - A. **(Recommended)**
     - Keep a demo account (`john.doe` / `mock-password`) as the owner of the `default` org. Migration 002 and the backend seed give it the user name when missing, so your existing reviews, settings and support requests stay with it, and you can sign in to see them.
     - New registrations get new, empty orgs.
     - The test reset re-seeds the same demo account, so the e2e fixture signs in as it.
     - The README says to change its password, and that it can only be used locally.
   - B. No demo account outside tests: the `default` org data stays in the database but no one can sign in to it, until you register and it is moved to you by a one-off documented SQL step. The test reset still seeds a test-only account.
   - C. Delete the `default` org data in migration 002 (start clean).

   **Answer:** A. (2026-10-27)

## Steps
1. **Approve.** You answer Open Questions 3, 6, 7 and 8 and approve (the terminal gate sets `Status: active`). Then the Linear tickets are created: backend, frontend, QA.
2. **Backend: contract first.** Bump `.orchestrate/api-contract.yaml` to 0.8.0 (Scope 20), and update `backend/tests/contract.test.ts`.
3. **Backend: store and schema.**
   - The org id goes on every `Store` method; `MemoryStore` keeps state per org; `PgStore` uses parameterized `org_id` filters.
   - The store gets `createAccount` (org, account, default settings and the GitHub row in one transaction; a unique-violation becomes the generic conflict) and `findAccountByUsername`.
   - Session and avatar methods are added to both stores.
   - `schema.sql`, `002-session.sql`, the unique indexes, and the demo-account seed (Open Question 8).
   - `reset()` empties every org, re-seeds, and clears sessions, avatars and the rate-limit counters.
   - Keep the unit suite green after the org refactor, before adding auth.
4. **Backend: auth.**
   - New modules:
     - `lib/session.ts`: token creation, hashing and cookie options;
     - `lib/rate-limit.ts`;
     - `lib/csrf.ts`: header and Origin checks;
     - the `auth` middleware in `lib/auth.ts`;
     - `lib/password-rule.ts` (Open Question 7);
     - `schema/session.schema.ts`, and the registration schema in `schema/account.schema.ts`;
     - registration in `service/account.service.ts` and `route/account.route.ts` (`POST /api/account`);
     - `service/session.service.ts`;
     - `route/session.route.ts`.
   - `app.ts`: CORS with credentials, then CSRF, then auth, mounted before the domain routers.
   - `account.service`: the password change rotates and invalidates sessions; the no-op `signOut` is removed.
   - Avatar routes in `route/account.route.ts`.
   - Error codes `unauthorized` (401) and `forbidden` (403) in `utils/error-code.ts` and `lib/error.ts`.
   - `NODE_ENV` in `config.ts`.
5. **Backend: preferences.** Add `preference` to `AnalyzerInput`. `review.service` reads the settings at analysis start, and the stub analyzer applies them per Open Question 5.
6. **Backend tests (Vitest and Supertest):**
   - the signed-in agent helper, with the existing suites moved onto it;
   - new `tests/registration.test.ts`, `tests/session.test.ts`, `tests/auth-boundary.test.ts`, `tests/account-isolation.test.ts`, `tests/csrf.test.ts`, `tests/rate-limit.test.ts`, `tests/avatar.test.ts` and `tests/preference.test.ts`;
   - the `qa-adversarial` CORS assertion updated to expect credentials only for `FRONTEND_URL`;
   - new `tests/db/session.test.ts`:
     - registration and the unique constraints;
     - sessions and avatar bytes;
     - per-account isolation;
     - restart survival of a session;
     - migration 002 column parity;
     - upgrading a database built by migration 001 with data in `default` (data kept, per Open Question 8).
7. **Frontend: data and state.**
   - `lib/config.ts`: `AUTH_REQUIRED` (true only for `api`), injectable for tests.
   - `api.service.ts`: `credentials: 'include'`, and `X-CSRF-Protection: 1` on non-GET requests.
   - `services/session.service.ts`: `restore`, `signIn`, `signOut`. `account.service.ts`: `register`, `uploadAvatar` and `removeAvatar`; `signOut` moves to the session service.
   - `store/session.slice.ts` (in mock mode it starts and stays `mock`, with no requests), and a root reset on `signedOut` and `sessionEnded`.
   - `listener.ts`: the 401 handling (API mode only) and the critical-finding notice.
   - The JSON data source: the avatar routes, no session routes, and `src/mocks/settings.json` (`username`).
   - The password rules and common-password list as a shared constant.
   - DTOs and guards (`Account.username`, `Session`, `Registration`).
   - Route paths in `lib/api.constants.ts`; texts in `lib/account.constants.ts` and the new `lib/session.constants.ts`; error texts in `utils/error-messages.ts`.
8. **Frontend: UI.**
   - `pages/LoginPage.tsx` and `pages/RegisterPage.tsx`, a `components/RequireSession.tsx` layout route, and the `/login` and `/register` routes in `App.tsx`, registered only when `AUTH_REQUIRED` (the shell renders only inside the guard).
   - `components/ConfirmDialog.tsx`, and the Sign Out flow in `SecurityPanel.tsx`: the dialog in API mode; hidden, with the mock-mode note, in mock mode.
   - The photo upload in `AccountPanel.tsx`, and the photo in `SidebarProfile`.
   - The email note in `NotificationsPanel.tsx` per Open Question 5.
   - The `?section=` parameter in `SettingsPage.tsx`.
   - Icons from `lucide-react`, with `LogOut`, `Camera` and `LogIn` reused for the same ideas. Tailwind utilities only, no new `.css` file, no inline styles, no semicolons.
9. **Frontend tests:**
   - unit tests for:
     - the guard in both modes;
     - the login and register form validation and the password checklist;
     - the redirect-target check;
     - the session slice and the reset;
     - the 401 listener;
     - the dialog;
     - mock-mode Security panel;
     - the avatar checks;
     - the critical-finding notice;
   - the cross-stack tests with the cookie-jar harness;
   - the e2e auto fixture signs in, and new specs `tests/e2e/auth.spec.ts`, `tests/e2e/register.spec.ts`, `tests/e2e/account-avatar.spec.ts` and `tests/e2e/settings-applied.spec.ts`;
   - one mock-mode e2e spec `tests/e2e/mock-mode.spec.ts`, run by a second Playwright project or config that starts the frontend with `VITE_DATA_SOURCE=json` on its own port and no backend.
10. **Docs:**
    - `.doc/product-definition.md`:
      - into scope (API mode): registration, session sign-in, per-account data, the profile photo;
      - mock mode has no login;
      - out of scope keeps GitHub OAuth, password reset and email verification, email delivery, and teams;
      - "single user", "one `default` org until auth arrives" and "Defer auth" are removed from Constraints and Prioritization Rules.
    - `.doc/architecture.md`: rewrite "Auth and Org Boundaries", add the session flow, CSRF, CORS, the route guard, the 401 handling and the avatar route, and add a Change Log entry.
    - `.doc/glossary.md`:
      - new terms: registration (sign up), session, session id, sign in and sign out, session restore, route guard, login page, mock mode, profile photo (`avatar` in code), login rate limit, password rules;
      - corrected entries: account (now has a user name and a session), settings (now on the backend), the analyzer stub (applies preferences).
    - `.rule/database-rules.md`: one org per account, the unique indexes, the new tables, migration 002, the demo-account seed, and the additive `ADD COLUMN IF NOT EXISTS` rule.
    - `README.md`: registering, the demo account (per Open Question 8), mock mode without login, `NODE_ENV`, the same-host note, and running the suites with sign-in.
11. **Test runs, kept economical:**
    - Each implementation and fix round runs only:
      - `cd backend && npm test`, plus `npm run test:db` when the store or schema changed;
      - `cd frontend && npm test`;
      - the Playwright specs of the area touched (for example `npx playwright test auth register account-avatar settings`).
    - The full `npm run test:e2e` runs **once**, before final approval.
12. **QA** against Validation, writing `.orchestrate/qa-report.md`. Then your approval, the backlog item marked `[V]`, and this plan set to `done`.

## Validation
Each item is a test or a command that QA runs.

**Commands**
- [ ] `cd backend && npm test` passes. `cd backend && npm run typecheck` is clean.
- [ ] With `TEST_DATABASE_URL` set:
  - `npm run db:setup:test` passes twice in a row;
  - `npm run db:setup` on a database built by migration 001 alone, with data in `default`, adds the new columns, indexes and tables, and keeps that data per Open Question 8;
  - `npm run test:db` passes.
- [ ] `cd frontend && npm test` passes. `npm run typecheck` shows only the known TS2550 `isWellFormed` errors (`src/models/github.model.ts`, `tests/unit/qa-github-link-parity.test.ts`). `npm run lint` is clean. (Bare `npx tsc --noEmit` checks no files and does not count.)
- [ ] Full `cd frontend && npm run test:e2e` passes once before final approval, with the e2e fixture signed in. This includes the existing specs `settings`, `api-integration`, `api-calls`, `error-notification`, `review-run`, `review-actions`, `review-history`, `github-link-import`, `responsive`, `help`, `smoke`, the code-editor specs and the `qa-*` specs, and the mock-mode spec.

**Registration (Supertest)**
- [ ] A valid `POST /api/account` gives 201 per Open Question 6.
  - With 6A, there is a session cookie and `GET /api/session` returns the new account.
  - With 6B, there is no cookie and a sign-in works.
  - The account has the default settings, no reviews, and an all-zero Dashboard.
- [ ] Duplicates give 409 with one identical generic body for all of these, and nothing is created:
  - the same user name;
  - the same user name in other case (`John.Doe`);
  - the same email;
  - the same email in other case.
- [ ] Malformed input gives 422 with field issues: user name too short, too long or with bad characters; an invalid email; unknown fields. The password is never echoed.
- [ ] Weak passwords give 422 on `password` (per Open Question 7): too short, no digit, equal to the user name or email, a listed common password. The same rules apply to `PUT /api/account/password`.
- [ ] The stored hash has the `scrypt$` format, and the password is never in the store, a response or a log.
- [ ] The 6th sign-up from one IP within an hour gives 429 with `Retry-After`.
- [ ] Registration needs `X-CSRF-Protection` (403 without it).

**Backend (Supertest)**
- [ ] Every protected route returns 401 `unauthorized` in the standard error shape when:
  - there is no cookie;
  - the session id is unknown;
  - the session id is tampered with;
  - the session is past its idle expiry or past its absolute expiry (fixed clock).

  `GET /api/health`, `POST /api/account` and `POST /api/session` work without a session. The test enumerates the routes from the contract.
- [ ] `POST /api/session`:
  - correct credentials give 200 and a `Set-Cookie` with `HttpOnly`, `SameSite=Lax`, `Path=/` and `Max-Age`, and no `Secure` in development;
  - with `NODE_ENV=production`, the cookie has `Secure` and the `__Host-` name;
  - a wrong password and an unknown user both give 401 with the identical body;
  - unknown fields and over-long values give 422;
  - the password is never echoed.
- [ ] Session rotation: a cookie sent with the sign-in request is not reused, and the new id differs. The old id gets 401.
- [ ] Sign-out: `DELETE /api/session` gives 204 and clears the cookie (`Max-Age=0`). The same cookie then gets 401.
- [ ] Password change:
  - it gives 204, and the response rotates the cookie;
  - a second signed-in agent gets 401 afterwards;
  - the old password then fails to sign in and the new one works;
  - a wrong current password still gives 422 on `currentPassword`.
- [ ] Rate limit:
  - the 6th failed sign-in for one user name within 15 minutes gives 429 with `Retry-After`, even with the correct password;
  - an unknown user name behaves the same;
  - the 21st attempt from one IP gives 429;
  - after the window (fixed clock), sign-in works again;
  - a wrong current password counts too.
- [ ] CSRF:
  - a POST, PUT or DELETE without `X-CSRF-Protection`, or with a foreign `Origin`, gives 403 and changes nothing;
  - the preflight from `FRONTEND_URL` allows credentials and the header;
  - a foreign origin gets no `Access-Control-Allow-Origin` for itself and no credentials.
- [ ] Per-account isolation (authorization). Register accounts A and B, each with reviews, settings, a GitHub connection, a support request and a photo. Signed in as B:
  - A's review id gives 404 on GET, PUT, run, rename, generated-test and DELETE;
  - B's History, Dashboard counts, settings, account, avatar and GitHub state never include A's data;
  - changing B's settings or password does not change A's;
  - signing out B, or B's password change, does not end A's sessions;
  - A's analysis uses A's AI preferences, not B's.

  This runs on `MemoryStore` (unit) and on `PgStore` (`test:db`).
- [ ] Avatar:
  - PNG, JPEG and WebP up to 2 MB give 200 with the new `avatarUrl`;
  - over 2 MB gives 413;
  - SVG, HTML renamed to `.png`, a mismatched `Content-Type` or an empty body give 422, and nothing is stored;
  - `GET` returns the bytes with the sniffed type, `nosniff`, a CSP with `sandbox`, and no access without a session;
  - `DELETE` sets `avatarUrl` to `null`.
- [ ] Preferences (per Open Question 5): with the settings saved first, a created review reflects review focus, strictness, explanation and generated tests. The default settings give today's stub output (existing assertions unchanged).
- [ ] Logs (captured logger) contain no password, session id, cookie header, password hash or image bytes. A failed sign-in logs one structured entry with `requestId` and a reason.
- [ ] `test:db`: a session survives closing the pool and reconnecting, and only hashes are stored in `session.id`.

**Frontend (Vitest and RTL)**
- [ ] Mock mode (`AUTH_REQUIRED=false`):
  - every app route renders with no session request;
  - `/login` and `/register` redirect to `/`;
  - no request carries `X-CSRF-Protection` or `credentials`, since `api.service` is never called;
  - the Security panel has no Sign Out button and shows the mock-mode note;
  - Update password still works against the JSON data source.
- [ ] Register form:
  - the empty, mismatched-confirm and rule-breaking fields show their messages and send no request;
  - the checklist reflects each rule;
  - a 409 shows the generic message;
  - a 429 shows the wait time;
  - success follows Open Question 6.
- [ ] Route guard (API mode):
  - while the session is unknown, the loading status shows and neither `/login` nor the page renders;
  - signed out, `/history?x=1#a` redirects to `/login`, and after sign-in the app lands on `/history?x=1#a`;
  - targets `//evil.example`, `https://evil.example` and `/login` resolve to `/`.
- [ ] Login form:
  - empty fields show the required messages and send no request;
  - a 401 shows the generic message and clears the password field;
  - a 429 shows the wait time;
  - Submit is disabled while pending.
- [ ] A 401 from any thunk dispatches `sessionEnded` once, redirects to `/login` keeping the path, and shows a single toast with no duplicate error toast.
- [ ] Sign Out:
  - it opens the dialog; Cancel and Escape send nothing;
  - Confirm sends `DELETE /api/session`, resets the state, removes `cr.settings`, navigates to `/login` and shows "Signed out";
  - a failure keeps the user signed in and shows an error toast.
- [ ] Avatar: a wrong type or a file over 2 MB is refused before upload. A success updates both the Account panel and the sidebar image.
- [ ] Notices: the "Critical security findings" notice shows on completion with a critical finding only when the toggle is on. The "Review completed" and "Review failed" gates keep passing.
- [ ] `tests/unit/seed.test.ts` passes with `username` in both seeds.
- [ ] Cross-stack (`tests/unit/cross-stack.test.ts`): registration, sign-in, restore, a protected call, the password change and sign-out run through `api.service` against the real `createApp`, with the cookie jar.

**E2E (Playwright)**
- [ ] `auth.spec.ts`:
  - opening `/review/new` signed out lands on `/login`, and signing in returns to `/review/new`;
  - wrong credentials show the generic message;
  - a refresh on `/settings?section=security` stays signed in on the same section, with no `/login` flash;
  - Sign Out shows the dialog, then `/login` and the "Signed out" toast, and Back does not reopen the app;
  - the session cookie is `HttpOnly` (`context.cookies()`), and `document.cookie` does not contain it.
- [ ] `register.spec.ts`:
  - from `/login`, "Create an account" leads to `/register`;
  - registering a new account follows Open Question 6, and the Account panel and sidebar show the new user name and email;
  - its History is empty while the demo account's review is not visible;
  - registering the same user name again shows the generic message.
- [ ] `mock-mode.spec.ts` (frontend with `VITE_DATA_SOURCE=json`):
  - `/`, `/history` and `/settings` open directly;
  - `/login` lands on `/`;
  - the Security panel shows no Sign Out;
  - no request goes to `/api/session`.
- [ ] Password change in the browser: "Password updated", then sign out, then the old password fails and the new one signs in.
- [ ] `account-avatar.spec.ts`: upload a PNG; the Account panel and the sidebar show it after a reload; remove it and the initials come back; a `.txt` file is refused with a message.
- [ ] `settings-applied.spec.ts`:
  - with "Review completed" off, no toast;
  - with "Critical security findings" on and code containing `eval`, the critical notice shows;
  - with review focus set to Security, the created review has only security findings;
  - with generated tests off, there is no Generated tests tab and no tests are produced;
  - the Email toggle shows the note from Open Question 5.
- [ ] `api-calls.spec.ts` still finds no duplicate GETs on load, with `GET /api/session` once per page load.

**Repository checks**
- [ ] `git diff --stat` shows no `docs/` directory and no new `.css` file. The contract version is 0.8.0, and `backend/tests/contract.test.ts` covers every new route.

## Risks
- **The guardrail blocks auth file names.** `.claude/hooks/require-approval-auth-files.js` blocks any Edit or Write whose path contains `auth` until a human approves. The planned `backend/src/lib/auth.ts`, `tests/auth-boundary.test.ts` and `tests/e2e/auth.spec.ts` all match. This plan was renamed to `028-2026-10-27-session-login.md` for that reason. Mitigation: you approve those writes when the agents ask; agents never work around the hook.
- **Two modes double the paths to test.** Mitigation: one `AUTH_REQUIRED` flag, decided once in `lib/config.ts`. Unit tests for both modes, and one mock-mode e2e spec.
- **Account enumeration through sign-up.** Mitigation: the generic 409 that does not say which field is taken, the sign-up rate limit, and no difference in timing worth measuring at this size. Some leak cannot be avoided when user names must be unique; it is documented.
- **Registration spam on a public deployment.** There is no CAPTCHA or email check. Mitigation: the IP rate limit. The app is local only (product definition), and this is documented.
- **Existing local data after the upgrade.** Mitigation: migration 002 is additive, the `default` org data is kept and attached per Open Question 8, and an upgrade test runs on a migration-001 database with data.
- **Every existing test needs a session.** Mitigation:
  - one signed-in helper per harness (backend agent, cross-stack cookie jar, preloaded store, e2e fixture), moved over mechanically;
  - the org refactor lands first with the suite green, then auth.
- **Org parameter refactor across the store.** Same pattern as plan 022's async refactor: `MemoryStore` first, then `PgStore`, with the boundary tests on both.
- **Cookie not sent in development.** If the frontend and backend use different host names (`localhost` vs `127.0.0.1`), the session cookie is not sent. Mitigation: the README note, and the e2e config uses `localhost` for both.
- **Lockout as denial of service.** The per-user-name limit lets anyone who knows a user name lock that account for 15 minutes. It is accepted for a local app and documented; the IP limit bounds automated guessing.
- **Upgrading an existing local database.** Mitigation: additive `ADD COLUMN IF NOT EXISTS`, and the user-name seed when missing, both tested on a database built by migration 001.
- **Leaking image content.** The avatar is served same-site only with a session, `nosniff` and a sandbox CSP, and SVG is refused.
- **Toast storms when a session expires mid-page** (polling, several thunks). Mitigation: one `sessionEnded`, the 2 s dedupe, and the 401 kept out of the error toasts.

## Rollout Order
1. Contract 0.8.0.
2. Org-aware `Store` refactor (no behavior change, suite green).
3. Schema, migration 002, accounts, sessions and avatar in both stores.
4. Session, CSRF, rate limit and auth middleware; registration, account and avatar routes; backend tests.
5. Preferences in the analyzer.
6. Frontend `AUTH_REQUIRED`, data layer and session slice, then the guard, login and register, then mock mode, sign-out, avatar and notices.
7. Frontend tests and e2e fixture, then docs.
8. QA (area specs during fixes, full e2e once), then your approval.

## File names (your decision, 2026-10-27)
The guardrail hook `.claude/hooks/require-approval-auth-files.js` blocks Edit and Write on any path containing `auth`. You approved the plan file rename and authorized agents to name NEW files without `auth` instead of bypassing the hook. Everywhere this plan says `lib/auth.ts`, `tests/auth-boundary.test.ts` or `tests/e2e/auth.spec.ts`, use:
- `backend/src/lib/session-guard.ts` (the central middleware);
- `backend/tests/session-boundary.test.ts`;
- `frontend/tests/e2e/login.spec.ts`.
Other new files follow the same rule (no `auth` in the path). Agents never use Bash, heredocs or other tools to write around the hook, and never edit the hook or `.claude/`. If a file that already has `auth` in its path must change, the agent stops and asks.

## Revision 1 (QA round 1, 2026-10-28)
QA round 1 (`.orchestrate/qa-report.md`): the security core held (sessions, CSRF, CORS, rate limits, enumeration, registration, isolation, avatar, logs). Not green yet, so these are fixed under the approved plan:
- **D1 (Medium, data leak, frontend):** a GET still in flight at sign-out lands in the freshly reset store, so the next user can briefly see the previous user's Dashboard or History (`frontend/src/store/dashboard.slice.ts`, `review.slice.ts`, same pattern in settings and github). The shared in-flight GET map in `frontend/src/services/api.service.ts` is never cleared, so the next user's first GET of a URL can receive the previous user's pending response. Fix: a session counter bumped by the root reset and checked in each thunk (ignore responses from a previous session), plus `abortAll()` in the API service, called on sign-out and on session end. QA's two failing tests in `frontend/tests/unit/qa-session-adversarial.test.tsx` pass.
- **D2 (High, gate; test spec):** `frontend/tests/e2e/error-notification.spec.ts` (~lines 155-163) fails every `/api/**` route including `GET /api/session`, so no page loads. Let `/api/session` through and update the `/settings` expectations (the account now comes from the session restore). Do not weaken what the spec proves.
- **D3 (Medium, gate):** 31 code-editor e2e tests failed in the 26-minute full run (Monaco never rendered) but `code-editor.spec.ts` passed 6/6 alone. Find the cause: rerun the code-editor specs on this branch and compare with the committed code in a temporary worktree (no stash). Fix it if plan 028 caused it (for example the signed-in storage state per new page, timeouts, resource exhaustion); if it pre-exists, report it with evidence.
- **D4 (Low, docs):** the plan text claiming `mock-password` passes the new rules is corrected above.
- **D5 (Low, backend):** `backend/src/service/session.service.ts` (~line 95) builds the dummy hash on first use, so the first unknown-user sign-in after start takes about twice as long. Build it when the service is created.
- **Accepted risks (documented, no change):** a user name is locked for 15 minutes after 5 wrong attempts; no `trust proxy` (revisit before any deployment behind a proxy). Add a line for each in the README.

Validation additions:
- [ ] After sign-out, a response that arrives late never reaches the next user's store, and the next user's first GET is a new request (unit tests).
- [ ] `error-notification.spec.ts` passes with the session guard in place.
- [ ] The full `npm run test:e2e` run passes (one run, after the area specs).
- [ ] The first unknown-user sign-in takes about as long as the second (backend timing test).

## Rollback
- Revert the branch `feat/session-authentication`.
- The database changes are additive. The new tables, the `username` column and the unique indexes can stay unused, or be dropped by hand. Data in the `default` org is untouched, so the reverted app sees it as before.
- Accounts registered meanwhile, and their orgs and data, remain as extra rows. The reverted app reads only `default` and ignores them. They can be deleted by hand (`DELETE FROM org WHERE id <> 'default'` after their child rows), as noted in the README.
- Sessions and avatars live only in the new tables.
- Reverting the contract to 0.7.0 together with the code restores the unauthenticated app.
