# Optional Encryption of API Payloads, and Password Hashing Audit

Status: superseded
Superseded by: [041-2026-11-05-remove-encryption](041-2026-11-05-remove-encryption.md)
Owner: Ilana
Last updated: 2026-10-30

## Goal
- A single switch on the backend turns **encryption of API request and response bodies** on or off. When it is on, user data (reviews, settings, account, support requests, photo and so on) is not sent in readable form between the browser and the backend; when it is off, the app works exactly as it does today.
- Passwords are **hashed, never encrypted**: they are stored only as a salted, slow hash, and no response, log or store ever holds a readable password. This is proven by tests.
- The browser needs no second switch: it asks the backend whether encryption is on and follows it.

## Scope
- Backlog item "Implement encryption. Send the user data encrypted or not in all apis according to an env variable. Hash the passwords instead of encrypting them." No Figma. It touches both sides, so it runs as **stack:full**. Branch: `feat/api-payload-encryption` (created from the committed `feat/editor-syntax-errors`).
- **What the code does today** (read 2026-10-30):
  - **Passwords are already hashed.** `backend/src/lib/password.ts` stores `scrypt$<salt>$<hash>` (random salt, constant-time compare); the plain value is never stored or returned (plan 028). This plan audits it and adds tests; it does not change the scheme unless Open Question 4 says so.
  - **One request path on each side.** The browser sends everything through one `request` function (`frontend/src/services/api.service.ts`): JSON bodies, and the profile photo as a raw `Blob`. The backend reads JSON with `express.json` (`backend/src/app.ts`), after CORS, CSRF and the session guard.
  - There is no payload encryption, and no HTTPS inside the app (it is local only, per the product definition).
- **In scope** (assuming the recommended answers):
  1. **Settings:** the backend reads one environment variable, `API_ENCRYPTION` (`on` or `off`, default `off`, validated at start like the other settings). Its value is never logged. The browser has no variable of its own.
  2. **Handshake** (`GET /api/crypto/key`, public, rate-limited): returns `{ enabled, publicKey? }`. With `enabled: false` nothing else changes. With `enabled: true` it returns the backend's ECDH P-256 public key (generated at start in memory, replaced on restart).
  3. **Key agreement:** on page load the browser generates an ephemeral ECDH key pair (WebCrypto), sends its public key once to `POST /api/crypto/session` and receives a key id (`kid`). Both sides derive the same 256-bit AES-GCM key with ECDH plus HKDF-SHA-256. The key lives in memory only (browser: never stored; backend: a map with an 8 hour idle expiry and a cap on entries). The private key never leaves the browser.
  4. **Envelope:** every `/api/*` body (request and response) except the two crypto routes and `GET /api/health` is replaced by `{ "v": 1, "kid": "...", "iv": "...", "ct": "..." }` (base64url), content type `application/json`, encrypted with AES-GCM-256, a fresh random 96-bit IV each time. The additional authenticated data binds the message to its HTTP method, path (without query), direction and `kid`, so a body cannot be replayed on another route or turned into a response. The photo (raw bytes) is sent as the same envelope with the bytes base64url-encoded.
  5. **Server rules when `API_ENCRYPTION=on`:** a plaintext body (where a body is expected), an unknown or expired `kid`, a bad tag, a repeated IV within the same key, or a wrong version gets a standard error (400 `encryption_required` or `decryption_failed`, never saying which byte failed). The browser handles an unknown/expired `kid` by repeating the handshake once and retrying. When `off`, an envelope is rejected the same way.
  6. **Browser:** a small module `frontend/src/lib/apiCrypto.ts` (WebCrypto only, no new dependency) plugs into `api.service.ts`'s `request` function, so every service gets it without change. JSON data source (mock mode) never uses it.
  7. **Password audit and tests** (Open Question 4): no readable password in any store row, response, log line or error; the hash parameters are pinned in constants; a login with a wrong password and an unknown user take comparable time; the "current password" check on change uses the same hash. No client-side hashing (see Assumptions).
  8. **Contract 0.12.0** (additive): the two crypto routes, the envelope schema and media rules, the new error codes, and the rule "when the handshake says enabled, bodies are envelopes".
  9. **Docs:** `.doc/architecture.md` (the crypto module, key lifecycle, what is and is not protected), `.doc/glossary.md` (`api encryption`, `envelope`, `kid`), `.doc/product-definition.md`, `.rule/security-rules.md` (data protection), and `README.md` (the variable, how to turn it on, the honest limits).
  10. **Tests.** Backend unit/route: key derivation vectors, envelope round trip, tamper (ciphertext, tag, IV, kid, AAD route/direction/method), replayed IV, expired key, plaintext when on, envelope when off, size limits, every route class (JSON, empty body, photo), 401/403/422 behaviour unchanged inside the envelope. Frontend unit: the crypto module against fixed test vectors shared with the backend, retry after an expired `kid`, mock mode unaffected. E2E (Playwright): run the whole existing API-mode suite with `API_ENCRYPTION=on` and assert on the wire that no request or response body contains readable review code, email or password.
- **Out of scope:**
  - TLS/HTTPS itself, certificates and HSTS (required for any real deployment; the app stays local-only).
  - Encrypting URLs, query strings, headers and cookies (Open Question 3).
  - Encrypting data at rest in the database (only passwords are hashed there; other columns stay as they are).
  - Mock mode (no network).
  - Login throttling or other auth changes.

## Assumptions
- **Honest security limits.** An application-layer scheme whose key exchange travels in the same channel protects against someone who only *reads* traffic (a passive observer, a log, a proxy that records bodies). It does **not** protect against someone who can *change* traffic (an active man-in-the-middle can substitute the backend's public key) unless the public key is verified by a separate trusted channel, which TLS provides. So real protection on a real network still needs HTTPS; this feature is a switchable extra layer, and the README says so.
- The backend's key pair is regenerated on each start, so after a restart the browser repeats the handshake (handled automatically).
- Passwords are **not** hashed in the browser: a client-side hash would simply become the password, and the server must hash what it receives. Over an encrypted body the plain password is not readable on the wire either.
- WebCrypto (browser) and `node:crypto` (backend) support ECDH P-256, HKDF-SHA-256 and AES-256-GCM, so no dependency is added.
- A single backend instance (product definition), so an in-memory key map is enough.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **What should "encrypted" mean here?**
   - A. **Application-layer envelope encryption with a per-session key (recommended).** ECDH P-256 key agreement, AES-256-GCM, as described above, switched by `API_ENCRYPTION`. Matches your request (a variable decides whether data is sent encrypted), adds no dependency, and the limits are stated openly.
   - B. **Only require HTTPS when the variable is on:** the backend refuses plain HTTP, sets HSTS and `Secure` cookies, and no payload encryption is added. Stronger against an active attacker, but it needs certificates on the machine and does nothing on the local setup.
   - C. A shared secret key in the settings used by both sides. Rejected: the browser would need the key in its bundle, so anyone could read it.

   **Answer:**

2. **How is the switch set?**
   - A. **One backend variable `API_ENCRYPTION`, and the browser follows it through the handshake (recommended).** No mismatch between two settings is possible.
   - B. Two variables, one for the backend and one for the frontend build (`VITE_API_ENCRYPTION`). The two can disagree, and the app would then fail with a clear error.

   **Answer:**

3. **What is covered by "all APIs"?**
   - A. **Request and response bodies of every `/api/*` route except the handshake and the health check (recommended).** URLs, query strings (for example the repository search text), headers and cookies stay readable, and the README lists them as a known limit.
   - B. Also move user data out of query strings into encrypted bodies (the repository search and any similar route). A larger change to routes and the contract.

   **Answer:**

4. **Password hashing.**
   - A. **Keep scrypt (recommended).** It is a standard, memory-hard password hash already in use; add the audit tests and pin its parameters.
   - B. Switch to argon2id (a new native dependency) and re-hash existing passwords at their next successful login.

   **Answer:**

5. **When the switch is on, what about the demo and test setups?**
   - A. **Everything works the same; the test suites run once with it off and the API-mode e2e suite runs again with it on (recommended).**
   - B. Only unit tests cover encryption; e2e stays plain.

   **Answer:**

**Answers (approved 2026-10-30, recommended options; no inline answers were found in this file):**
- 1: A. Application-layer envelope encryption with a per-session key.
- 2: A. One backend variable `API_ENCRYPTION`; the browser follows it through the handshake.
- 3: A. Request and response bodies of every `/api/*` route except the handshake and health check.
- 4: A. Keep scrypt; add audit tests.
- 5: A. Suites run with the switch off; the API-mode e2e suite runs again with it on.

## Steps
1. Branch `feat/api-payload-encryption` (created).
2. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend, Backend and QA tickets (Todo); Backend to In Progress. Write `.orchestrate/tickets.json`.
4. Backend agent, reading `.orchestrate/api-contract.yaml` after the contract update (0.12.0):
   - contract and error codes first;
   - setting, key pair, key map and the two crypto routes;
   - the envelope middleware (decrypt before `express.json`, encrypt after the handler), photo included;
   - password audit tests;
   - docs and README.
5. Frontend agent: `apiCrypto.ts` with shared test vectors, the `request` integration with the retry on an expired key, mock mode untouched, unit tests, the second e2e run with the switch on.
6. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
7. Before the manual check, set `API_ENCRYPTION` in the backend's local settings and restart the backend; no database change is expected.
8. Your final approval; plan to `done`, backlog item ticked.

## Validation
- `cd backend && npm test`, `npm run typecheck` and `npm run test:db` pass; `cd frontend && npm test`, `npm run lint`, `npm run typecheck` (apart from the two known `isWellFormed` errors from plan 023) and `npm run test:e2e` pass with the switch **off**; the API-mode e2e specs pass again with it **on**.
- Crypto (unit): fixed test vectors give the same key and the same ciphertext on the Node side and in the browser module; a round trip works for an empty body, a JSON body, a 100 000-character review and the 2 MB photo.
- Tamper (unit and route): flipping any bit of `ct`, `iv`, the tag, `kid` or `v`; moving a valid body to another route, another method, or from request to response; reusing an IV; an expired or unknown `kid`; and a plaintext body when the switch is on all fail with the standard error and reveal nothing about the key or the plaintext.
- Switch: `API_ENCRYPTION` unset or `off` leaves every response and request exactly as before (existing suites unchanged); `on` rejects a plaintext body; an invalid value stops the backend at start naming the variable and never its value.
- Wire check (e2e, switch on): across a full session (register, create and save a review, run a review, change settings, upload a photo, submit support), no request or response body captured by Playwright contains the code, the email, the password or the findings in readable form, and the handshake carries no secret.
- Recovery (e2e): restarting the backend mid-session (new key pair) makes the browser repeat the handshake once and the user's action still succeeds; no loop on a persistent failure.
- Mock mode: the JSON data source never calls the crypto routes.
- Passwords (unit and route): no store row, API response, error body or log line contains a readable password or a value derived from it other than the stored hash; the hash is `scrypt` with the pinned parameters and a unique random salt per password; a wrong password and an unknown user get the same response; the browser does not hash passwords.
- Auth and abuse: 401, 403 (CSRF) and 422 behaviour is unchanged inside the envelope; the handshake is rate-limited and the key map is capped, so repeated handshakes cannot exhaust memory.
- Contract: every new operation and error code has at least one test; `api-contract.yaml` is 0.12.0.
- Docs: the README states plainly what the switch protects (a passive reader) and what it does not (an active attacker without HTTPS, URLs, headers, cookies, data at rest).
- Manual: with the switch on, open the browser's network panel, use the app, and see that bodies are `v/kid/iv/ct` envelopes; with it off, see plain JSON.

## Risks
- **False sense of security.** The key exchange is in the same channel, so an active attacker can break it. Mitigation: the README, the architecture note and the plan say it is a passive-reader protection and that HTTPS is still required on any real network.
- **Crypto mistakes** (IV reuse, missing authentication, wrong binding). Mitigation: AES-GCM with random 96-bit IVs and a per-key IV check, AAD binding to method, path, direction and `kid`, standard primitives from `node:crypto` and WebCrypto only, fixed test vectors, and tamper tests for every field.
- **Breaking every route at once.** Mitigation: the switch defaults to off; one middleware on the backend and one function in the browser; the whole API-mode e2e suite runs with it on.
- **Large bodies** (the 2 MB photo as base64 grows by about a third, and decryption holds it in memory). Mitigation: the existing body limits are applied before and after decoding; tests at the limits.
- **Server restart invalidates keys.** Mitigation: automatic single re-handshake in the browser, tested.
- **Memory growth from handshakes.** Mitigation: rate limit, entry cap and idle expiry.
- **Hidden plaintext elsewhere** (query strings, logs). Mitigation: listed as a known limit; log redaction is checked by the password tests.
- **Time cost of the e2e suite** (it is already about 20 minutes). Mitigation: the second run covers the API-mode specs only.

## Rollout Order
1. Contract, setting and the pure crypto functions with test vectors.
2. Handshake routes and the envelope middleware.
3. Browser module and the `request` integration.
4. Password audit tests.
5. Docs.
6. QA, including the manual network-panel check.

## Rollback
- Revert the branch. There is no database change; set `API_ENCRYPTION` back to `off` (or remove it) and the app behaves as before. Stored passwords are unaffected because their format does not change.
