# Contact Support Opens the User's Mail App (mailto)

Status: done
Owner: Ilana
Last updated: 2026-10-29

Supersedes: [031-2026-10-29-contact-support-email.md](031-2026-10-29-contact-support-email.md) (server-side SMTP). Its backlog item is still the same one; only the approach changes.

## Goal
- Clicking **Submit Request** in Help > Contact Support opens the user's own mail app with a ready message to the support address: subject, body and recipient filled in. The user presses Send there.
- The form states plainly what happened: the app cannot send the email itself, so it opened the mail app; if nothing opened, the user can copy the message or the support address.
- No mail server, no SMTP credentials and no third-party service. Nothing is sent by the app.

## Scope
- Backlog item 1 of the current queue (contact support). No Figma. **Frontend-only** (no `stack:full`), as you chose. Branch: `feat/contact-support-email` (see Open Question 2 for the plan 031 work already on it).
- **What the code does today** (read 2026-10-29): the form validates, calls `POST /api/support-request` (stored, ticket `SUP-NNNN`, plus the plan 031 email sending, uncommitted), and shows a banner and toast by `emailed`. In mock mode the JSON data source returns a demo ticket and the demo wording.
- **In scope:**
  1. **Build the `mailto:` link** in one pure function (`frontend/src/lib/supportMailto.ts`):
     - Recipient: the support address (Open Question 1), one constant in `frontend/src/lib/help.constants.ts`.
     - Subject: `[SUP-NNNN] <issue type label> (<priority label>)` when a ticket exists (Open Question 3), else `<issue type label> (<priority label>)`. Built from the labels only, never from free text.
     - Body (plain text): ticket, issue type, priority, the sender's email, review ID if given, then the description.
     - Every value is percent-encoded with `encodeURIComponent`; line breaks are `%0D%0A`. CR/LF are removed from the subject and recipient before encoding. The scheme is the constant `mailto:`, never built from input.
     - **Length cap:** many mail apps refuse links over about 2 000 characters. If the encoded link is longer than 1 800 characters, the description is cut to fit and the body ends with "(shortened; the full text is in the form)". The form keeps the full text.
  2. **Open the mail app** after a valid submit with `window.location.assign(mailtoLink)` (a user click, so it is not blocked). The form values stay in place.
  3. **Outcome message** (banner and toast): "Your mail app should open with the message. Press Send there to contact support. Ticket SUP-NNNN." (no ticket text when none). It also shows the support address and two buttons: **Copy message** (subject and body to the clipboard) and **Copy address**, for users without a mail app, with a toast on success and a clear toast if the clipboard is refused.
  4. **Remove the demo wording.** "This is a demo: no message was sent" and the mock-mode toast are replaced by the message above, in both data sources.
  5. **Backend and contract** (depends on Open Question 2): the SMTP mailer and `emailed` are removed or left unused; no new endpoint.
  6. **Docs:** `.doc/product-definition.md` (support contact is by `mailto:`; app-sent email stays out of scope), `.doc/glossary.md` (`support request`, `mailto link`), `README.md` (how it works and the one constant to change), and `.rule/security-rules.md` only if a rule needs refining.
  7. **Tests.** Unit: the link builder (table of normal, long, unicode, newline, `&`, `?`, `#`, `%` and header-looking input such as `\r\nBcc: x@y.z`); the form (opens once per submit, shows ticket, copy buttons, copy failure); both data sources. E2E (Playwright): intercept the navigation to the `mailto:` link (it cannot be followed in the test browser) and assert its parts; the copy buttons; mock mode.
- **Out of scope:**
  - Sending any email from the app, a confirmation email, or knowing whether the user sent the message.
  - The "Email notifications" setting.
  - A third-party browser email service.
  - Submit guard against double clicks (QA finding F4 of plan 031) is done here because the same handler is rewritten.

## Assumptions
- The user's device has a mail app registered for `mailto:` links (or uses the copy buttons).
- The support address is not a secret (it appears in the link the user sees); it lives in source code, not in secrets or settings files.
- User text is untrusted: it only goes into the percent-encoded query values of the link, never into the scheme, the recipient or the subject.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved", **except Question 1, which has no default and needs your address.**

1. **What is the support email address?**
   - Write the address that should receive the requests (for example `support@yourdomain.com`). There is no recommended value: a placeholder such as `support@example.com` would send real users' messages nowhere.

   **Answer: ilana.mostovski@gmail.com** 

2. **What happens to the plan 031 work (SMTP mailer, `nodemailer`, mail settings, `emailed`, the rate limit, 41 uncommitted files)?**
   - A. **Remove the mail-sending parts, keep the rate limit (recommended).** A backend agent deletes the mailer, `nodemailer`, the mail settings, `MAIL_FAKE`, `emailed` and the README mail section, and the contract moves to 0.11.0 (`emailed` removed). The 5-per-hour limit on `POST /api/support-request` stays, since that route still stores requests. No dead code and no unused dependency.
   - B. Leave the backend as is and never set the mail settings. No removal work, but the app carries unused code, a dependency and a field that is always `false`.
   - C. Revert everything from plan 031 to the last commit (`git checkout`), including the rate limit. Cleanest, but the 41 files of work are lost unless you commit them first.

   **Answer:**

3. **Should the request still be stored on the backend (ticket number) in API mode?**
   - A. **Yes (recommended).** Submit stores the request (ticket `SUP-NNNN`, as before plan 031), then opens the mail app with the ticket in the subject. You keep a record, and the ticket links the stored request to the email.
   - B. No. Submit only opens the mail app, with no ticket and no backend call; the backend route stays unused.

   **Answer:**

4. **Where does the support address live?**
   - A. **One constant in `frontend/src/lib/help.constants.ts` (recommended).** Simple, reviewed in git, visible in the built app.
   - B. A frontend build setting (`VITE_SUPPORT_EMAIL`) with the constant as the default, so it can change without editing code. It is public either way once built.

   **Answer:**

**Answers (approved 2026-10-29):**
- 1: `ilana.mostovski@gmail.com` (your inline answer).
- 2: A. Remove the mail-sending parts, keep the rate limit.
- 3: A. Store the request and ticket in API mode, then open the mail app with the ticket in the subject.
- 4: A. One constant in `frontend/src/lib/help.constants.ts`.

## Steps
1. Branch `feat/contact-support-email` (exists).
2. Answer the Open Questions in this file (Question 1 is required), then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend ticket (Todo to In Progress) and the QA ticket; add a Backend ticket only if Question 2 is A. Write `.orchestrate/tickets.json`. Close the open plan 031 tickets (AI-65 QA) as superseded.
4. Backend agent (only if Question 2 is A): update the contract to 0.11.0 first, then remove the mail-sending code, `nodemailer`, settings and docs; keep and re-test the rate limit; run `cd backend && npm test`, `npm run typecheck`, `npm run test:db`.
5. Frontend agent: link builder with its table test, the form, copy buttons, constants, both data sources, unit and e2e tests; remove the `emailed` handling to match the contract.
6. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
7. Your final approval, then plan to `done` and the backlog item ticked.

## Validation
- `cd frontend && npm test`, `npm run lint`, `npm run typecheck` (apart from the two known `isWellFormed` errors from plan 023) and `npm run test:e2e` pass; if the backend changed, `cd backend && npm test`, `npm run typecheck` and `npm run test:db` pass. No test opens a real mail app or contacts a real service.
- Link (unit table): the scheme is `mailto:` and the recipient is exactly the configured address; the subject is `[SUP-NNNN] <label> (<label>)` (or without the ticket) and never holds free text; the body holds ticket, type, priority, sender email, review ID and description as plain text; `&`, `?`, `#`, `%`, `=`, unicode and newlines round-trip through `decodeURIComponent` unchanged.
- Injection (unit): `\r\nBcc: x@y.z` or `%0D%0ABcc:` in the email, review ID or description cannot add a header or recipient, because the only decoded places are the body value; the subject and recipient contain no CR/LF.
- Length (unit): a 2 000-character description gives a link of at most 1 800 characters ending with the shortened note, and the form still holds the full text.
- Form: a valid submit calls the link opener exactly once (a double click or double Enter does not open it twice), shows the outcome message with the ticket and address, and keeps every typed value; an invalid submit opens nothing.
- Copy: Copy message puts the subject and body on the clipboard, Copy address puts the address; a refused clipboard shows an error toast; both work in dark and light themes.
- Both data sources: API mode stores the request and shows the ticket in the subject (if Question 3 is A); mock mode shows a demo ticket or none, and never says "no message was sent".
- If Question 2 is A: `nodemailer` is gone from `backend/package.json` and the lock file, no mail setting is read by `config.ts`, the contract is 0.11.0 without `emailed`, and the 6th request in an hour still gets 429.
- Manual: with a mail app installed, submit the form and see the message open addressed to the support address with the right subject and body.

## Risks
- **No mail app installed, or a browser that blocks the link.** Mitigation: Copy message and Copy address, and the address shown on screen.
- **Nothing proves the message was sent.** Mitigation: the wording says "press Send"; the stored request (Question 3 A) is the record.
- **Link too long for the mail app.** Mitigation: the 1 800-character cap with the shortened note.
- **Header or recipient injection through the link.** Mitigation: free text only in the encoded body, subject from labels, CR/LF stripped, tests above.
- **Address harvested from the page by spammers.** Mitigation: accepted; it is a support address.
- **Removing plan 031 code breaks the tests written for it.** Mitigation: the backend agent updates the tests in the same change; QA re-runs both suites.

## Rollout Order
1. Backend removal and contract (only if Question 2 is A).
2. Link builder and its tests.
3. Form, copy buttons and wording.
4. Docs.
5. QA, including the manual mail-app check.

## Rollback
- Revert the branch. Without a backend change there is no data change. If the backend was cleaned up, the contract returns to 0.10.0 by reverting that commit; stored support requests are unaffected.
