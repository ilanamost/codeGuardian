# AI Code Reviewer & Quality Dashboard

A web app where developers submit code snippets or public GitHub links and an AI agent returns
a style review, bug detection, security warnings, suggested refactors, and auto-generated
tests, plus a dashboard of findings by category and severity. Built on reusable AI-project
scaffolding — rules, docs, and planning conventions that agents (and humans) follow, wired
together from [AGENTS.md](AGENTS.md).

> **Status: mid-migration.** The docs, glossary, and API contract describe the new product
> (see [.plan/003-2026-10-19-ai-code-reviewer-concept.md](.plan/003-2026-10-19-ai-code-reviewer-concept.md)).
> The chat-demo code has been removed (see [.plan/004-2026-10-19-remove-chat-code.md](.plan/004-2026-10-19-remove-chat-code.md));
> `backend/` is a health-check shell and `frontend/` a placeholder page until the review API
> and UI are built. Details: [.doc/product-definition.md](.doc/product-definition.md).

Planned stack: React + Monaco Editor frontend, Node/TypeScript API, Claude API for analysis
(`ANTHROPIC_API_KEY` from the environment, never committed), PostgreSQL storage, and "Continue with GitHub" sign-in
(optional, see [Sign in with GitHub](#sign-in-with-github-plan-040)).

## Run it

Set up PostgreSQL once (next section), then two terminals, from the repo root:

```bash
cd backend  && npm install && npm start    # http://localhost:3001 (applies the schema first)
cd frontend && npm install && npm run dev  # http://localhost:5173
```

Each package reads its own local env file (not committed). The backend needs `PORT` and
`FRONTEND_URL` (`http://localhost:5173`, for CORS), and `DATABASE_URL` to keep your data (see
below; without it the backend runs in memory, warns once, and forgets everything when it stops).
Contact Support needs no mail setting (see [Contact Support](#contact-support)).
The frontend needs only `VITE_API_URL=http://localhost:3001`, the backend base URL.

**The backend must run for the frontend to work** (plan
[035](.plan/035-2026-11-01-remove-mock-use-real-api.md)): the frontend always talks to the real
API, and there is no mock or offline mode. With the backend unreachable the app shows its session
error state with Retry and an error notification. `VITE_DATA_SOURCE` no longer exists; an old
local env file that still sets it is ignored, and you can delete that line.

New Review (`/review/new`) opens a blank review: type or import code, then Save
creates it on the backend and the page follows the analysis until it completes.

### Syntax errors in the editor (plan [032](.plan/032-2026-10-29-editor-syntax-errors.md))

The code editor marks syntax errors as you type (400 ms after the last key): a red squiggle and
a hover message such as "Unexpected `)`" or "Missing `}`". Python, Go and Java are parsed with
their tree-sitter grammars (`web-tree-sitter`, WebAssembly files bundled with the app and loaded
only when that language is first used); TypeScript and JavaScript use Monaco's own syntax check,
with type errors such as "Cannot find name" turned off. Only syntax is checked: no types, lint or
style (that is the AI review). **Nothing leaves the browser**: the code is parsed locally, never
run, and not sent anywhere for this check. Syntax errors never block Run review. At most 20 are
shown, and code over 100 000 characters is not checked. The read-only Generated tests editor is
not checked.

### Accounts and sign-in (plan [028](.plan/028-2026-10-27-session-login.md))

- **The app needs a signed-in session.** A signed-out visitor goes to `/login` and, after
  signing in, lands on the page they asked for. A refresh keeps the session (an `HttpOnly`
  cookie; 8 hours idle, 7 days at most). Sign Out is in Settings > Security, after a confirmation.
- **Register** at `/register` ("Create an account" on the login page): user name (3 to 32
  letters, digits, `.`, `_` or `-`), email and a password of 8 to 200 characters with a letter
  and a digit, not your user name or email and not a common password. You are signed in at once,
  with your own, empty data (reviews, Dashboard, settings, GitHub state, support requests, photo).
- **Demo account (local only):** `john.doe` / `mock-password` owns the data that existed before
  accounts (the `default` org; `npm run db:setup` gives it the user name). It is a local demo
  credential: change its password after the first sign-in (Settings > Security; the new one must
  follow the rules above, which `mock-password` itself does not) and never use it on a shared
  machine. Signing in never checks the rules, so the old demo password still works until changed.
- **Same host name for both servers.** The session cookie is sent across the two ports only when
  the frontend and the backend use the same host: open `http://localhost:5173` with
  `VITE_API_URL=http://localhost:3001` and `FRONTEND_URL=http://localhost:5173`. Mixing
  `localhost` and `127.0.0.1` signs you out on every request.
- **`NODE_ENV=production`** on the backend makes the cookie `Secure` with the `__Host-` prefix
  (HTTPS only); leave it unset for local development. Add the placeholder line to your own
  backend env file; agents do not edit env files.
- Accepted risk: after 5 wrong passwords for one user name (sign-in, or the current password
  in Settings > Security) that user name cannot sign in for 15 minutes, so anyone who knows a
  user name can lock it out for that long.
- Accepted risk: the backend does not trust a proxy (no `trust proxy`): the rate limits use the
  socket address, so behind a reverse proxy every user would share one limit. Revisit this
  before any deployment behind a proxy.
- The app is meant to run locally: registration has an IP rate limit but no CAPTCHA or email
  check, so do not deploy it publicly as is. Accounts registered while trying this branch stay
  as extra orgs after a rollback; they can be deleted by hand (`DELETE FROM org WHERE id <> 'default'`
  after their child rows).

### Sign in with GitHub (plan [040](.plan/040-2026-11-02-github-sign-in.md))

"Continue with GitHub" is an **optional** second way to register and sign in, next to the user
name and password. It is off until you create a GitHub OAuth App and give the backend its three
settings; with them blank the button is hidden, the four routes answer 404, and everything else
works as before. Sign-in only (scopes `read:user user:email`): no GitHub token is stored.

1. On GitHub: **Settings > Developer settings > OAuth Apps > New OAuth App**. Application name
   anything; Homepage URL `http://localhost:5173`; **Authorization callback URL**
   `http://localhost:3001/api/auth/github/callback` (the backend, not the frontend). Register it,
   copy the **Client ID**, then **Generate a new client secret** and copy it once.
2. Add three lines to the backend's own env file (never committed; the secret goes only there).
   Agents cannot edit env files, so this step is yours; put the same three names with placeholder
   values in the example env file so the next developer sees them:

   ```
   GITHUB_OAUTH_CLIENT_ID=<the Client ID>
   GITHUB_OAUTH_CLIENT_SECRET=<the client secret>
   GITHUB_OAUTH_REDIRECT_URL=http://localhost:3001/api/auth/github/callback
   ```

   `GITHUB_OAUTH_REDIRECT_URL` must equal the callback URL registered on GitHub. Set all three or
   none: setting only some stops the backend at start with a message that names the settings
   (never their values). Restart the backend after editing.
3. Open `http://localhost:5173/login`: **Continue with GitHub** is there. The same host name rule
   as above applies (`localhost` for both servers).

How it behaves: a first GitHub sign-in creates an account (user name from your GitHub login, with
a number added if it is taken; the verified primary email; **no password**) and opens the
Dashboard. If that verified email already belongs to a password account, GitHub sign-in is
refused ("sign in with your password, then link GitHub in Settings > Account"): an email never
takes over an account. In **Settings > Account** a password account can **Link** and **Unlink**
GitHub; unlinking is refused when GitHub is the only way to sign in. A GitHub-only account cannot
use the password form or edit its details (it has no password). Accepted limits: sign-in only (no
private repositories, the wizard still takes a user name), and the same local-only warning as
below.

Tests never reach github.com (a fake client). The one real round trip is a manual check after you
create the OAuth App: click Continue with GitHub, approve, and you land signed in. The test-only
flag `GITHUB_OAUTH_FAKE=true` (never in the example file) swaps in the fake client.

### Deployment (plan [042](.plan/042-2026-11-05-environments-and-github-pages.md))

The web app deploys to GitHub Pages with [.github/workflows/deploy-frontend.yml](.github/workflows/deploy-frontend.yml);
the backend and PostgreSQL run on a Node host. [deployment.md](deployment.md) covers the
architecture, every variable, the production GitHub OAuth App, the first-deploy checklist,
troubleshooting and rollback. Env template files are written without the leading dot until you
rename them (see "Rename after generation" there). A public deployment has no CAPTCHA or email
verification and the AI key spends your quota.

### Transport security

API bodies are plain JSON (the optional payload encryption of plan [033](.plan/033-2026-10-30-api-payload-encryption.md) was removed by plan [041](.plan/041-2026-11-05-remove-encryption.md)). On any real network, **HTTPS is required**. Passwords are stored only as a salted scrypt hash, never readable.

## PostgreSQL setup

Reviews, saved edits, deletions, settings, the password, the GitHub connected state and support
requests are kept in PostgreSQL (plan [022](.plan/022-2026-10-25-review-persistence.md)), so they
survive a restart. You need PostgreSQL 14 or newer installed locally and running, and two
databases: `ai_code_reviewer` for the app and `ai_code_reviewer_test` for the tests (the tests
empty it, so never point them at the app database).

1. Create a login role and the two databases, as the PostgreSQL superuser. On Windows `psql` is
   in `C:\Program Files\PostgreSQL\<version>\bin`. Pick your own password:

   ```bash
   psql -U postgres -c "CREATE ROLE ai_code_reviewer LOGIN PASSWORD 'choose-a-password'"
   psql -U postgres -c "CREATE DATABASE ai_code_reviewer OWNER ai_code_reviewer"
   psql -U postgres -c "CREATE DATABASE ai_code_reviewer_test OWNER ai_code_reviewer"
   ```

2. Set two variables, either in the backend's local env file (not committed) or in your shell:

   | Variable | Value | Read by |
   |---|---|---|
   | `DATABASE_URL` | `postgres://ai_code_reviewer:<password>@localhost:5432/ai_code_reviewer` | the backend (`npm run dev`, `npm start`), `npm run db:setup` |
   | `TEST_DATABASE_URL` | `postgres://ai_code_reviewer:<password>@localhost:5432/ai_code_reviewer_test` | `npm run db:setup:test`, `npm run test:db`, and the e2e backend |

   URL-encode special characters in the password (`@` is `%40`, `:` is `%3A`). For
   `npm run test:e2e`, `TEST_DATABASE_URL` must be set **in the shell** that runs it (Playwright
   reads it from its own environment and passes it to the e2e backend as `DATABASE_URL`).

3. Apply the schema (idempotent, safe to repeat; `npm run dev` and `npm start` do it for you):

   ```bash
   cd backend
   npm run db:setup         # backend/db/schema.sql on DATABASE_URL
   npm run db:setup:test    # the same on TEST_DATABASE_URL
   ```

   **Upgrading an existing database.** After pulling a change that adds a migration (for example
   plan 030, which adds `login` and `display_name` to `github_connection`), run
   `npm run db:setup` in `backend/` and restart the backend. If you skip it, a backend that was
   already running, or one started without `npm run dev` / `npm start`, answers 500 on the routes
   that use the new columns (for example `POST /api/github/connect`).

   **Upgrade note, plan 034 (test configuration).** Migration `004-test-config.sql` adds the
   nullable `review.test_config` column. Run `npm run db:setup` in `backend/` (and
   `npm run db:setup:test` for the test database), then restart the backend. It is idempotent
   and keeps every row: existing reviews read as the default test configuration (Jest, every
   test type) and their generated tests do not change. Without it, review routes answer 500.

If the backend cannot connect it stops with a message that names the variable and the error
code (for example `3D000`: the database does not exist), never the URL or the password.

## Test it

```bash
cd backend  && npm test                    # API tests (vitest, supertest), in-memory store, no database
cd backend  && npm run test:db             # PostgreSQL integration suite on TEST_DATABASE_URL
cd frontend && npm test                    # component tests (vitest, testing-library)
cd frontend && npx playwright install chromium && npm run test:e2e   # e2e (starts both servers)
```

`npm run typecheck` works in both packages. The frontend unit suite runs without a backend on
an in-memory fake backend (`frontend/tests/utils/fixtureDataSource.ts`, sample data in
`frontend/tests/fixtures/`) and includes a cross-stack test that calls the real backend app in process
(`frontend/tests/unit/cross-stack.test.ts`), so `backend` needs `npm install` first.

`npm run test:e2e` starts its own servers on ports 5174 (frontend, `VITE_API_URL` on the e2e backend) and
3101 (backend, `ENABLE_TEST_ROUTE=true`), so the dev servers above can keep running. The flag
mounts the test-only `POST /api/test/reset`, which every e2e test calls first to restore the
seed; never set it anywhere else. With `TEST_DATABASE_URL` set in the shell the e2e backend
runs on the test database, and the reset refuses any database whose name does not end in
`_test`; without it the e2e backend runs on its in-memory store. `npm run test:db` fails with a
clear message, instead of skipping, when `TEST_DATABASE_URL` is missing.

Since plan 028 every suite runs signed in: the reset ends every session, so the e2e fixture
(`frontend/tests/e2e/fixture.ts`) signs in again as the demo account through the browser
context (a spec that needs a signed-out browser uses `test.use({ signIn: false })`), and its
`request` helper adds the `X-CSRF-Protection: 1` header to state-changing calls. The cross-stack
harness (`frontend/tests/utils/backendHarness.ts`) uses a cookie jar and signs in first; unit
renders start signed in as the fixture account (`renderWithStore(ui, { session: 'unknown' })`
lets the app restore the session itself).

## Backend

`backend/` serves every route in [.orchestrate/api-contract.yaml](.orchestrate/api-contract.yaml)
(0.16.0) over PostgreSQL (plan [022](.plan/022-2026-10-25-review-persistence.md)), with the Claude
analyzer when `ANTHROPIC_API_KEY` is set and the deterministic stub analyzer (plan
[018](.plan/018-2026-10-22-backend-route.md)) otherwise (see "AI review" below). It starts with **no reviews**: only
the account and the default settings are seeded from `backend/src/data/*.json` (since plan
[030](.plan/030-2026-10-29-real-github-repository-selection.md) the GitHub wizard reads the real
GitHub API; `data/github.json` stays only as a seed copy), and the Dashboard
is computed from the reviews you create, with SQL aggregates. Everything you change survives a
restart, and reviews whose analysis was cut off by a stop are analyzed again on start. Without
`DATABASE_URL` the backend runs on an in-memory store and state resets on restart. Since plan
[019](.plan/019-2026-10-22-api-integration.md) the frontend calls every route, and since plan
[035](.plan/035-2026-11-01-remove-mock-use-real-api.md) it has no other data source.

```bash
cd backend
npm run dev                          # watch mode on http://localhost:3001 (PORT, FRONTEND_URL, DATABASE_URL)
npm test                             # vitest + supertest, every response checked against the contract
npm run test:db                      # every PgStore method, restart survival, reset guard (TEST_DATABASE_URL)
npm run db:setup                     # apply backend/db/schema.sql (db:setup:test for the test database)
npx vitest run --sequence.shuffle    # same suite in random order (store isolation)
npm run typecheck
```

Layout: `src/route` (Express routers), `src/service` (rules), `src/schema` (zod request
schemas), `src/store` (the `Store` interface, `PgStore`, `MemoryStore`: the only modules that own
data), `src/analyzer` (interface + stub), `src/lib` (errors, validation, scrypt password hash,
the GitHub link parser and REST client, the GitHub sign-in client), `db/` (`schema.sql`, `migration/`, `setup.ts`).

### AI review (Claude analyzer)

Plan [039](.plan/039-2026-11-02-llm-review-process.md) (contract 0.14.0). Put
`ANTHROPIC_API_KEY=<your key>` in the backend's own environment file (never committed; the key
stays on the backend and is never logged or sent to the browser). `ANTHROPIC_MODEL` is optional
and overrides the default model, `claude-sonnet-5-5`. **Without a key** the backend logs a
warning and uses the deterministic stub analyzer; the Review page then shows a "Stub analyzer"
note. With a key, the Review page shows "Code is sent to Anthropic's Claude API for analysis.
Do not submit secrets." (the same sentence is in Help).

Cost and limits: each analysis (Run review, or Regenerate tests) is one
paid API call, a few cents for a typical snippet and at most about $0.25 for a 100 000-character
file on the default model. Each account gets 20 analyses an hour (the next one is refused with
the time it frees up) and at most 3 calls run at once. A failed review says why (timeout, busy
service, refused, over the limit) and what to do. No test calls the real API; try a real review
by hand only.

### GitHub link import

`POST /api/github/import` (plan [023](.plan/023-2026-10-25-github-link-ingestion.md), contract
0.7.0) takes `{ "url": "..." }` with a public GitHub file link
(`https://github.com/<owner>/<repo>/blob/<ref>/<path>`) or pull-request link
(`https://github.com/<owner>/<repo>/pull/<n>`) and returns the code for the editor. The backend
never fetches the link itself: it parses it and calls only `https://api.github.com`, without
credentials and without following redirects. A branch name containing `/` is not supported:
open the file at a commit and paste that link.

| Limit | Value |
|---|---|
| One file | 50 000 characters |
| The whole import (a PR's files joined) | 100 000 characters |
| Files changed in a pull request | 20 |
| Timeout | 10 s per GitHub call, 30 s per import |

The GitHub API is called **without a token**, so GitHub's unauthenticated rate limit applies:
**60 requests an hour per IP**. A file link costs one request; a pull request of N files about
N + 2. When the limit is used up the import answers 429 `rate_limited` with the reset time.
No test calls GitHub: the unit tests inject a fake `fetch`, and the e2e backend runs with the
test-only flag `GITHUB_FAKE=true`, which answers a few fixed example links (see the contract).

### GitHub Integration wizard

Since plan [030](.plan/030-2026-10-29-real-github-repository-selection.md) (contract 0.9.0) the
wizard (`/github`) reads the **real public GitHub API**: type a GitHub user name, pick
one of that user's public repositories, then a file at the default branch, and its code opens
in the editor. No token and no OAuth, so **only public repositories** are listed, and anyone's
public repositories can be listed by typing their user name. The connection (login and display
name) is stored per account and survives a restart. Lists are capped at 100 repositories and
500 files (the response says `truncated`).

The wizard and the link import share one GitHub client and the same **60 requests an hour per
server IP**: connecting costs 1 request, every repository list or search 1, a file list 1 and
opening a file 1 (about 4 per wizard session). Nothing is cached; over the limit the routes
answer 429 `rate_limited` with the reset time. With `GITHUB_FAKE=true` the user name
`example-user` (repositories `demo`, `many-file`, `empty`, ...), `empty-user` and `busy-user`
work without the network.

### Contact Support

Since plan [032](.plan/032-2026-10-29-contact-support-mailto.md) (contract 0.11.0), **Submit
Request** in Help > Contact Support opens your own mail app with a ready message to the support
address; you press Send there. The app sends no email and needs no mail server or mail setting
(the plan 031 SMTP sending was removed). The request is first stored and gets a
ticket (`SUP-NNNN`, answer `{ ticket }`), which goes in the subject. Each account can send
**5 support requests an hour** (then 429 with `Retry-After`).

The support address is the constant `SUPPORT_EMAIL` in `frontend/src/lib/help.constants.ts`;
change it there. If no mail app opens, the form offers **Copy message** and **Copy address**.

## Layout

| Folder | Purpose |
|---|---|
| [backend/](backend/) | Express API for every contract route over PostgreSQL (in-memory fallback), with the Claude analyzer (stub analyzer without a key) |
| [frontend/](frontend/) | Vite + React + TypeScript + Tailwind placeholder page (Monaco editor planned) |
| [.orchestrate/](.orchestrate/) | [api-contract.yaml](.orchestrate/api-contract.yaml) — the source of truth for REST endpoints; agent reports and tickets |
| [.agents/](.agents/) | Specialist agent roles — orchestrator, frontend, backend, QA — each with its own `AGENT.md` |
| [.claude/](.claude/) | Guardrails: permissions in [settings.json](.claude/settings.json) and enforcement hooks in [.claude/hooks/](.claude/hooks/) |
| [.rule/](.rule/) | Required conventions agents must follow — coding, naming, security, testing, error handling, versioning, UI/style |
| [.doc/](.doc/) | Living reference docs — architecture, glossary, product definition |
| [.plan/](.plan/) | Backlog and task planning |

## .rule

| File | Covers |
|---|---|
| [coding-rules.md](.rule/coding-rules.md) | JS/TS coding conventions |
| [naming-rules.md](.rule/naming-rules.md) | Naming conventions |
| [database-rules.md](.rule/database-rules.md) | Schema, migrations, bootstrap |
| [error-handling-rules.md](.rule/error-handling-rules.md) | Error shapes, logging, status codes |
| [security-rules.md](.rule/security-rules.md) | Secrets, auth, input validation, dependencies |
| [testing-rules.md](.rule/testing-rules.md) | Test coverage and design expectations |
| [planning-rules.md](.rule/planning-rules.md) | Planning approach before implementation |
| [versioning-rules.md](.rule/versioning-rules.md) | Versioning and release conventions |
| [ui-rules.md](.rule/ui-rules.md) | UI-specific guidance |
| [style-rules.md](.rule/style-rules.md) | CSS and styling conventions |

Rule files may cross-reference each other using `[[name]]` links.

## .doc

| File | Covers |
|---|---|
| [architecture.md](.doc/architecture.md) | Service boundaries, ownership, data flow, auth/org boundaries |
| [summary-backend.md](.doc/summary-backend.md), [summary-frontend.md](.doc/summary-frontend.md), [data-model.md](.doc/data-model.md) | Plain-language summaries of the backend and frontend with the reasons behind each architectural choice, and the database diagram |
| [glossary.md](.doc/glossary.md) | Canonical domain terms used across code, API, docs, and plans |
| [product-definition.md](.doc/product-definition.md) | Product vision, target users, scope, success metrics |

## .plan

| File | Covers |
|---|---|
| [000-backlog.md](.plan/000-backlog.md) | Prioritized backlog of current and completed tasks |
| [001-2026-07-27-scaffold.md](.plan/001-2026-07-27-scaffold.md) | Scaffolding plan for the frontend and backend (done) |

## How it fits together

[AGENTS.md](AGENTS.md) is the entry point: it tells agents which `.rule` file governs each area of work, and where to find `.doc` references and `.plan` backlog state. Update the relevant file when its underlying convention or reference changes — see each file's own update triggers.
