# Review Process with an LLM (Claude Analyzer)

Status: done
Owner: Ilana
Last updated: 2026-11-02

## Goal
A review is analyzed by a real LLM (the Claude API) instead of the rule-based stub, so the user gets real style, bug, security, performance and maintainability findings, suggested refactors and generated tests in the same shapes the app already shows. The key stays on the backend, every model answer is schema-checked before it reaches the store, failures are specific and safe, and tests never call the real API.

## Scope
- Backlog item: "I want the review process to work with an LLM model." **`stack:full`** (confirmed by the user): `backend/` and `frontend/` both change. No Figma. Branch: `feat/llm-review-process` (exists, checked out).
- **What the code does today** (read 2026-11-02):
  - `backend/src/analyzer/analyzer.ts` is the narrow `Analyzer` interface: `analyze(AnalyzerInput) -> AnalyzerResult` (`qualityScore`, `findingCount`, `finding[]`, `suggestion[]`, `generatedTest[]`) and `regenerateTest(fileList, testConfig?)`. `AnalyzerInput` carries `reviewId`, `title`, `language`, `content`, the AI `preference` (review focus, strictness, explanation, generated tests; plan 028) and the review's `testConfig` (plan 034).
  - `backend/src/analyzer/stub-analyzer.ts` is the only implementation; `backend/src/index.ts` and `backend/src/app.ts` build it with `createStubAnalyzer()` (the app takes an injected `analyzer`, so tests pass fakes).
  - `backend/src/service/review.service.ts` `complete()` runs after the `202` of `POST /api/review` and `POST /api/review/{id}/run` (and on start for unfinished reviews, plan 022). An analyzer error calls `store.failReview(orgId, id, run)` and logs `review.analyze` with the error message; there is no failure reason on the review. `regenerateTest` calls the analyzer synchronously inside `POST /api/review/{id}/generated-test`.
  - The frontend polls `GET /api/review/{id}` (1 s, doubling to 30 s, stop after 5 minutes unchanged); a `failed` review shows the Failed status and the "Review failed" notification (if enabled). No UI tells the user that code is sent to an AI provider, although `.doc/product-definition.md` (Constraints) requires it.
  - `backend/src/config.ts` reads every setting from the environment object passed to `loadConfig(environment)`; there is no AI setting yet. `.doc/architecture.md` (External Dependencies, Operational Concerns) already names `ANTHROPIC_API_KEY`, timeouts, prompt-injection handling and "never log code, prompts, responses or keys".
- **In scope:**
  1. **Dependency.** Add `@anthropic-ai/sdk` to `backend/package.json` (exact version, lockfile updated; checked with `npm audit` per `.rule/security-rules.md`). The frontend gets no AI dependency.
  2. **Configuration** (`backend/src/config.ts`, `CONFIG_KEY` in `backend/src/utils/constants.ts`):
     - `ANTHROPIC_API_KEY` — optional; trimmed; blank means "not configured" (Open Question 2). Stored in `AppConfig.anthropicApiKey`, never logged, never returned by any route, never sent to the browser, never in an error message (the config error names the setting only, as today).
     - `ANTHROPIC_MODEL` — optional override of the model id (Open Question 1); default in a constant (`ANALYZER_MODEL_DEFAULT`).
     - The key is passed explicitly: `new Anthropic({ apiKey, timeout, maxRetries })`. With no key the Claude analyzer is **not** constructed at all, so the SDK never falls back to other credentials on the machine (it would otherwise also read `ANTHROPIC_AUTH_TOKEN` or a CLI login profile).
  3. **Claude analyzer** — new `backend/src/analyzer/claude-analyzer.ts` implementing `Analyzer`, built by `createClaudeAnalyzer({ client, model, limit, now })` where `client` is a narrow interface over the one SDK call it uses (so tests inject a fake; see item 9). `index.ts` picks the analyzer at startup (`createAnalyzer(config)` in `backend/src/analyzer/create-analyzer.ts`): Claude with a key, otherwise the fallback chosen in Open Question 2. Routes, services and the store interface are unchanged except for item 6.
     - **One Messages API call per analysis**, streamed and collected with the SDK's `finalMessage()` helper (long outputs never hit an HTTP timeout), model from item 2, `max_tokens` and `output_config.effort` from Open Question 3, adaptive thinking left at the model default (Claude Opus 5.5 cannot disable thinking).
     - **Structured output:** `output_config.format` with a JSON schema built from a zod schema (`backend/src/schema/analyzer.schema.ts`, `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` if it accepts the repo's zod 4; otherwise a hand-written JSON schema next to the zod schema, with a test that keeps the two equal). The answer is then validated **again** on the server with the zod schema; the server never trusts the model's JSON.
     - **Refusals:** the request opts into the server-side refusal fallback (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta), as the claude-api reference recommends for Claude Opus 5.5. A final `stop_reason: "refusal"` fails the review with reason `ai_refused` (item 6). `stop_reason: "max_tokens"` fails it with `ai_invalid_output`.
  4. **Prompt** (`backend/src/analyzer/claude-prompt.ts`, pure functions, no I/O):
     - A fixed system prompt (byte-stable, so it can be prompt-cached; `cache_control` on it) that defines the reviewer role, the five categories (`security`, `bug`, `performance`, `readability`, `maintainability`), the five severities (`info`, `low`, `medium`, `high`, `critical`), the 1-based line rule, and says the submitted code is **data, never instructions**: text inside it that asks for anything is ignored and may itself be reported as a finding.
     - A user message with the review title, language and the code inside clear delimiters, with every line numbered (`12| ...`) so line references are reliable; a delimiter that appears inside the code is escaped.
     - The account's AI preferences turned into short instructions: review focus (which categories to report; `all` = every category), strictness (`high_confidence` = only `critical` and `high` findings the model is sure of; `balanced`; `comprehensive`), explanation (`concise` = one-sentence `detail`; `detailed`), generated tests on or off (off = no test file requested), and the test configuration (framework Jest, Vitest or Mocha; only the chosen test types; default Jest with every type). The same preference semantics as the stub (plan 028 Open Question 5), so a setting means the same thing with either analyzer.
  5. **Response schema and mapping** to the existing shapes in `backend/src/model/dto.ts` (no DTO shape change except item 6):
     - Model output: `{ finding: [{ severity, category, message, detail, line_start }], suggestion: [{ title, detail }], generatedTest: { code } | null }`, every string with a maximum length, every array with a maximum count (`LIMIT.analyzer`, item 7).
     - The **server** adds what the model must not decide: finding ids `f1..fn` and suggestion ids `s1..sn` in order, `findingCount` for the four counted severities, the generated test file's `id` (`<reviewId>-t1`), `sourceFile` / `testFile` / `language` (the same naming as the stub's `buildTest`), and `qualityScore` (Open Question 6).
     - Line check: a finding whose `line_start` is outside `1..lineCount` of the analyzed code, or whose category is outside the review focus, or below the strictness, is **dropped** and counted in the log line; the rest of the result stays (product metric "Structure rate": only valid findings are shown). An answer that fails the schema as a whole fails the review (`ai_invalid_output`); nothing partial is stored.
     - `altCode` of a generated test file is the same as `code` on first analysis (Regenerate replaces it, item 8).
  6. **Failure reason** (Open Question 4): a nullable `failureReason` on every review the API returns (contract 0.14.0, additive), one of `ai_not_configured`, `ai_unavailable`, `ai_rate_limited`, `ai_timeout`, `ai_invalid_output`, `ai_refused`, `ai_quota_exceeded`, `internal`. `Store.failReview(orgId, id, run, reason)` stores it; a new run clears it. PostgreSQL: nullable `review.failure_reason text` via idempotent migration `backend/db/migration/005-failure-reason.sql` and the same `ADD COLUMN IF NOT EXISTS` in `backend/db/schema.sql` (follow the `database-schema` skill); `MemoryStore` keeps it too.
  7. **Limits, timeouts, retries and error handling** (`.rule/error-handling-rules.md`, values in `LIMIT.analyzer` in `backend/src/utils/limits.ts`, numbers from Open Question 3):
     - Per call: SDK `timeout` and an overall deadline per analysis (an `AbortSignal`), so a stuck call ends as `ai_timeout`, never as a review left `in_progress` forever.
     - Retries: transient errors only (429, 5xx, 529 overloaded, connection errors), bounded with backoff, done by the SDK's `maxRetries`. Never retried: 400, 401, 403, 404, a refusal, a schema failure.
     - SDK error mapping (typed classes, most specific first, never message matching): `RateLimitError` -> `ai_rate_limited`; `APIConnectionTimeoutError` or our deadline -> `ai_timeout`; `InternalServerError` / overloaded / `APIConnectionError` -> `ai_unavailable`; `AuthenticationError` / `PermissionDeniedError` -> `ai_unavailable` plus one `error` log line saying the key is rejected (no key text); `BadRequestError` -> `internal`; anything else -> `internal`.
     - Per-account analysis quota (in-memory, like `LIMIT.rateLimit.supportRequestOrg`, swept the same way): `POST /api/review` and `POST /api/review/{id}/run` answer **429 `rate_limited`** with `details.resetAt` when the org has used its quota (Open Question 3); the quota is checked before the review is created or re-run, so a refused request changes nothing. Reviews resumed on start (plan 022) count against the quota and fail with `ai_quota_exceeded` when it is spent.
     - Concurrency: at most `LIMIT.analyzer.concurrentCall` Claude calls at once across the backend; further analyses wait in a FIFO and the review shows `queued` while waiting (an existing status value), then `in_progress`.
     - Logging (structured, `operation: review.analyze`): `reviewId`, `org`, model, duration, `stop_reason`, token usage (`input_tokens`, `output_tokens`, cache read tokens), the Anthropic `request-id` header, dropped-finding count, failure reason. **Never** the code, the prompt, the model's answer, the key or a raw provider error body.
  8. **Regenerate generated tests** (Open Question 5): with the Claude analyzer, `regenerateTest` asks the model for a new test file per source file (same prompt rules and test configuration, the previous test passed as "write a different one"), synchronously inside `POST /api/review/{id}/generated-test`, with its own shorter deadline. The new code becomes `code` and the previous one `altCode`. Errors answer the route's standard error shape: 429 `rate_limited`, 502 `upstream_error`, 504 `upstream_timeout` (existing codes, new on this route); nothing is stored on any error (as today). Regenerate counts against the quota.
  9. **Tests — no real LLM call anywhere** (`writing-tests` skill, `.rule/testing-rules.md`):
     - `backend/tests/claude-analyzer.test.ts` with a fake client: valid answer mapped to the DTO shapes (ids, counts, test file naming, quality score); each preference and test configuration reflected in the prompt; line numbering and delimiter escaping; out-of-range / out-of-focus findings dropped; schema-invalid, `max_tokens` and `refusal` answers -> the right failure reason; every SDK error class -> the right failure reason and retry or no retry; deadline -> `ai_timeout`; log lines contain no code, prompt, answer or key (a canary secret and a canary code line are asserted absent from captured logs).
     - `backend/tests/claude-prompt.test.ts`: prompt builder snapshots per preference; a prompt-injection line in the code stays inside the delimiters.
     - `backend/tests/config.test.ts`: key optional, blank = not configured, model override, the key never in a config error.
     - `backend/tests/create-analyzer.test.ts`: key -> Claude analyzer; no key -> the Open Question 2 behaviour; the SDK is never constructed without a key.
     - Route tests (`review.test.ts`, `persistence.test.ts`, `contract.test.ts`): `failureReason` on every review response, cleared by a new run; 429 quota on create, run and regenerate; regenerate 502 / 504; `npm run test:db` for the new column; `npm run test:encrypted` still passes.
     - A guard in the Vitest setup that fails any test which tries to reach `api.anthropic.com` (and the test environment never sets `ANTHROPIC_API_KEY`).
     - Frontend unit tests: the failure-reason message map and the AI notice; e2e (`frontend/tests/e2e/`) keeps running against the backend without a key, and covers a failed review with a reason via a test analyzer or `page.route(...)`.
  10. **Frontend** (`frontend/`):
      - `failureReason` added to `frontend/src/models/dto.ts` and the review model guard (unknown values read as `internal`).
      - A failed review shows a specific, user-safe message and a recovery hint per reason (texts as constants in `frontend/src/lib/review.constants.ts`), for example "The AI service is busy. Try Run review again in a minute." — no generic "Something went wrong" (`.rule/error-handling-rules.md`). The existing Review failed notification keeps its toggle.
      - The 429 quota answer on Save/Run review and Regenerate shows a toast with the reset time (`sonner`, concise).
      - The AI notice required by the product definition (Open Question 8).
      - Tailwind utilities and existing tokens only; `lucide-react` icons reused for the same concept.
  11. **Contract** `.orchestrate/api-contract.yaml` 0.13.0 -> **0.14.0** (additive): `Review.failureReason` (nullable enum, described per value), `429 rate_limited` on `POST /api/review` and `POST /api/review/{id}/run`, `429` / `502` / `504` on `POST /api/review/{id}/generated-test`, the analyzer description updated from "stub analyzer" to "the Claude analyzer, or the fallback without a key", and whatever Open Question 2 adds to `GET /api/health`.
  12. **Docs:** `.doc/architecture.md` (Current State, analyzer section moved from "target" to built, data flow with `queued`, External Dependencies, Operational Concerns, a changelog line), `.doc/product-definition.md` (Current: plan 039, the AI provider and model, limits, the stub fallback), `.doc/glossary.md` (`Claude analyzer`, `failure reason`, `analysis quota`; update `analyzer stub` and `AI provider`), `README.md` (backend AI setup: where to put the key, cost note, what happens without it), `.rule/database-rules.md` if it lists columns.
- **Out of scope:**
  - Other providers (OpenAI, local models) and a provider switch in the UI; the `Analyzer` interface keeps that possible later.
  - A user-supplied key in the browser or in Settings; per-user billing.
  - Streaming partial results to the browser (Socket.io stays dropped, product definition).
  - Multi-file analysis in one call (each file of an import session stays its own review, plan 034), `github_url` background reviews, PR comments.
  - Running the generated tests or the submitted code (never).
  - The Batch API (reviews are interactive; a review must finish in about 30 s).

## Assumptions
- The developer supplies their own Anthropic API key in the backend env file (not committed; verify the ignore rule covers it). The agents cannot read or edit any env file (`.claude/hooks/` blocks any text with a dot followed by "env"), so the **human** adds `ANTHROPIC_API_KEY=` and `ANTHROPIC_MODEL=` to the backend example env file and to their own env file; the backend agent edits around existing environment-access lines as in plan 018 and passes values in through `loadConfig(environment)` / `createApp(...)`.
- Review content stays capped at 100 000 characters (`LIMIT.content.max`), about 25 000 to 35 000 tokens, well inside the model's context window, so no chunking is needed and nothing is truncated silently.
- One backend instance (product constraint), so the in-memory quota and concurrency limiter are enough.
- The existing statuses (`pending`, `queued`, `in_progress`, `completed`, `failed`) and the frontend polling already cover a 10 to 60 second analysis; no polling change is needed.
- The stub's preference semantics (plan 028 Open Question 5) are the reference for what each AI setting means; the Claude analyzer follows them through the prompt and the server-side filter.
- The installed Anthropic SDK supports `output_config.format`, `fallbacks` and the typed error classes named above; if a binding differs, the backend agent follows the installed SDK's documentation, not memory.

## Open Questions
1. **Provider and model.** Plan 003 (approved) chose the Claude API and named `claude-sonnet-5-5`; the current claude-api reference defaults to `claude-opus-5-5`.
   - A) **Recommended:** Claude API with **`claude-opus-5-5`** (Claude Opus 5.5, $4 / $20 per million input / output tokens) as the default, overridable with `ANTHROPIC_MODEL` without a code change.
   - B) `claude-sonnet-5-5` (Claude Sonnet 5.5, $2 / $10, faster, as plan 003 said), same override.
   - C) `claude-haiku-5-5` ($0.10 / $0.50), cheapest, weaker reviews.
   - Answer: B
2. **Behaviour when no key is configured.**
   - A) **Recommended:** keep the **stub analyzer** (today's behaviour), log one startup `warn` line ("ANTHROPIC_API_KEY not set: reviews use the stub analyzer"), add `analyzer: "claude" | "stub"` to `GET /api/health`, and show a small "Stub analyzer — no AI key configured" note on the Review page so stub findings are never mistaken for AI. Tests and local UI work keep working without a key (product definition).
   - B) No stub: every analysis fails at once with `failureReason: ai_not_configured`.
   - C) Refuse to start without a key (breaks local dev and e2e unless they set a fake).
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
3. **Cost and time limits.** Rough worst case with Opus 5.5: a 100 000-character file is about 30 000 input tokens ($0.12) plus up to 16 000 output tokens ($0.32), so at most about $0.45 per analysis; a typical 200-line snippet costs a few cents.
   - A) **Recommended:** `max_tokens` 16 000; effort `medium` (meets the "under 30 s for 200 lines" metric); SDK timeout 90 s per call, `maxRetries` 2, overall deadline 180 s per analysis and 60 s per regenerate; at most 3 Claude calls at once; **20 analyses (including regenerates) per account per hour**.
   - B) Same, with effort `high` (better reviews, slower and dearer; may miss the 30 s metric).
   - C) Same as A, with no per-account quota (only the concurrency cap).
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
4. **Failure reason in the API.**
   - A) **Recommended:** add the nullable `failureReason` enum to the review (contract 0.14.0, additive, new nullable column), so the page can say why it failed and what to do.
   - B) No contract change: a failed review stays a bare `failed`; the reason is only in the server log.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
5. **Regenerate generated tests with the LLM.**
   - A) **Recommended:** Regenerate asks Claude for a new test (synchronous, 60 s deadline, counts against the quota, 429 / 502 / 504 on failure); the previous test becomes `altCode`.
   - B) Keep Regenerate deterministic (swap `code` and `altCode`), so it never costs a call; the first analysis then asks for two variants.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
6. **Quality score source.**
   - A) **Recommended:** the server computes it from the kept findings with the stub's severity weights (`STUB_SEVERITY_WEIGHT`, renamed `SEVERITY_WEIGHT`), so scores are consistent, explainable and comparable across reviews on the Dashboard.
   - B) The model returns a 0 to 100 score (validated), which can differ between runs of the same code.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
7. **Reviews resumed on start.** Plan 022 re-analyzes unfinished reviews when the backend starts; with the LLM this costs calls.
   - A) **Recommended:** keep resuming, through the same concurrency limiter and quota (a review over the quota fails with `ai_quota_exceeded`).
   - B) Mark them `failed` (`internal`) on start instead; the user presses Run review again.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)
8. **AI notice in the UI** (required by the product definition: code is sent to a third-party AI provider).
   - A) **Recommended:** one short line under the Run review / Save review buttons ("Code is sent to Anthropic's Claude API for analysis. Do not submit secrets.") with an info icon, shown only when the analyzer is `claude` (from `GET /api/health`), plus the same sentence in the Help page.
   - B) A one-time dismissible dialog before the first review of each account.
   - Answer: A (recommended; taken from the approval of 2026-11-02, not typed by the user)

## Steps
1. **Contract** (backend agent writes it first): bump `.orchestrate/api-contract.yaml` to 0.14.0 with Scope item 11, per the answers to Open Questions 2, 4 and 5.
2. **Backend config and dependency:** add `@anthropic-ai/sdk` (exact version); `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in `config.ts` / `CONFIG_KEY`; `LIMIT.analyzer` in `limits.ts`; the human adds the two keys to the backend example env file (agents cannot touch env files).
3. **Analyzer schema and prompt:** `backend/src/schema/analyzer.schema.ts` (zod + JSON schema for `output_config.format`), `backend/src/analyzer/claude-prompt.ts` (system prompt, numbered and delimited code, preferences, test configuration).
4. **Claude analyzer:** `backend/src/analyzer/claude-analyzer.ts` (narrow client interface, one streamed call, `finalMessage()`, refusal fallback, deadline, error mapping to failure reasons, mapping and filtering to the DTO shapes, quality score per Open Question 6, safe logging), `backend/src/analyzer/create-analyzer.ts` (Open Question 2), wired in `backend/src/index.ts`; an `AnalyzerError` carrying a failure reason.
5. **Service, store and limits:** `failReview(..., reason)` and the cleared reason on a new run (`store.ts`, `memory-store.ts`, `pg-store.ts`, `pg-schema.ts`), migration `005-failure-reason.sql` + `schema.sql`; per-org analysis quota and the concurrency limiter (`queued` while waiting) in `review.service.ts` / `lib/rate-limit.ts`; regenerate errors mapped to 429 / 502 / 504 (Open Question 5); resume behaviour (Open Question 7); the `GET /api/health` analyzer field if Open Question 2 is A.
6. **Backend tests** (Scope item 9) including the network guard; `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:encrypted` all pass.
7. **Frontend:** `failureReason` in the DTO and model guard; failed-review messages and hints; quota toast; the AI notice and the stub note (Open Questions 2 and 8); Help page text; frontend unit and e2e tests.
8. **Docs:** Scope item 12.
9. **QA:** run the Validation list. A manual smoke test with a real key is done by the human only (never in CI or by an agent).

## Validation
1. `cd backend && npm run typecheck && npm test` passes, and no test reaches `api.anthropic.com` (the Vitest network guard fails any such test; `ANTHROPIC_API_KEY` is unset in every test run).
2. `backend/tests/claude-analyzer.test.ts`: a valid fake answer becomes an `AnalyzerResult` whose every finding has a valid `category`, `severity` and an in-range `line_start`, ids `f1..fn` / `s1..sn`, `findingCount` for the four counted severities, and the test file named like the stub's.
3. Same file: an out-of-range `line_start`, an out-of-focus category and (with `high_confidence`) a `medium` finding are dropped; the other findings are kept.
4. Same file: a schema-invalid answer, `stop_reason: "max_tokens"` and `stop_reason: "refusal"` fail with `ai_invalid_output`, `ai_invalid_output` and `ai_refused`; nothing is stored for them (route test: review `failed`, `finding: []`).
5. Same file: `RateLimitError`, `APIConnectionTimeoutError`, `InternalServerError`, `APIConnectionError`, `AuthenticationError`, `BadRequestError` and the overall deadline map to the failure reasons in Scope item 7; 400 / 401 / refusal / schema failures are not retried (fake client call count is 1), 429 / 5xx are retried at most `maxRetries` times.
6. Same file: captured log lines contain the review id, model, token usage and failure reason, and never the canary key, a canary code line, the prompt or the answer.
7. `backend/tests/claude-prompt.test.ts`: each review focus, strictness, explanation, generated-tests setting and test configuration (Jest, Vitest, Mocha; each test type) appears in the prompt; the code is line-numbered inside delimiters; an injected "ignore previous instructions" line and a fake closing delimiter stay inside the code block.
8. `backend/tests/config.test.ts` and `create-analyzer.test.ts`: the key is optional, blank means not configured, `ANTHROPIC_MODEL` overrides the default, no config error contains the key, and without a key the SDK client is never constructed (Open Question 2 behaviour asserted).
9. Route tests: every review response has `failureReason` (`null` unless `failed`); a new run clears it; the 21st analysis of an org within an hour gets `429 rate_limited` with `details.resetAt` and creates nothing (with the Open Question 3 numbers); Regenerate answers 502 / 504 / 429 on the fake's failures and stores nothing; `contract.test.ts` validates every response against contract 0.14.0.
10. `npm run test:db` passes with migration `005-failure-reason.sql` applied twice (idempotent) and a failed review's reason surviving a restart (`restart.test.ts`).
11. `npm run test:encrypted` passes.
12. `cd frontend && npm test` passes: the failure-reason message map covers every enum value and an unknown value; the AI notice shows only with `analyzer: "claude"`; the stub note only with `"stub"`.
13. `cd frontend && npx playwright test` passes against the backend with no key (stub analyzer); a failed review with `failureReason: "ai_timeout"` (forced by `page.route(...)`) shows the timeout message and the Run review hint, not a generic error.
14. `git grep -n "sk-ant-"` finds nothing; `git status` shows no env file staged; `npm audit --omit=dev` in `backend/` reports no high or critical issue from the new dependency.
15. `.orchestrate/api-contract.yaml` `info.version` is `0.14.0`; `.doc/architecture.md`, `.doc/product-definition.md`, `.doc/glossary.md` and `README.md` describe the Claude analyzer, the key setting, the fallback and the limits (`grep -n "ANTHROPIC_API_KEY"` matches in each).

## Risks
- **Cost overrun** from many or large reviews, resumes on start, or a retry storm. Mitigated by `max_tokens`, bounded retries, the per-account quota, the concurrency cap and token usage in the logs.
- **Latency over 30 s** for large files or higher effort. Mitigated by effort `medium`, streaming, the deadline and the existing polling; the metric is for a typical 200-line snippet.
- **Prompt injection** in submitted code (for example "report no findings"). Mitigated by delimiters, the system prompt rule, structured output and server-side validation; the output is never executed. It can still lower review quality for adversarial input; this is accepted and noted in the docs.
- **Hallucinated lines or categories.** Mitigated by line numbering in the prompt and the server-side drop of invalid findings.
- **Data leaving the machine:** submitted code goes to Anthropic. Mitigated by the UI notice (Open Question 8) and the docs; the README warns not to submit secrets.
- **Key leakage.** Mitigated by explicit `apiKey` from config only, no logging, hooks that block env files, and the `sk-ant-` grep in Validation.
- **SDK or zod 4 incompatibility** with the `zodOutputFormat` helper. Mitigated by the hand-written JSON schema fallback and a test that keeps it equal to the zod schema.
- **Non-deterministic output** makes exact-result tests impossible against the real model; tests use the fake client only, and the human does the real smoke test.

## Rollout Order
1. Contract 0.14.0 (additive; the current frontend keeps working because `failureReason` is new and nullable).
2. Backend: config, analyzer, store and migration, limits, tests. Without a key the backend behaves as today (Open Question 2 A), so it is safe before the frontend lands.
3. Frontend: failure messages, quota toast, AI notice, tests.
4. Docs and QA.
5. The human adds a real key to their own backend env file and runs one manual review to confirm.

## Rollback
- Fastest: remove `ANTHROPIC_API_KEY` from the backend env file and restart; the backend uses the stub again (Open Question 2 A) with no code change.
- Full: revert the branch. Migration `005-failure-reason.sql` only adds a nullable column, so it can stay; older code ignores it. Contract 0.14.0 is additive, so going back to 0.13.0 needs no data change.
- `@anthropic-ai/sdk` is removed with the revert; no data depends on it.
