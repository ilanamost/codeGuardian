# Real GitHub Repositories in the Wizard's "Select Repository" Step

Status: done
Owner: Ilana
Last updated: 2026-10-29

## Goal
- The GitHub Integration wizard stops showing mock data (with the real backend). The user connects a real GitHub account, sees that account's real repositories in "Select Repository", picks one, and in step 2 picks a real file, whose code opens in the editor.
- Mock mode (`VITE_DATA_SOURCE=json`) keeps the mock wizard exactly as today.
- Nothing changes for the pasted-link import (plan 023), except that it shares the same GitHub client and rate limit.

## Scope
- Backlog item 1, marked `stack:full`. No Figma. Branch: `feat/real-github-repository-selection` (created).
- **What the code does today** (read 2026-10-29):
  - `POST /api/github/connect` flips a stored "connected" flag and returns the mock account (`backend/src/store/github-mock.ts`, `backend/src/data/github.json`).
  - `GET /api/github/repo?query=`, `GET /api/github/repo/{repoId}/file` and `.../file/{fileId}` are answered from that mock, in `backend/src/service/github.service.ts`.
  - The real GitHub client (`backend/src/lib/github-fetch.ts`, plan 023) already exists: constant `api.github.com` host, strict path checks, no redirects, byte-limited bodies, per-call and overall timeouts, language table, and the `rate_limited` / `upstream_error` / `upstream_timeout` mapping. It sends no credentials.
  - Frontend: `GithubWizardPage`, `GithubConnectCard`, `RepoList`, `FileList`, `github.slice.ts` and `github.service.ts` already call these routes through the data source, so the wizard UI needs few changes.
- **In scope** (assuming the recommended answer to Open Question 1, connect by GitHub user name):
  1. **Connect** (`POST /api/github/connect`, body `{ username }`, strict zod): the user name is checked against GitHub's pattern (1 to 39 characters, letters, digits and single hyphens, no leading or trailing hyphen), then `GET /users/{username}` proves the account exists. The stored connection keeps the GitHub `login` and the display name; the response is the `GithubAccount` (`login`, `name`, `avatarUrl` only if the shape needs it). A missing user is 404; the email is not shown, since GitHub does not expose one without a token (the card shows the user name instead, see the frontend item).
  2. **Repository list** (`GET /api/github/repo?query=`): `GET /users/{login}/repos?per_page=100&sort=updated&type=owner`, one page, filtered by name on the server (case-insensitive contains), capped at 100 repositories. A response carries `truncated: true` when the account has more, so the UI can say so. The `repoId` is the repository **name** (owner is always the connected login), checked against GitHub's repository-name pattern.
  3. **File list** (`GET /api/github/repo/{repoId}/file`): `GET /repos/{login}/{repo}/git/trees/{default_branch}?recursive=1`, keep only blob entries with an extension in the language table (the one from plan 023), skip files over the single-file limit by their `size`, and cap the list at 500 files (`truncated` flag, same idea as above). The `fileId` is the base64url of the file path, decoded once and rejected by the same path rules as plan 023 (`..`, backslash, NUL, empty segment).
  4. **File content** (`GET /api/github/repo/{repoId}/file/{fileId}`): the same contents call and byte-limited reader that the link import uses, at the repository's default branch. Same limits and errors as plan 023.
  5. **Disconnect** ("Switch account") clears the stored login. After a backend restart the connection survives (it is user state in the store, like today's flag).
  6. **Storage.** The org's GitHub connection row gets the `login` (and display name). This is a small migration in `backend/src/store/` following `.rule/database-rules.md`; `MemoryStore` gets the same field. Existing rows stay "not connected".
  7. **Tests without network.** `GITHUB_FAKE=true` (plan 023) is extended: the fake answers the user, repos, tree and contents calls for a fixed user (`example-user`), so e2e and unit tests never reach `api.github.com`. Mock data in `github.json` stays for mock mode only.
  8. **Frontend.**
     - `GithubConnectCard` gets a user-name field (with client-side validation, the same pattern) before the Connect button, and shows the connected user name instead of an email.
     - `RepoList` and `FileList` show a "Showing the first N" note when `truncated`, and an empty state when the account has no public repositories.
     - Toasts per error code use the existing constants; new constants only for new messages (user not found, list truncated).
     - The data source stays the switch: API data source calls the real routes, the JSON data source keeps the mock wizard.
  9. **Contract and docs.** `.orchestrate/api-contract.yaml` 0.9.0 (see Open Question 4 for additive vs breaking); `.doc/architecture.md` (GitHub client now also serves the repository routes), `.doc/glossary.md` (`github connection`, `truncated list`), `.doc/product-definition.md` (the wizard moves from mock to real for public repositories; OAuth and private repositories stay out of scope), `README.md` (rate limit now shared by link import and the wizard).
- **Out of scope:**
  - GitHub OAuth, access tokens, private repositories and organizations' private repos (backlog item 3). The design must not block it: the GitHub client takes an optional `Authorization` value that is `undefined` today.
  - Pagination of repositories beyond 100 and files beyond 500.
  - Caching of GitHub responses.
  - Reviewing a repository as a whole (the wizard still imports one file into the editor).
  - Any change to review, finding or dashboard shapes.

## Assumptions
- The unauthenticated GitHub REST API is reachable from the backend and allows 60 requests an hour per server IP, shared by every user of this local app. A wizard session costs about 4 calls (user, repos, tree, file) and a repository search costs 1 (done server-side on the same fetched page, see Risks for re-fetching).
- Public repositories are enough for this task (the product definition keeps private repositories out of scope).
- The `login` returned by `GET /users/{username}` is trusted only after the same pattern check; the host stays the constant `api.github.com`, and no URL from a response (`html_url`, `clone_url`, `avatar_url`) is ever fetched. `avatar_url` may be shown as an image only if it is on `avatars.githubusercontent.com` (checked), otherwise initials are used.
- Repository names, file paths and file contents from GitHub are untrusted text: rendered as text, never executed.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **What does "a real GitHub account" mean for connecting?**
   - A. **Connect by GitHub user name, public repositories only (recommended).** No secret is stored and no OAuth app is needed. The user types their GitHub user name; the app lists that account's public repositories. Fits the current product scope and leaves OAuth to its own backlog item, which can then add private repositories on top of this.
   - B. **Personal access token pasted by the user.** Gives private repositories and a 5 000/hour rate limit, but the app must store a secret per account (encrypted at rest), the token appears in a form field, and it expands the security surface a lot. Conflicts with "OAuth is later".
   - C. **Do GitHub OAuth now** (merge with backlog item 3). Real "Connect GitHub" button and private repositories, but it needs an OAuth app (client id and secret), a callback route, token storage and refresh, and is a much larger plan.

   **Answer:**

2. **Which repositories are listed?**
   - A. **Repositories owned by the user, most recently updated first (recommended).** `type=owner`, up to 100.
   - B. Also repositories the user contributes to or belongs to through an organization (`type=all`).

   **Answer:**

3. **Which branch does the file step read?**
   - A. **The repository's default branch (recommended).** Matches what the user sees on GitHub.
   - B. Let the user pick a branch in step 2 (one more call and one more control).

   **Answer:**

4. **Contract versioning.** The route paths stay the same, and `truncated` is a new field.
   - A. **Additive 0.9.0 (recommended).** `truncated` is added to the repo and file list responses, which then become `{ items, truncated }`. This changes the response shape of two routes, so call it a minor-version change with the frontend and backend released together (they are one app).
   - B. Keep the lists as plain arrays and send `X-Truncated: true` in a response header. No body change, but the header must be exposed to the browser and is easier to miss.

   **Answer:**

5. **Rate-limit relief.** Sixty calls an hour is shared by the whole local app.
   - A. **No cache; show the clear 429 with the reset time (recommended).** Simple, and consistent with plan 023.
   - B. Cache repository and tree responses in memory for 60 seconds, which cuts calls when the user searches or goes back and forth in the wizard.

   **Answer:**

**Answers (approved 2026-10-29, recommended options; no inline answers were found in this file):**
- 1: A. Connect by GitHub user name, public repositories only.
- 2: A. Repositories owned by the user, most recently updated first, up to 100.
- 3: A. The repository's default branch.
- 4: A. Additive 0.9.0; the list responses become `{ items, truncated }`.
- 5: A. No cache; a clear 429 with the reset time.

## Steps
1. Branch `feat/real-github-repository-selection` (done).
2. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend, Backend and QA tickets (Todo), Backend to In Progress. Write `.orchestrate/tickets.json`.
4. Backend agent, reading `.orchestrate/api-contract.yaml` after the contract update:
   - contract (0.9.0) and error codes first;
   - user-name pattern and file-id codec (pure functions with table tests);
   - extend the GitHub client: user, repos, tree and contents calls, with the existing limits, timeouts and redirect refusal;
   - connection storage and migration (`PgStore`, `MemoryStore`);
   - service and routes switched from the mock to the client; mock data kept for mock mode only;
   - extend the `GITHUB_FAKE` fake;
   - docs and README.
5. Frontend agent: model and DTOs, user-name field, truncated notes, empty state, constants, JSON data source unchanged, unit and e2e tests.
6. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
7. Your final approval in Linear; plan to `done`, backlog item ticked.

## Validation
- `cd backend && npm test` and `npm run typecheck` pass; `cd frontend && npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run test:e2e` pass. No test calls the real network.
- User name (unit table): accepted `octocat`, `a`, `a-b`, a 39-character name; rejected empty, 40 characters, leading or trailing hyphen, `--`, spaces, `/`, `..`, unicode, NUL. A rejected name gets 422 and makes no GitHub call.
- Connect: an existing fake user returns the account and is stored; an unknown user returns 404 and nothing is stored; the connection survives a backend restart (PostgreSQL) and is per account (a second account is not connected).
- Repositories: the fake user's repositories are listed, filtered by name case-insensitively, newest first; over 100 returns `truncated: true`; an account with none returns an empty list; the response never contains a field from GitHub that the contract does not list.
- Files: only supported extensions are listed; a file over the single-file limit is left out; over 500 entries returns `truncated: true`; a file id that decodes to a path with `..`, a backslash, a NUL or an empty segment gets 422.
- Content: a listed file returns its text; a file over the limit by declared `size` makes no body request, and by streamed bytes with a lying `size` is cut off; both answer 413 with the limit named in `details`.
- SSRF (unit): every fake `fetch` call goes to `https://api.github.com`; a 301/302/307 to any host (including `169.254.169.254` and `localhost`) is refused and not followed; `html_url`, `clone_url`, `avatar_url` and `download_url` are never fetched.
- Errors: GitHub 5xx gives 502, a stalled call gives 504, the unauthenticated limit gives 429 with the reset time; each shows its constant toast in the wizard.
- Auth: every changed route still returns 401 without a session, and one account never sees another account's connection.
- Mock mode (e2e): with `VITE_DATA_SOURCE=json` the wizard shows the mock account and repositories as before, and the user-name field is not shown.
- API mode (e2e, `GITHUB_FAKE=true`): type the fake user name, connect, see the real-shaped repository list, search, select one, see its files, import one and see the code in the editor as a new unsaved review; "Switch account" returns to the connect card.
- Contract: every changed operation has at least one test; `api-contract.yaml` version is 0.9.0.
- Manual and QA: with the backend on the real GitHub API, connect with a real public user name, list the repositories, open one, and import a file.

## Risks
- **Rate limit (60 per hour per server IP)** is reached quickly during manual QA, especially with search typing. Mitigation: search filters the fetched page on the server only once per connect-session if Open Question 5 is B; otherwise the frontend debounces the search and QA is told to expect 429s. A clear 429 with the reset time is shown.
- **User expectation of "my account".** A user name proves nothing about who is typing it, so anyone can list anyone's public repositories. That data is already public, but the card must say "public repositories only". Mitigation: wording in the card and the README; OAuth (item 3) is the real fix.
- **SSRF or path tricks via user name, repository name, or file id.** Mitigation: strict patterns on all three, a constant API host, no redirects, no URL from a response, and the hostile-input table tests.
- **Memory or time abuse** by huge trees or files. Mitigation: caps (100 repositories, 500 files), `size` pre-check, byte counter and timeouts.
- **Response-shape change to the list routes** (Open Question 4 A) breaks any client built on 0.8.0. Mitigation: the frontend and backend are one app and are tested together; the JSON data source is updated in the same plan.
- **Migration on an existing database.** Mitigation: an additive nullable column, a migration test on a populated database, and a documented rollback.

## Rollout Order
1. Contract, error codes, and the pure functions (user-name pattern, file-id codec).
2. GitHub client calls with the extended fake.
3. Storage and migration, then service and routes.
4. Frontend wiring, then the card, lists and notes.
5. Docs.
6. QA, including the manual real-API check.
7. Before the manual check (and on any existing database), run `npm run db:setup` in `backend/` and restart the backend. This applies migration `003-github-login.sql`; a backend running on a database without it answers 500 on `POST /api/github/connect`. `npm run dev` and `npm start` do it automatically, so it is only needed when the backend was already running or was started another way.

## Rollback
- Revert the branch. The only persistent changes are the nullable `login` and `display_name` columns on the GitHub connection row; leaving it in place is harmless, and a down migration drops it. The routes return to the mock, and the pasted-link import is untouched.
