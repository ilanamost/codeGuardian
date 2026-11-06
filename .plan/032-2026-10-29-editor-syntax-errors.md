# Code Editor: Syntax Errors for Every Language

Status: done
Owner: Ilana
Last updated: 2026-10-29

## Goal
- When the code in the editor has a syntax error, the editor shows it where it is: a red squiggle on the bad spot, and a hover message that says what is wrong ("Unexpected `)`", "Missing `}`"). It works for all five languages in the selector: TypeScript, JavaScript, Python, Go and Java, each judged by its own grammar.
- Correct code shows no syntax squiggle. Switching the language re-checks the same code with the new language's grammar.
- The AI findings markers keep working exactly as today, and syntax errors never get mixed up with them.

## Scope
- Backlog item "In the code editor, I want errors to appear for incorrect syntax. Each coding language has a different syntax." No Figma. **Frontend-only** (no `stack:full`): the check runs in the browser and nothing is sent to the backend or executed. Branch: `feat/editor-syntax-errors`.
- **What the code does today** (read 2026-10-29):
  - `frontend/src/components/CodeEditor.tsx` mounts Monaco, loaded at runtime from the CDN by `@monaco-editor/react` (plan 027, answer 3 changed to the CDN). Languages come from `LANGUAGE_META` in `frontend/src/lib/review.constants.ts`; the editor-language id is `monacoLanguageId` in `frontend/src/lib/codeFile.ts`.
  - **TypeScript and JavaScript** already get Monaco's own squiggles from its language workers (plan 027 keeps them). They include *semantic* errors too (for example "Cannot find name", "Cannot find module"), which are noisy for a snippet pasted without its imports and are not syntax errors. `CodeEditor.tsx` clears stale TS/JS marks when the language changes.
  - **Python, Go and Java** have colouring only: no syntax check of any kind.
  - Finding markers are set with the marker owner `FINDING_MARKER_OWNER` (`review.constants.ts`); anything new must use its own owner so neither clears the other.
- **In scope:**
  1. **A syntax checker per language, run in the browser** (Open Question 1), behind one function `checkSyntax(language, code)` in `frontend/src/lib/syntaxCheck.ts` that returns `[{ startLine, startColumn, endLine, endColumn, message }]`, a pure function with no Monaco types so it is easy to test.
  2. **Marker owner `syntax`** (constant in `review.constants.ts`): after the code or the language changes, wait 400 ms of no typing, run the checker, and replace the `syntax` markers on the model (severity Error, source "Syntax"). The check never blocks typing: it runs after a debounce, and a result from an older version of the code is dropped.
  3. **Limits:** at most 20 syntax markers at a time (the first by position); code over 100 000 characters (the review limit) is not checked; a checker failure shows no marker and one quiet toast at most once per session, never an error screen.
  4. **TypeScript and JavaScript** use the same marker owner for consistency, per Open Question 2 (syntax errors only).
  5. **Where it applies:** the editable main editor on New Review and the Review page (Open Question 4). The read-only Generated tests editor is not checked.
  6. **Lazy loading:** the grammars load only when the user selects (or uploads) a language that needs them, and are cached; nothing is added to the first page load. No third-party CDN is used at runtime for the grammars (Open Question 1).
  7. **Tests.** Unit: the checker against a table of valid and invalid snippets per language, with exact line, column and message of the first error, plus unicode, tabs, very long lines, empty code, a file that is only comments, and code with several errors (cap 20). E2E (Playwright): type invalid code in each language and see a squiggle and its hover text; type valid code and see none; switch the language and see the result change; fix the error and see the squiggle go; findings markers and glyphs still appear together with a syntax squiggle on another line; upload a `.py` file with an error.
  8. **Docs:** `.doc/architecture.md` (the syntax check and its marker owner), `.doc/glossary.md` (`syntax error` vs `finding`), `README.md` (what is checked, and that nothing is sent anywhere).
- **Out of scope:**
  - Type checking, linting, style rules or "code smells" (those are the AI findings).
  - Auto-fix or quick-fix actions, autocomplete for Python, Go and Java.
  - New languages beyond the selector.
  - Blocking **Run review** when the code has a syntax error (Open Question 5).
  - Running or compiling the code in any way. The code is only parsed.
  - Backend, API contract and database.

## Assumptions
- The check works on the user's text only, in the browser, and the text never leaves it. Submitted code is untrusted: it is parsed, never executed (`.doc/product-definition.md`).
- A syntax checker based on a real grammar finds the *first useful* error well, but its message wording is generic ("Unexpected token", "Missing ;"). Exact compiler-style messages are not promised.
- Monaco's CDN load stays as plan 027 decided; this plan does not change it.

## Open Questions
Answer inside this file, below each question. The recommended answer is used if you only write "approved".

1. **How are Python, Go and Java checked?** (TypeScript and JavaScript can reuse Monaco, see question 2.)
   - A. **Tree-sitter in the browser (recommended).** Use `web-tree-sitter` (WebAssembly) with the Python, Go and Java grammars. It builds a real syntax tree and marks `ERROR` and `MISSING` nodes with accurate positions, in a few milliseconds for 100 000 characters. Costs: a pinned dependency and three `.wasm` grammar files (a few hundred KB each) served from the app itself and loaded only when needed.
   - B. Hand-written light checks (unbalanced brackets and quotes, Python indentation). No dependency, but it misses most real syntax errors and gives false alarms, so it would look broken to users.
   - C. A compiler run on a server (`python -m py_compile`, `go vet`, `javac`). Rejected: it needs a backend and tools on the machine, and the product rule is that submitted code is never executed or compiled on the server.
   - D. Pyodide for Python only. About 10 MB, and still nothing for Go and Java.

   **Answer:**

2. **What happens to the TypeScript and JavaScript squiggles Monaco already shows?**
   - A. **Syntax errors only (recommended).** Turn off Monaco's semantic validation for both languages (`noSemanticValidation: true`) and keep its syntax validation, so pasting a snippet without its imports no longer shows "Cannot find name". This matches your request ("errors for incorrect syntax") and makes all five languages behave the same. It changes plan 027's "TS/JS error squiggles show, as before".
   - B. Keep everything Monaco shows today (syntax and semantic) for TypeScript and JavaScript, and add the new checker only for Python, Go and Java.
   - C. Replace Monaco's TS/JS diagnostics with tree-sitter too (TypeScript and JavaScript grammars). One engine for all five languages, but two more grammars and the loss of Monaco's richer TS error messages.

   **Answer:**

3. **Where do the grammar files come from?**
   - A. **Bundled with the app and served from its own origin (recommended).** Works offline for the checker and loads nothing from a third-party site (`.rule/security-rules.md`, supply chain).
   - B. From a CDN at runtime. Smaller app, but trusts a third party and breaks without internet.

   **Answer:**

4. **Which editors are checked?**
   - A. **The editable code editor only (recommended).** The Generated tests editor shows read-only AI output; red squiggles on it would only confuse.
   - B. Both editors.

   **Answer:**

5. **Should a syntax error stop the user from running a review?**
   - A. **No, show the squiggles and still allow Run review (recommended).** The AI can often explain broken code, and the checker can be wrong at the edges.
   - B. Disable Run review while a syntax error exists, with a tooltip saying why.

   **Answer:**

**Answers (approved 2026-10-29, recommended options; no inline answers were found in this file):**
- 1: A. Tree-sitter in the browser (`web-tree-sitter`) for Python, Go and Java.
- 2: A. Syntax errors only for TypeScript and JavaScript (Monaco semantic validation off).
- 3: A. Grammar files bundled with the app and served from its own origin.
- 4: A. The editable code editor only.
- 5: A. Run review stays enabled with a syntax error.

## Steps
1. Branch `feat/editor-syntax-errors` (created).
2. Answer the Open Questions in this file, then approve the plan. Read this file again before acting (inline answers override the recommendations).
3. Linear: create the Frontend and QA tickets (Todo), Frontend to In Progress. Write `.orchestrate/tickets.json`. No Backend ticket.
4. Frontend agent:
   - add the dependency (pinned, at least two weeks old, `npm audit` checked) and the grammar files;
   - `syntaxCheck.ts` with its table tests first;
   - the debounced marker effect in `CodeEditor.tsx` with its own marker owner;
   - TS/JS handling per Question 2;
   - e2e specs, docs.
5. QA agent against the Validation section, then `.orchestrate/qa-report.md`.
6. Your final approval; plan to `done`, backlog item ticked.

## Validation
- `cd frontend && npm test`, `npm run lint`, `npm run typecheck` (apart from the two known `isWellFormed` errors from plan 023) and `npm run test:e2e` pass. The backend is untouched, so its suites are not required. No test uses a real network service for the grammars.
- Checker (unit): for each of the five languages, valid snippets give no error, and each invalid snippet (a missing closing bracket, an unterminated string, a missing colon in Python, a bad indent in Python, `func` misuse in Go, a missing semicolon in Java, a stray `}`) gives an error whose line and column point at the bad spot; empty code, comments-only code and a 100 000-character valid file give none; code over 100 000 characters is not checked; more than 20 errors give exactly 20 markers.
- Editor (e2e): invalid code in each language shows a squiggle with the hover message; correcting it removes the squiggle within one second of the last keystroke; switching Python code to Java shows the Java result for the same text; no squiggle appears while the user is mid-typing for less than the debounce.
- TypeScript and JavaScript (e2e, per the answer to Question 2): with A, a snippet that uses an undefined name shows no squiggle but a syntax error does; with B, Monaco's squiggles still show.
- Coexistence (e2e): AI finding markers and glyphs appear together with a syntax squiggle on a different line, and neither clears the other when the language changes or the code is edited.
- Upload and drop: a `.py` file with an error shows the squiggle right after loading; a valid file shows none.
- Performance (e2e or unit with timing): typing 200 characters quickly never freezes the editor (no long task over 100 ms from the checker on a 5 000-line file), and a result for an old version of the code is never shown.
- Lazy load: the first page load does not request any grammar file; selecting Python requests only the Python grammar, once.
- Failure: if a grammar fails to load (blocked request), the editor keeps working, no squiggle appears, and a single toast is shown.
- Run review (Question 5): with A it stays enabled with a syntax error; with B it is disabled with a tooltip and enabled again after the fix.
- Docs: `.doc/architecture.md`, `.doc/glossary.md` and `README.md` describe the check; the README says nothing leaves the browser.
- Manual: type a syntax error in each of the five languages and see the squiggle and the message.

## Risks
- **False alarms or missed errors from a grammar.** Mitigation: a real grammar rather than hand-written rules; messages are generic; a table test per language; squiggles never block the user (Question 5 A).
- **Bundle size and load time.** Mitigation: lazy load per language, only on demand; the first page load is unchanged and tested.
- **New dependency (supply chain).** Mitigation: pinned versions at least two weeks old, `npm audit`, grammar files served from the app's own origin, and the dependency kept behind `syntaxCheck.ts`.
- **Two systems writing markers.** Mitigation: one marker owner for syntax errors, separate from `FINDING_MARKER_OWNER`; tests check they never clear each other.
- **Typing lag.** Mitigation: 400 ms debounce, stale results dropped, marker cap, size cap, and a performance check.
- **Changing TypeScript/JavaScript squiggles (Question 2 A) removes messages some users like.** Mitigation: it is a user decision recorded here, easy to revert by one setting.
- **Large wasm files make the e2e run flaky** (the Monaco CDN already does, per plan 029 QA). Mitigation: the grammars are local files, not a CDN.

## Rollout Order
1. Dependency and the checker with its unit tests.
2. The editor marker effect and the TS/JS setting.
3. E2E specs.
4. Docs.
5. QA, including the manual check in all five languages.

## Deviation notes (frontend agent, 2026-10-29)
- Scope 4: TypeScript and JavaScript syntax errors keep Monaco's own marker owners (`typescript`, `javascript`) instead of moving to `syntax`: copying them into another owner would fight the stale TS/JS cleanup of plan 027. Behaviour matches answer 2A (syntax errors only). Monaco's suggestion diagnostics are turned off too (`noSuggestionDiagnostics`): in JavaScript an undefined name shows up as a "Could not find name" hint otherwise.
- Existing e2e probes that used a TypeScript type error (`const count: number = "text"`) now use a syntax error (`1 +* 2`), and two "no squiggle after leaving TypeScript" assertions now allow the new `syntax` owner (that code is not valid Python or Go either).
- Performance: checked by a unit timing test (5 000 lines well under 100 ms in Node); no e2e long-task test, since Monaco's own tokenizing of a 5 000-line file makes long tasks of its own.

## Rollback
- Revert the branch. There is no backend, API or data change; the editor returns to colouring plus Monaco's TS/JS squiggles, and the grammar files and the dependency disappear with the branch.
