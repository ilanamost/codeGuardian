# Re-base the Project on the AI Code Reviewer & Quality Dashboard Concept

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Outcome (2026-10-19)
Approved with all recommended answers (Node/TypeScript, Claude API, in-memory store, public GitHub URLs only, REST-only, dashboard by category/severity, delete chat code in the implementation plan). Docs, glossary, contract, agent roles, README, security/database rules, and backlog updated. Routes follow the singular convention (`/api/review`, `/api/dashboard`). `backend/` and `frontend/` untouched.

## Goal
Replace the WhatsApp-clone framing across docs, rules, agent roles, and the API contract with the
**AI Code Reviewer & Quality Dashboard** concept: a web app where developers submit code snippets
(or GitHub links) and an AI agent returns a style review, bug detection, security warnings,
suggested refactors, and auto-generated tests.

This plan covers the **documentation, contract, and agent-role layer** (the backlog item:
"update the relevant files according to the project concept"). Building the app itself is a
separate follow-up plan.

## Scope
- In scope (files to update):
  - `.doc/product-definition.md` — new vision, users, scope, success metrics, constraints.
  - `.doc/glossary.md` — new domain terms (`review`, `finding`, `snippet`, `suggestion`, `generated test`, ...), WhatsApp terms removed.
  - `.doc/architecture.md` — React + Monaco frontend, API backend, AI analysis service, review data flow.
  - `.orchestration/api-contract.yaml` — new endpoints replacing conversation/message/socket events.
  - `.agents/{orchestrator,frontend,backend,qa}/AGENT.md` — retarget to the new domain.
  - `README.md` — title, description, run/test notes, layout table.
  - `.rule/database-rules.md` and `.rule/security-rules.md` — only where the concept changes them (stored code, AI-provider key, GitHub OAuth token, prompt injection from submitted code).
  - `.plan/000-backlog.md` — tick the item, split the concept into follow-up backlog items.
- Out of scope: changing `backend/` and `frontend/` source, tests, or dependencies (follow-up plan); removing the old chat code; GitHub OAuth implementation; CI.

## Assumptions
- Existing plans 001 and 002 stay `done` as history; they describe the replaced chat demo.
- The chat demo code remains in `backend/` and `frontend/` untouched until the implementation plan, so docs will briefly describe a target state ahead of the code. Docs will say so in a "Current state" note.
- Contract-first stays: `.orchestration/api-contract.yaml` is the source of truth.
- Secrets (AI provider key, GitHub OAuth client secret) come from environment variables only and are never committed.

## Open Questions
Answer inline by editing the **Answer:** line. Recommended answers are pre-filled.

1. **Backend language** — Node/TypeScript (reuses the existing backend) or Python?
   - Recommended: **Node/TypeScript**. Existing Express setup, tests, and rules apply as-is.
   - Answer: Recommended (approved).
2. **Which AI model/provider?**
   - Recommended: **Anthropic Claude API** (`claude-sonnet-5-5`), key via `ANTHROPIC_API_KEY`, behind a narrow `analyzer` interface so the provider is swappable and tests use a fake.
   - Answer: Recommended (approved).
3. **Persistence** — keep the in-memory store (zero setup) or add a database for review history and the quality dashboard?
   - Recommended: **keep in-memory for v1**, behind the existing narrow store interface; revisit when the dashboard needs history across restarts.
   - Answer: Recommended (approved).
4. **GitHub links in v1, or snippets only?** (GitHub OAuth is listed as a bonus.)
   - Recommended: **snippets plus public GitHub file/PR URLs fetched without auth**; OAuth deferred to a later plan and documented as out of scope.
   - Answer: Recommended (approved).
5. **Real-time** — reviews take seconds. Keep Socket.io for progress streaming, or use plain REST (POST then poll/GET)?
   - Recommended: **plain REST for v1** (`POST /api/reviews`, `GET /api/reviews/:id`); drop Socket.io from the contract and add streaming later if needed.
   - Answer: Recommended (approved).
6. **Dashboard content** — what does "Quality Dashboard" show in v1?
   - Recommended: per-review findings grouped by category (style / bug / security / refactor) with severity counts, plus an aggregate view across reviews in the session.
   - Answer: Recommended (approved).
7. **Old chat code** — delete in the implementation plan, or keep until replaced?
   - Recommended: **delete in the implementation plan** once the new endpoints exist, so no dead code lingers.
   - Answer: Recommended (approved).
## Steps
1. Read the answers above and update this plan; mark it `active` after approval.
2. `.doc/product-definition.md` — rewrite for the new concept (users: developers; problem; value; in/out of scope; metrics such as time-to-first-finding and findings-per-category coverage).
3. `.doc/glossary.md` — replace chat terms with new canonical terms; keep naming-rules alignment (singular, `org`/`geo`).
4. `.orchestration/api-contract.yaml` — define review submission/retrieval, finding, suggestion, generated test schemas, and the error shape from `.rule/error-handling-rules.md`. Keep `GET /api/health`.
5. `.doc/architecture.md` — new diagram, components, review data flow, auth/org boundaries (none in v1), external dependencies (AI provider, GitHub), change-log entry.
6. `.agents/*/AGENT.md` — retarget roles and file ownership to the new domain.
7. `.rule/security-rules.md` / `.rule/database-rules.md` — add concept-specific rules only (untrusted code as input, never executed; size limits; prompt-injection handling; key handling).
8. `README.md` — new title/description and layout; note the code is mid-migration.
9. `.plan/000-backlog.md` — mark this item done and add follow-up items: backend review API, analyzer integration, Monaco editor UI, dashboard, auto-generated tests, GitHub link ingestion, GitHub OAuth (bonus).

## Validation
- `grep -ri whatsapp` over `.doc`, `.rule`, `.agents`, `.orchestration`, and `README.md` returns only intentional history references (old plans, change log).
- Every endpoint in the contract is described in `.doc/architecture.md`, and every domain term used in the contract appears in `.doc/glossary.md`.
- Docs conform to `.rule/naming-rules.md` (singular entity names) and `.rule/error-handling-rules.md` (error shape).
- No secrets or absolute machine paths in any changed file.

## Risks
- Docs describe a target state the code does not yet match, which could mislead agents; mitigated by the "Current state" note and by sequencing the implementation plan immediately after.
- Sending user code to a third-party AI provider is a data-protection concern; the product definition must state it explicitly.
- Prompt injection via submitted code; addressed in the security rules update.
- Scope creep from the bonus items; GitHub OAuth is explicitly deferred.

## Rollout Order
1. Product definition and glossary (vocabulary first).
2. API contract.
3. Architecture doc.
4. Agent roles, rules, README.
5. Backlog update.

## Rollback
All changes are Markdown/YAML in a git repo; revert the commit(s) for this plan. The `backend/` and `frontend/` source is untouched, so the chat demo keeps working after a rollback.

## Approval
Approved 2026-10-19.
