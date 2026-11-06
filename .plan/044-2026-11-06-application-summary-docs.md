# Application Summary Documents (Backend, Frontend, Data Diagram)

Status: done
Owner: Ilana
Last updated: 2026-11-06

## Goal
- Someone who reads these files can explain the whole system to a recruiter: what it is for, how it looks and feels, how it is built, **why each architectural choice was made**, and how the data fits together.
- Three files: a backend summary, a frontend summary, and a database diagram with its explanation.

## Scope
- Backlog item: "Add a summary file/s ... split into backend and frontend ... every architectural choice explained thoroughly ... display a diagram from the backend schema." Frontend-only scope, **not** `stack:full`: this is documentation only, no application code, no schema, no contract change. Branch: `feat/application-summary-docs` (created from `feat/signin-redirect-base-path`, which holds plan 043).
- **In scope** (assuming the recommended answers):
  1. `.doc/summary-backend.md`: purpose and functionality as the backend serves it; layers (`route`, `service`, `store`, `model`, `schema`, `analyzer`, `lib`, `utils`) and why they are separated; Express and TypeScript; PostgreSQL and migrations; session-cookie authentication, CSRF Origin check, rate limits; GitHub OAuth (PKCE, single-use state cookie, no stored token); GitHub link ingestion and its SSRF guard and limits; the LLM review through the Claude API with the stub fallback; error shape and status codes; authorization (per-account data); configuration and environments; testing approach.
  2. `.doc/summary-frontend.md`: purpose, functionality and UX per page (Dashboard, New Review, Review, Review History, GitHub Integration, Settings, Help, Login and Register); layers (`models`, `services`, `store`, `components`, `pages`, `lib`, `utils`) and why; React, Vite, Tailwind CSS v4 with design tokens; Redux store and the services-behind-the-store rule; the single `request()` HTTP client and the global loader; Monaco editor and syntax checking; responsive design and breakpoints; theme and settings; error notifications; the base path for GitHub Pages; testing (Vitest and Playwright).
  3. `.doc/data-model.md`: a Mermaid `erDiagram` of every table in `backend/db/schema.sql` and its migrations, with keys, relationships and cardinality, followed by a short explanation of each table and of the main design choices (ownership by account, JSON columns versus tables, indexes, constraints).
  4. Each file opens with a short "explain it in one minute" paragraph and a "Key decisions" section in the form decision, the alternative, and the reason.
  5. `.doc/architecture.md` gets one line linking to the three new files. `README.md` gets one line in its documentation list.
- **Out of scope:** any code, schema, contract or test change; rewriting `.doc/architecture.md` (the summaries link to it for detail and do not copy it); screenshots or exported images (the diagram is text); a `docs/` directory (never created).

## Assumptions
- The documents describe the code **as it is today** (read from the source, `.doc/architecture.md`, the plans and the contract), not the target state; where the code and `.doc/architecture.md` disagree, the code wins and the disagreement is listed in the report.
- Reasons for decisions come from the plans in `.plan/` and the backlog notes. A reason the repository does not record is written as "inferred" so nothing is invented.
- Mermaid renders on GitHub and in the IDE preview, so no tooling is added.
- Canonical terms from `.doc/glossary.md` are used (`org`, `geo`, `lat`/`lng`).

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Where do the files live?**
   - A. **`.doc/` (recommended).** Next to the architecture, glossary and product definition; the repository rule is that `docs/` never exists.
   - B. The repository root next to `README.md` and `deployment.md`. Easier to find for a visitor, but mixes with operational docs.

   **Answer:** A (`.doc/`), approved.

2. **Which diagram format?**
   - A. **Mermaid `erDiagram` inside `.doc/data-model.md` (recommended).** Text, versioned, renders on GitHub.
   - B. Mermaid plus an exported PNG or SVG. Needs an extra tool and can go stale.

   **Answer:** A (Mermaid only), approved.

3. **Should there also be a third, short "pitch" file for the recruiter conversation?**
   - A. **No: each summary opens with a one-minute paragraph (recommended).** Matches the "2 files + diagram" request.
   - B. Yes: add `.doc/summary-overview.md` with the product story, the stack at a glance and the five strongest engineering decisions.

   **Answer:** A (no third file), approved.

4. **Language and depth.**
   - A. **English, plain wording, about 300 to 500 lines per summary (recommended).** Tables for lists of routes and layers; prose for the "why".
   - B. Shorter (about 150 lines each), with links to the architecture for depth.

   **Answer:** A (English, 300 to 500 lines), approved.

## Steps
1. Read the sources: `backend/src/**`, `backend/db/schema.sql` and `backend/db/migration/*`, `frontend/src/**`, `.doc/*.md`, `.orchestrate/api-contract.yaml`, `.plan/*.md` (for the reasons), `README.md`, `deployment.md`.
2. Write `.doc/data-model.md` first (the diagram is the most checkable part): one entity per table, every foreign key as a relationship, columns with types, primary and unique keys.
3. Write `.doc/summary-backend.md`, using the structure in Scope item 1, with a "Key decisions" section.
4. Write `.doc/summary-frontend.md`, using the structure in Scope item 2, with a "Key decisions" section.
5. Add the link lines to `.doc/architecture.md` and `README.md`.
6. Check every file path, route, table, environment variable and command named in the three files against the repository; fix or remove anything that does not exist.
7. Write the agent report to `.orchestrate/frontend-agent-report.md`, including the list of places where the code and `.doc/architecture.md` disagree.

## Validation
QA checklist (each item is provable by a command or by reading):
- The three files exist under the location chosen in Question 1, and no `docs/` directory exists.
- `git diff --stat` shows only Markdown files and `.plan`/`.orchestrate` files; no file under `backend/src`, `frontend/src`, `backend/db` or `.orchestrate/api-contract.yaml` changed.
- Every table created in `backend/db/schema.sql` and `backend/db/migration/*` appears in the `erDiagram`, and every foreign key is a relationship (compare with `grep -n "CREATE TABLE\|REFERENCES"`).
- The Mermaid block parses (paste into the Mermaid live parser or run `npx @mermaid-js/mermaid-cli` on it) with no error.
- Every route listed in the backend summary exists in `backend/src/route/` and in `.orchestrate/api-contract.yaml`; every listed environment variable exists in `backend/env.development.example` or `frontend` env files.
- Every repository path written in the three files resolves (a script that extracts backticked paths and checks them).
- Each summary has: the one-minute paragraph, the sections listed in Scope, and a "Key decisions" section with at least eight entries, each with decision, alternative and reason.
- The summaries cover: purpose, functionality, UI, UX, architecture, data, services, store, connections, authentication and authorization.
- The two link lines resolve (`.doc/architecture.md`, `README.md`).
- No secrets or real key values appear in the files (`grep -i "sk-\|secret=" ` finds only variable names).

## Risks
- **Stale or invented facts.** Mitigation: Step 6 and the path, route and table checks; "inferred" label for unrecorded reasons.
- **Duplication with `.doc/architecture.md` (1,011 lines).** Mitigation: summaries explain and link; they do not copy tables.
- **The diagram drifts when the schema changes.** Mitigation: the data-model file names `backend/db/schema.sql` as the source of truth and `.rule/database-rules.md` already requires docs to be updated with migrations; add that reminder line in the file.
- **Length makes the files hard to read.** Mitigation: the one-minute paragraph first, tables, and a contents list.

## Rollout Order
1. Approve this plan (answer the Open Questions in this file).
2. Documentation agent writes the three files and the link lines.
3. QA runs the Validation checklist and writes `.orchestrate/qa-report.md`.
4. You review the files; commit only when you approve.

## Rollback
- Documentation only: delete the three new files and the two link lines (`git checkout -- .doc/architecture.md README.md`), or drop the branch `feat/application-summary-docs`. Nothing else is affected.
