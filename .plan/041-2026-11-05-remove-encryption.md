# Remove the API Payload Encryption

Status: done
Owner: Ilana
Last updated: 2026-11-05

## Goal
- Remove the optional API payload encryption built in plan 033 (`API_ENCRYPTION`, the ECDH handshake and the AES-GCM envelope) from the backend, the frontend, the tests, the contract and the docs.
- After this plan every `/api/*` body is plain JSON again, with no encryption switch and no crypto routes.
- Password hashing (scrypt) stays exactly as it is: it is not part of the encryption feature.

## Scope
- Backlog item "Remove the encryption implementation." No Figma. The item is not marked `stack:full`, but the feature lives on both sides (`backend/` and `frontend/`), so removing it only on the frontend would leave a dead backend switch. **Open Question 1 asks you to confirm it runs as stack:full.** Branch: `chore/remove-encryption`.
- **What exists today** (found by search on 2026-11-05; paths are repository-relative):
  - Backend: `backend/src/lib/api-envelope.ts`, `backend/src/lib/api-crypto.ts`, `backend/src/lib/crypto-key-map.ts`, `backend/src/route/crypto.route.ts`, `backend/src/service/crypto.service.ts`, and encryption parts in `backend/src/app.ts`, `config.ts`, `utils/constants.ts`, `utils/limits.ts`, `utils/error-code.ts`, `utils/error-messages.ts`, `lib/error.ts`, plus `backend/vitest.encrypted.config.ts`, `backend/tests/fixtures/crypto-vectors.json` and the encryption tests and helpers (`api-envelope.test.ts`, `api-crypto.test.ts`, `qa-033-adversarial.test.ts`, `helper/envelope.ts`, and mentions in other test files).
  - Frontend: `frontend/src/lib/apiCrypto.ts`, `frontend/src/models/crypto.model.ts`, encryption parts in `frontend/src/services/api.service.ts`, `lib/api.constants.ts`, `models/dto.ts`, `services/index.ts`, `services/account.service.ts`, `store/account.slice.ts`, `lib/useAvatarSrc.ts`, plus `frontend/playwright.encrypted.config.ts`, the encrypted parts of `playwright.config.ts`, and tests (`apiCrypto.test.ts`, `api.service.crypto.test.ts`, `cross-stack.test.ts`, `qa-033-api-encryption-adversarial.test.ts`, `api-encryption-ui.test.tsx`, `e2e/api-encryption.spec.ts`, `e2e/encryptedRun.ts`, `e2e/sealedRequest.ts`, `utils/fakeCryptoBackend.ts`, and mentions in `e2e/fixture.ts`, `backendHarness.ts` and others).
  - Contract and docs: `.orchestrate/api-contract.yaml` (crypto routes, envelope schema, error codes), `.doc/architecture.md`, `.doc/glossary.md`, `.doc/product-definition.md`, `.rule/security-rules.md`, `README.md`, and the `package.json` scripts of both apps.
- **In scope** (assuming the recommended answers):
  1. Remove the crypto routes (`GET /api/crypto/key`, `POST /api/crypto/session`), the envelope middleware, the key map, the `API_ENCRYPTION` setting and its start-up validation.
  2. Remove the browser crypto module and the handshake/retry logic in `request`; the browser sends and reads plain JSON, and the profile photo goes back to a raw `Blob` upload.
  3. Remove the encryption error codes and messages, and the encrypted-run test configs, scripts and helpers.
  4. Contract 0.16.0: drop the crypto routes, the envelope schema and the encryption error codes.
  5. Keep the password audit tests from plan 033 (scrypt parameters, no readable password anywhere), moving any that lived in encryption-only files.
  6. Update the docs and `README.md`, and drop the `crypto` handshake field from `GET /api/health` if it exists (check first).
- **Out of scope:**
  - Password hashing and the session cookie (unchanged).
  - Adding HTTPS or any replacement protection (the product definition already says HTTPS is required on a real network).
  - Editing history: plan 033 stays in `.plan/` and is set to `superseded`; the old backlog entry stays in DONE.
  - The known follow-ups listed in the backlog that are unrelated (`EADDRINUSE` flake, `isWellFormed` typecheck errors). Removing the envelope test helper may remove the `EADDRINUSE` flake by itself; this is noted, not promised.

## Assumptions
- `API_ENCRYPTION` defaults to `off`, so no running setup depends on it; no database column or migration is tied to it.
- A leftover `API_ENCRYPTION` line in someone's local env file is harmless once the variable is ignored. The backend does not reject unknown variables.
- Nothing outside this repository (no deployed client) sends envelopes to the backend.
- The photo upload worked as a raw `Blob` before plan 033; its pre-encryption route behaviour is documented in the contract history and still passes the avatar tests.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **Scope: is this stack:full?**
   - A. **Yes, remove it from backend and frontend together (recommended).** Encryption only works as a pair; removing one side breaks the other.
   - B. Frontend only. The backend keeps the switch, but the browser would fail whenever it is turned on, so this leaves a broken option.

   **Answer:**

2. **What if the backend gets an old envelope body after the change?**
   - A. **Nothing special (recommended).** It is treated as any other invalid body (the normal 400/422 validation error). The feature was off by default and local only.
   - B. Keep a clear error code (`encryption_removed`) for a while.

   **Answer:**

3. **Tests tied only to encryption.**
   - A. **Delete them, and keep the password audit tests (recommended).**
   - B. Keep the encrypted e2e project as a skipped suite for reference. Not recommended: dead code with a stale harness.

   **Answer:**

4. **Contract version.**
   - A. **0.16.0 (recommended).** The contract is below 1.0, so a removal is a minor bump.
   - B. 1.0.0, as a breaking change.

   **Answer:**

5. **Plan 033 and the glossary.**
   - A. **Set plan 033 to `superseded` with a link to this plan, and remove the `api encryption`, `envelope` and `kid` terms from the glossary (recommended).**
   - B. Keep the glossary terms marked "removed".

   **Answer:**

## Steps
1. Branch `chore/remove-encryption` (created).
2. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend, Backend and QA tickets (Todo); Frontend to In Progress. Write `.orchestrate/tickets.json`.
4. Frontend agent: remove `apiCrypto.ts`, the crypto model and DTO types, the handshake and retry in `api.service.ts`, the photo envelope path, the encrypted Playwright config and helpers, and the encryption tests; simplify `request` back to plain JSON; update the frontend scripts. Update `.orchestrate/api-contract.yaml` to 0.16.0 and record what the browser expects.
5. Backend agent, reading the updated contract: remove the crypto routes, the envelope middleware, the key map, the setting, the error codes and messages, the encrypted Vitest config and helpers, and the encryption tests; keep and relocate the password audit tests; update the `package.json` scripts.
6. Docs: `.doc/architecture.md`, `.doc/glossary.md`, `.doc/product-definition.md`, `.rule/security-rules.md`, `README.md`; set plan 033 to `superseded`.
7. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
8. Your final approval; plan to `done`, backlog item ticked. Nothing is committed without your approval.

## Validation
- Search: `git grep -n -i -E "API_ENCRYPTION|envelope|apiCrypto|crypto/key|crypto/session|decryption_failed|encryption_required"` outside `.plan/` and `.orchestrate/` history returns nothing in `backend/`, `frontend/`, `README.md` and `.doc/`. The only remaining `crypto` uses are `node:crypto` for scrypt, session ids and OAuth state.
- `cd backend && npm test` and `npm run typecheck` pass; `npm run test:db` passes if a local database is available (otherwise stated as not run).
- `cd frontend && npm test`, `npm run lint` and `npm run typecheck` pass (apart from the two known `isWellFormed` errors); `npm run test:e2e` passes.
- Routes: `GET /api/crypto/key` and `POST /api/crypto/session` return 404 (route test).
- Plain bodies: a Supertest check that register, create review, save, settings update and photo upload send and receive plain JSON; a Playwright check that captured request bodies of a full session contain readable JSON and no `kid`, `iv` or `ct` fields.
- Settings: starting the backend with `API_ENCRYPTION=on` still starts and behaves as off (the variable is ignored); no start-up error names it.
- Passwords: the password audit tests still pass (scrypt parameters pinned, unique salts, no readable password in any row, response, error or log, wrong password and unknown user get the same response).
- Photo: the avatar upload and download tests pass with a raw `Blob`, up to the 2 MB limit.
- Config scripts: no `test:encrypted`, `vitest.encrypted.config.ts` or `playwright.encrypted.config.ts` remain, and no `package.json` script refers to them.
- Contract: `.orchestrate/api-contract.yaml` is 0.16.0, contains no crypto routes, envelope schema or encryption error codes, and every remaining operation still has at least one test.
- Docs: the README, architecture, glossary, product definition and security rules no longer describe the switch; the security rules and README still state that HTTPS is required on a real network.
- Manual: run both apps, open the browser's network panel, use the app, and see plain JSON bodies.

## Risks
- **Deleting a helper that other tests use** (`backend/tests/helper/envelope.ts`, `frontend/tests/e2e/fixture.ts`, `backendHarness.ts` mention encryption). Mitigation: remove the encryption parts of shared helpers rather than the files, and run every suite after each side.
- **Losing the password audit tests** because they sit in encryption files. Mitigation: move them first, then delete; Validation checks they still run.
- **Photo upload regression** (it was changed to an envelope in plan 033). Mitigation: avatar unit and e2e tests at the 2 MB limit.
- **Silent leftovers** in docs, comments and scripts. Mitigation: the search check in Validation.
- **Time cost of the e2e suite** (about 20 minutes). Mitigation: the encrypted second run disappears, so the total shortens.

## Rollout Order
1. Contract 0.16.0 edit.
2. Frontend removal and its tests.
3. Backend removal and its tests (password audit tests relocated first).
4. Scripts and configs.
5. Docs and plan 033 status.
6. Search check, then QA.

## Rollback
- Revert the branch (nothing is committed until you approve). There is no database change. Plan 033 describes how the feature worked, and the commit history before this branch holds the code.
