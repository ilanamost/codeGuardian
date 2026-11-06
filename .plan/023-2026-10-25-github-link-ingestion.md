# GitHub Link Ingestion (Public File and PR URLs)

Status: done
Owner: Ilana
Last updated: 2026-10-26

## Goal
- A user pastes a public GitHub file link (`https://github.com/<owner>/<repo>/blob/<ref>/<path>`) or pull-request link (`https://github.com/<owner>/<repo>/pull/<n>`), and the code appears in the editor, ready to review.
- The backend never fetches the URL the user typed. It parses the link, checks every part, and calls the official GitHub REST API (`api.github.com`) with a URL it builds itself.
- The backend enforces limits while it retrieves the content: one source file, total code for a review, files in a PR, and request timeout.

## Scope
- The backlog item has no `stack:full` marker, but the work is mostly backend and needs one small frontend entry point, so it runs as **stack:full** (your answer, 2026-10-25). No Figma. Branch: `feat/github-link-ingestion`.
- In scope:
  1. **Link parser** (`backend/src/lib/github-url.ts`). Pure function, no network.
     - Accepts only `https`, host exactly `github.com` (no `www`, no port, no user info, no fragment tricks), path `/<owner>/<repo>/blob/<ref>/<path>` or `/<owner>/<repo>/pull/<n>` (an optional trailing `/files` is accepted).
     - `owner`, `repo` and `<n>` are checked against strict patterns; `<path>` is decoded once and rejected if it holds `..`, a backslash, a NUL or an empty segment. Anything else is a 422 with a clear message.
  2. **GitHub client** (`backend/src/lib/github-fetch.ts`, as named in `.doc/architecture.md`).
     - Calls only `https://api.github.com/repos/...` built from the parsed parts. The host is a constant, never taken from input or from a response.
     - File: `GET /repos/{owner}/{repo}/contents/{path}?ref={ref}`. PR: `GET /repos/{owner}/{repo}/pulls/{n}` and `.../pulls/{n}/files` (paged), then each changed file's content from the contents API at the PR head commit.
     - Sends no credentials. Redirects are not followed (`redirect: 'manual'`; any 3xx is an error). Response `Content-Type` and the `size` field are checked before the body is read; the body is read through a byte counter that aborts at the limit.
     - Every call has a timeout (`AbortSignal.timeout`) and the whole ingestion has an overall deadline.
  3. **Limits** in `backend/src/utils/limits.ts` (values in Open Question 3), enforced while retrieving: the declared `size` is checked first, then the streamed bytes, then the running total, then the file count. The first limit hit stops the work and no more calls are made.
  4. **Endpoint** `POST /api/github/import` (Open Question 1), body `{ url }`, strict zod schema. Response: `{ name, language, content, fileList: [{ path, language, size }], skippedList: [{ path, reason }] }`. For a PR the files are joined into one `content` (Open Question 2).
  5. **Errors** use the standard error shape. Reuse `validation_error` (bad link), `not_found` (missing or private repo, file or PR: GitHub answers 404 for private), `payload_too_large` (any size limit). New codes only if no existing one fits: `upstream_error` (GitHub failed or sent something unexpected, 502), `upstream_timeout` (504), `rate_limited` (GitHub's unauthenticated limit, 429). Messages never include the token-less request headers, the full response body or the raw upstream text.
  6. **Language detection** from the file extension, through one table that also drives which files a PR import keeps. Binary, deleted, renamed-without-change, symlink and submodule entries, and extensions not in the table, go to `skippedList` with a reason instead of failing the import. A single `blob` link to an unsupported file is a 422 `Unsupported file type`.
  7. **Frontend** (small): a "Paste a GitHub link" field on the GitHub Integration page, above the wizard and usable without connecting. It validates the shape client-side for fast feedback, calls the import thunk, and on success opens the code in the editor as a new unsaved review, exactly like the wizard's existing import (plan 019, Open Question 3). Failures show a `sonner` toast with the constant text for the mapped code; skipped files and the limits used are shown in the success toast. Reuses the existing `importGithubFile` flow and `github.service` / `github.slice`; adds the model, service method and constants. The JSON data source gets a matching method that returns the seeded mock content for a fixed example link (no network from the browser).
  8. **Contract and docs.**
     - `.orchestrate/api-contract.yaml`: the new operation, schemas, error codes and the limits; version 0.6.0 to 0.7.0 (additive).
     - `.doc/architecture.md` (the "later tasks" `github-fetch` entry becomes real, and the SSRF checks are listed), `.doc/glossary.md` (`github import`, `skipped file`), `.doc/product-definition.md` (link import moves from target to current), `.rule/security-rules.md` only if a rule needs a refinement.
     - `README.md`: the new limits and that GitHub's unauthenticated rate limit (60 requests an hour) applies.
  9. **Tests.** No real network in any test (product definition).
     - Unit: the parser against a table of valid and hostile links; the client against a fake `fetch`; every limit at, below and above its boundary; timeout; redirect refusal; oversize declared and oversize streamed; bad JSON; unexpected host in a response field; the route and error mapping.
     - Frontend unit: the field, the thunk, toasts per error code, both data sources.
     - E2E (Playwright): paste a link with the backend's fake GitHub client, see the code in the editor; each error toast.
- Out of scope:
  - GitHub OAuth, private repositories, and a `GITHUB_TOKEN` (the separate backlog item).
  - Submitting a link directly as a review without opening it in the editor first (Open Question 1).
  - Folder (`tree`), commit, compare, raw (`raw.githubusercontent.com`) and gist links.
  - Caching of fetched content.
  - Changing review, finding or dashboard shapes.

## Assumptions
- The unauthenticated GitHub REST API is reachable from the backend and allows 60 requests an hour per IP. A PR of N files costs about N + 2 calls, so the file limit also protects the rate limit.
- Commits of a PR from a fork can be read through the base repository by commit SHA. This is verified once by hand against a real public fork PR before QA, and the fake in the tests records the same call sequence. If it fails, the client reads the head repository named by `pulls/{n}`, validated with the same owner and repo patterns.
- Node 20+ `fetch` is used; no new dependency is added.
- Submitted and fetched code is untrusted data: stored and returned as text, never executed or rendered as HTML.

## Open Questions
Answer inside this file (below each question). The recommended answer is used if you only write "approved".

1. **How is a link submitted?**
   - A. **Import first (recommended).** `POST /api/github/import` returns the code, which opens in the editor; you can edit it and then run the review as today (`source_type` stays `snippet`). Errors are immediate (422, 404, 413) and the code is visible before anything is sent to the AI provider.
   - B. Create the review straight from the link: `POST /api/review` with `source_type: github_url`. The fetch happens in the background, so a bad link or a limit becomes a `failed` review and the user cannot look at or edit the code first.

   **Answer:**

2. **How are PR files shown as one review?** A review holds one `content` and one `language`.
   - A. **Join the files into one text (recommended)**, each file starting with a header comment line in the file's own comment style (`// ===== src/a.ts =====`), `language` is the most common one among the kept files, and finding line numbers refer to the joined text.
   - B. Import only the first file and list the rest as skipped.
   - C. One review per file (multiple reviews from one import).

   **Answer:**

3. **Limit values.** The backlog names four limits but no numbers.

   | Limit | Recommended | Note |
   |---|---|---|
   | Single source file | 50 000 characters | The review `content` cap is 100 000; half of it leaves room for a second file |
   | Total code submitted for review | 100 000 characters | Same as `LIMIT.content.max`, so the joined PR always fits a review |
   | Files in a PR review | 20 | Also keeps the rate-limit cost low |
   | Request timeout | 10 s per GitHub call, 30 s for the whole import | |

   Values live in `LIMIT` (one place) and are returned in the 413 `details` so the UI can say which limit was hit. **Answer** (approve or give numbers):

4. **PR links with slashes in the branch name** (`.../blob/feature/x/src/a.ts`) are ambiguous: `feature/x` or `feature`?
   - A. **Reject with a clear message and ask for a commit link (recommended).** Supports branch names without `/`, tags, and 40-character commit SHAs. No guessing, and no extra API calls.
   - B. Try each possible split (at most 4 extra calls).

   **Answer:**

5. **Rate limit handling.** When GitHub answers that the unauthenticated limit is used up:
   - A. **Return 429 `rate_limited` with the reset time (recommended).**
   - B. Wait and retry inside the request (risks the timeout).

   **Answer:**

**Answers (approved 2026-10-25, recommended options; no inline answers were found in this file):**
- 1: A. `POST /api/github/import` returns the code into the editor; `source_type` stays `snippet`.
- 2: A. PR files are joined into one text with header comment lines.
- 3: single file 50 000 characters; total 100 000 characters; 20 files in a PR; 10 s per GitHub call and 30 s overall.
- 4: A. Reject branch names with `/` with a clear message and ask for a commit link.
- 5: A. 429 `rate_limited` with the reset time.

## Steps
1. Branch `feat/github-link-ingestion` (done).
2. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend, Backend and QA tickets (Todo); Backend to In Progress. Write `.orchestrate/tickets.json`.
4. Backend agent, reading `.orchestrate/api-contract.yaml` after the contract update:
   - contract and error codes first;
   - link parser and its table test (unit suite green);
   - GitHub client with the fake `fetch`, limits and timeouts;
   - service, route, schema and the fake client wiring for tests (`app.ts` takes the client as a dependency);
   - docs and README.
5. Frontend agent: model, service (API and JSON data sources), slice thunk, the link field, constants, toasts, unit and e2e tests.
6. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
7. Your final approval in Linear; plan to `done`, backlog item ticked.

## Validation
- `cd backend && npm test` and `npm run typecheck` pass; `cd frontend && npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run test:e2e` pass. No test calls the real network.
- Parser table (unit): these are accepted: a `blob` link with a branch, a tag and a 40-hex SHA; a `pull` link with and without `/files`. These are rejected with 422: `http://`, `github.com.evil.com`, `www.github.com`, `user@github.com`, a port, `raw.githubusercontent.com`, `gist.github.com`, `/tree/`, `/commit/`, a path with `..`, `%2e%2e`, `%2f` tricks, a backslash, a NUL, an empty segment, a missing repo, a non-numeric PR number, a link over 2 000 characters.
- SSRF (unit): the client only ever calls the constant `https://api.github.com` host (asserted on every fake `fetch` call); a 301/302/307 to any host (including an internal address such as `169.254.169.254` or `localhost`) is refused and not followed; a response field naming another host (`download_url`, `html_url`, a fork's `clone_url`) is never fetched.
- Limits (unit, each at limit minus one, at the limit and at limit plus one): a file over the single-file limit by declared `size` (no body request is made) and by streamed bytes with a lying `size`; the total across PR files; 21 files in a PR; a stalled response hits the per-call timeout and a slow sequence hits the overall deadline. Each over-limit case answers 413 with the limit named in `details`, and stops further calls.
- Rejections: private or missing repo or file gives 404 without saying which; unsupported extension on a `blob` link gives 422; a PR with a mix of kept, binary and deleted files imports the kept ones and lists the others in `skippedList`; GitHub 5xx gives 502; rate limit gives 429 with the reset time.
- Security: no log line or error body contains the typed URL's query text, upstream response bodies or headers; the fetched code is returned as text and not executed (no `eval`, import or shell with it); the route rejects unknown body fields (422) and a body over the existing body limit (413).
- Frontend: the field validates the shape before sending; each error code shows its constant toast; success opens the code in the editor as a new unsaved review, and Run Review then works as today; skipped files are listed; both data sources behave the same for the example link.
- Contract: every new operation and error code has at least one test; `api-contract.yaml` version is 0.7.0.
- Manual and QA: with the backend on the real GitHub API, import one public `blob` link and one small public PR, and see the code in the editor.

## Risks
- **SSRF through a clever link or a redirect.** Mitigation: a constant API host, strict parsing, no redirects, no URL taken from a response, and the hostile-link table test.
- **Rate limit (60 per hour per IP)** is reached quickly during QA. Mitigation: the file limit, the fake client in all automated tests, a clear 429, and a README note.
- **Memory or time abuse by huge files or slow responses.** Mitigation: the `size` pre-check, a streamed byte counter, per-call and overall timeouts.
- **Prompt injection in fetched code.** Mitigation: it is untrusted text, delimited and validated by the analyzer layer, as for pasted code (`.rule/security-rules.md`).
- **Fork PR content not readable through the base repository.** Mitigation: the one-time manual check and the validated head-repository fallback in Assumptions.
- **Joined PR text confuses line numbers.** Mitigation: the header lines make file boundaries visible (Open Question 2); a later plan can add per-file reviews.

## Rollout Order
1. Contract, error codes, limits.
2. Parser, then the GitHub client with the fake.
3. Service and route.
4. Frontend field and wiring.
5. Docs.
6. QA, including the manual real-API check.

## Rollback
- Revert the branch. No database change and no change to existing review, finding or dashboard shapes; the new route and the field disappear together. The wizard's mock import is untouched.
