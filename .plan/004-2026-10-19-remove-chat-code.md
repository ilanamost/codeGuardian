# Remove the Chat-Demo Code from Frontend and Backend

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Outcome (2026-10-19)
Executed on branch `feat/remove-chat-code`. `backend/`: typecheck clean, 2 vitest tests pass. `frontend/`: typecheck and lint clean, 1 vitest test passes, build succeeds, 1 Playwright smoke test passes. No chat references remain in `backend/src` or `frontend/src`.

## Goal
Delete the files in `frontend/` and `backend/` that only exist for the retired chat demo, leaving two
minimal, buildable, tested shells that the review API and Monaco UI plans can build on.

## Scope
- In scope:
  - Backend: delete chat routes, message service, socket handlers, chat store/seed/types, and all chat tests. Keep `lib/error.ts`. Reduce `app.ts` to health + error handling and `index.ts` to a plain HTTP listen. Drop `socket.io` and `socket.io-client`. Add a health test.
  - Frontend: delete all chat components, chat API/socket/format libs, chat types, and chat tests. Reduce `App.tsx` to a placeholder shell; drop `DEMO_USER` and `socket.io-client`; retitle the page. Add one unit test and one e2e smoke test.
  - Update `README.md` and `.doc/architecture.md` "current state" notes.
- Out of scope: building the review API, analyzer, Monaco editor, or dashboard; historical plans 001–002 (left as history).

## Assumptions
- Everything chat-specific is recoverable from git history (commit `e250485`).
- `lib/error.ts`, tsconfig, vitest/playwright/vite configs, and the Tailwind setup are domain-neutral and stay.

## Open Questions
1. Keep placeholder shells (recommended) or leave the folders empty? Answer: placeholder shells, so `npm test`, `typecheck`, and `build` keep passing. (Approved by "implement".)

## Steps
1. Create branch `feat/remove-chat-code`.
2. Delete chat files in `backend/` and `frontend/`; strip `app.ts`, `index.ts`, `App.tsx`, `config.ts`, `index.html`, `package.json` files.
3. Add `backend/tests/health.test.ts`, `frontend/tests/unit/App.test.tsx`, `frontend/tests/e2e/smoke.spec.ts`.
4. `npm install` in both packages (refreshes lockfiles), run typecheck and tests.
5. Update README and architecture notes; mark the backlog item done.

## Validation
- `backend`: `npm run typecheck` and `npm test` pass.
- `frontend`: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass; e2e smoke test passes if browsers are installed.
- `grep -ri "socket\|conversation\|message" backend/src frontend/src` returns nothing chat-related.

## Risks
- Deleted code is needed again: mitigated by git history.
- Lockfile churn from reinstall: limited to removing socket.io packages.

## Rollout Order
Backend, then frontend, then docs.

## Rollback
`git revert` the commit, or delete the branch.
