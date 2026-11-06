# Code Editor: Visible Per-Language Syntax Highlighting

Status: done
Owner: Ilana
Last updated: 2026-10-26

## Goal
- When the user switches the language in the code editor, the code is visibly colored for that language: keywords, strings, comments, numbers, types and function names each get their own color, so TypeScript, JavaScript, Python, Go and Java code each look like that language in an IDE.
- A test proves the coloring changes with the language.

## Scope
- Backlog task: "It seems that the different coding languages are not supported in the code editor. When switching between the languages, the code looks the same." No `stack:full` marker, no Figma. Branch: `fix/code-editor-language`.
- **Diagnosis** (run in a real browser with a temporary Playwright spec, 2026-10-26):
  - The language switch works: Monaco's model language changes to `typescript`, `python`, `go`, `java` and `javascript` as the selector changes (`monacoLanguageId` in `frontend/src/lib/codeFile.ts`, `LANGUAGE_META` in `frontend/src/lib/review.constants.ts`).
  - Tokenization changes too: `func` is a keyword only in Go, `// c` is a comment in every language except Python, `int` is a keyword in Go, Java and Python.
  - But the built-in `vs-dark` theme on Monaco's basic (Monarch) grammars colors almost nothing: only keywords (blue), numbers (green), comments (green) and brackets. Identifiers, function names, types, parameters and most operators are all the same gray (`rgb(212, 212, 212)`). Most real code is therefore mostly gray in every language, and it looks the same.
  - The code text itself does not change on a switch (by design; only the coloring does). `/review/new` starts empty.
  - Monaco is loaded at runtime from the jsdelivr CDN (`@monaco-editor/react` default, no `loader.config` in `frontend/src`). Not the cause, but see Open Question 3.
- In scope:
  1. **Richer highlighting** for the five languages of `languageList`, per Open Question 1.
  2. One editor theme for both editors (Summary and Generated tests), built from the app's theme tokens where possible, and readable on `bg-code-bg` (WCAG AA contrast for text tokens).
  3. Keep everything that depends on the editor working: finding markers and glyphs, upload and drop, the language-from-file-name detection, the wide horizontal scrollbar, font size from Settings, read-only Generated tests editor.
  4. **Tests**: e2e test that types or loads the same sample per language and asserts that keywords, strings, comments, function names and types get the expected distinct colors, and that the colors of at least one token change when the language changes; unit tests for any new pure helper (theme rules, language map).
  5. **Docs**: `.doc/architecture.md` (how the editor is loaded and highlighted), `README.md` only if a new dependency or offline note is added.
- Out of scope:
  - New languages beyond `languageList` (TypeScript, JavaScript, Python, Go, Java).
  - Detecting the language from code content (plan 021 decided: selector or file name only).
  - Language-specific sample code on `/review/new` (Open Question 2).
  - IntelliSense, type checking or diagnostics from Monaco's language workers (the findings are the only diagnostics).
  - Backend, API contract and database.

## Assumptions
- The current e2e tests that read `.monaco-editor .view-lines` text, markers and glyphs keep working, because the DOM structure of Monaco does not change with the theme or grammar source.
- Unit tests keep mocking `@monaco-editor/react`; the coloring is checked in Playwright only.

## Open Questions
Answer inside this file (below each question). The recommended answer is used if you only write "approved".

1. **How should the richer highlighting be done?**
   - A. **TextMate grammars through Shiki (recommended).** Add `shiki` and `@shikijs/monaco` and highlight with VS Code's own grammars and a VS Code dark theme (for example `dark-plus`). Function names, types, parameters and properties get their own colors, so each language looks like it does in VS Code. Cost: two new dependencies and a larger editor chunk (the five grammars and one theme only, loaded with the editor).
   - B. A custom Monaco theme (`monaco.editor.defineTheme`) with more token rules on the built-in grammars. No new dependency, but the built-in grammars do not tag function names or most types, so the gain is smaller: strings, types where tagged, operators and delimiters get colors; identifiers stay one color.

   **Answer:** A.

2. **Should `/review/new` show a short language-specific example when the editor is empty?**
   - A. **No (recommended).** The editor stays empty; the fix is the coloring. Switching the language never replaces the user's code.
   - B. Yes, a placeholder hint (not real content) per language, shown only while the editor is empty.

   **Answer:** A.

3. **Should Monaco be bundled with the app instead of loaded from the jsdelivr CDN?**
   - A. **Yes (recommended).** `loader.config({ monaco })` with the npm `monaco-editor` package, so the editor works offline and no third-party script is loaded at runtime (`.rule/security-rules.md`, supply chain). Shiki (answer 1A) also needs the bundled instance.
   - B. No, keep the CDN. Smaller app bundle; the editor needs internet access and trusts the CDN.

   **Answer:** A, changed to **B** in Revision 3 (bundling removed existing editor features).

## Steps
1. Bundle Monaco if 3A (`frontend/src/lib/` setup module imported once by `CodeEditor`), with the editor web worker configured for Vite.
2. Add the highlighting per answer 1 in one place (`frontend/src/lib/`), registered before the first editor mounts; keep `LANGUAGE_META` as the single language map and add the grammar/theme ids there if needed.
3. Switch both editors to the new theme; keep the glyph and marker classes readable on it.
4. Tests: the e2e coloring spec (`frontend/tests/e2e/code-editor-highlighting.spec.ts`), unit tests for new helpers, and the existing editor, review and generated-tests specs.
5. Run `cd frontend && npm test`, `npm run typecheck` (only the known TS2550 errors are allowed), `npm run lint`, `npx vite build` (bundle size noted in the report), and the Playwright specs `code-editor`, `code-editor.qa`, `review-run`, `api-integration`, `responsive`, `github-link-import`.

## Validation
- [ ] `cd frontend && npm test` passes.
- [ ] `npm run typecheck` shows only the known TS2550 errors; `npm run lint` is clean.
- [ ] `npx vite build` succeeds; the editor chunk size before and after is recorded in `.orchestrate/frontend-agent-report.md`.
- [ ] New Playwright spec: for each of the five languages, a sample shows keywords, strings, comments and numbers in distinct colors; with 1A, function names and types also differ from plain identifiers.
- [ ] New Playwright spec: switching the language on the same code changes the color of at least one language-specific token (for example `func`, `def`, `public`, `interface`, `# comment`).
- [ ] Finding markers and glyphs, upload, drop and language-from-file-name still work (existing `code-editor` and `code-editor.qa` specs pass).
- [ ] The Generated tests editor uses the same theme and stays read-only (existing specs pass).
- [ ] With 3A: no request to `cdn.jsdelivr.net` when the editor loads (Playwright request log).
- [ ] No change under `backend/` or `.orchestrate/api-contract.yaml` (`git diff --stat`).
- [ ] No semicolons added, no new `.css` files, no inline styles (Monaco's own injected styles excepted).

## Risks
- Bundle size: Monaco plus Shiki grammars add to the editor chunk; it is already lazy-loaded with the editor, and only five grammars and one theme are included.
- Shiki highlighting replaces Monaco's tokenizer; if it loads after the editor mounts, the first paint may flash uncolored. Registering before the first mount avoids it.
- Vite worker setup for a bundled Monaco can break the dev server or the build; the build and the e2e suite catch it.

## Rollout Order
1. Bundled Monaco (if 3A), then the highlighting, then the theme.
2. Tests, QA run, your approval; mark the backlog item `[V]` and this plan `done`.

## Revision 1 (QA round 1, 2026-10-26)
QA failed round 1 (`.orchestrate/qa-report.md`); the highlighting itself passed. You chose to fix all four findings now:
- **F1 (regression):** `frontend/src/lib/useMonacoReady.ts` retries a failed load by re-importing, but the browser caches the failed dynamic import, so the editor stays on "Loading editor..." until a full reload. Fix: a failed state with a message and a "Reload" action (texts in `lib/review.constants.ts`), instead of the endless loading text (`frontend/src/components/CodeEditor.tsx`).
- **F2 (pre-existing):** Monaco sanitizes glyph class names, so the Tailwind classes in `FINDING_GLYPH_CLASS` (`lib/review.constants.ts`) are mangled and the finding dots are empty boxes. Fix: plain per-severity class names styled with the theme tokens in the existing `globals.css` (no new `.css` file). An e2e test asserts the painted color, not only the element count.
- **Bundle:** `frontend/src/lib/monacoSetup.ts` imports `monaco-editor/features/register.all`. Import only the features the app uses (QA estimate: 150-200 kB gzip less); record the chunk sizes before and after.
- **F3 (intermittent):** typing within about a second of an upload can jump the cursor to the end (CRLF in the model vs LF in page state on Windows). Fix: keep the model on LF (`model.setEOL`) and prove it with a deterministic test; turn QA's `test.fixme` into a passing test.

Validation additions:
- [ ] Load failure in a real browser (Playwright route abort): the failed message and Reload show; Reload loads the editor.
- [ ] Finding glyph dots are painted in their severity color (computed style), for critical/high, medium and low.
- [ ] `monacoSetup` chunk smaller than 1,360 kB raw; find, hover, folding and markers still work.
- [ ] Typing right after an upload never moves the cursor (QA spec, no `fixme`).

## Revision 2 (QA round 2, 2026-10-26)
QA round 2 passed every Revision 1 item and found two new defects, fixed under the approved plan:
- **R2-1 (low, from Revision 1):** `flushSync` wraps `onChange` even for the read-only Generated tests editor, where `@monaco-editor/react` fires it during React's commit, so each Regenerate logs a React error. Fix: only wrap when an `onChange` is given (`frontend/src/components/CodeEditor.tsx`).
- **R2-2 (medium):** `@shikijs/monaco` stops tokenizing a line after 500 ms; the first line after load can exceed it while grammars compile, so the rest of that line stays miscolored. Fix: warm up each grammar at the end of `setupMonaco` and raise `tokenizeTimeLimit` (`frontend/src/lib/monacoSetup.ts`).
- **O1 (observed once):** a one-off lazy-load failure of the editor in the full e2e run (passed 24/24 after). Investigate the cause (for example Vite re-optimizing dependencies on first load) and fix it if it is real.

Validation additions:
- [ ] Regenerate on the Generated tests editor logs no React error (QA spec `code-editor-r2.qa.spec.ts`).
- [ ] The first line of a review is fully colored at 4x CPU throttling (same spec, 3 runs).
- [ ] Full Playwright suite passes with no editor load failure.

## Revision 3 (your decision, 2026-10-26): add, never remove
Bundling Monaco (answer 3A) removed features the editor had from the CDN build: TypeScript/JavaScript IntelliSense, autocomplete, Monaco's own diagnostics squiggles, and (after the trim) the F1 command palette and Ctrl+G. The plan wrongly said Shiki needs a bundled Monaco; `shikiToMonaco` works on any Monaco instance, including the CDN-loaded one. Your direction: the change must only add, and switching the language must visibly change the code's syntax coloring.
- **Open Question 3 answer changes to B:** keep loading Monaco from the CDN, as before this plan. Revert the bundling (`frontend/src/lib/monacoSetup.ts` bundle and feature imports, `loader.config({ monaco })`, Vite worker setup), the feature trim, the `monaco-editor` dependency added for bundling, and the load-failure screen (F1, only needed for the bundled lazy load). Revision 2's R2-2 and O1 no longer apply in their bundled form.
- **Keep:** Shiki coloring (answer 1A), applied to the CDN Monaco instance (`beforeMount`) before the editor renders; the F2 glyph fix; the F3 fix (LF model, no lost keys after upload) without the read-only `flushSync` error (R2-1); the first line fully colored on load (warm-up / `tokenizeTimeLimit`, R2-2) if it still occurs.
- **Language switch (the reported problem):** switching the selector on the same code must recolor it for the new language in both editors, every time and in either direction, including right after load and after rapid switches.

Validation additions:
- [ ] IntelliSense/autocomplete suggestions appear while typing TypeScript, the F1 command palette and Ctrl+G open, and Monaco's TS/JS error squiggles show, as before this plan (Playwright).
- [ ] For each pair of languages, switching on the same sample code changes the color of language-specific tokens (for example `func`, `def`, `public class`, `interface`, `# comment`, `// comment`) and the editor's model language (Playwright, all five languages, both directions).
- [ ] `monaco-editor` is no longer a direct dependency; the editor loads as it did before this plan (the CDN request is expected again).
- [ ] Glyph dots painted in severity colors; no lost keys after upload; no React error on Regenerate.

## Revision 4 (QA round 3, 2026-10-26)
QA round 3 confirmed the language switch recolors in every pair of languages and nothing is lost vs HEAD, and found:
- **R3-1 (blocking, regression):** the editor waits for the Shiki import (`frontend/src/lib/useHighlight.ts`, `frontend/src/components/CodeEditor.tsx`). If that request stalls instead of failing, the editor stays on "Loading editor..." forever; HEAD has no such gate. Fix: never block the editor on Shiki. Render at once with Monaco's own `vs-dark`, apply Shiki when it is ready (set theme and re-tokenize the model), with no flash of wrong content and no regression for the first line. Test: QA's R3 "hang" test passes.
- **P1 (pre-existing, language switch):** after the language changes (selector or an uploaded `.py`, `.go`, `.java` into the TypeScript editor), Monaco's TypeScript error markers (dozens of red squiggles) stay over the code. Fix: clear the TypeScript/JavaScript diagnostics markers when the model language changes (or set the language before the value on upload). The three `test.fixme` tests in `code-editor-r3.qa.spec.ts` become passing tests. This is part of making a language switch look right, and it is small; flagged to you at approval.
- **Known limit, no change:** TypeScript and JavaScript color plain JS code identically (VS Code's JS grammar is generated from the TS one); HEAD was the same. JSX differs.

Validation additions:
- [ ] Shiki request stalled (never settles): the editor renders and works with `vs-dark`; when Shiki arrives, the colors switch without remounting the editor or losing the code and cursor.
- [ ] After switching language or uploading `.py`/`.go`/`.java`, no stale TypeScript error markers remain; real TS errors still show for TypeScript code.

## Revision 5 (QA round 4, 2026-10-26)
QA round 4 passed R3-1 and P1 and found one defect in the language switch itself:
- **R4-1 (medium):** when Shiki arrives while the CDN Monaco is still loading a language's built-in (Monarch) tokenizer, that tokenizer finishes loading after Shiki and replaces it for that language until a page reload (numbers and operators drawn plain, e.g. `42` not green). It happens on a slow first load when the user switches language right away. Fix in `frontend/src/lib/useHighlight.ts` / `frontend/src/lib/shikiHighlight.ts`: later token-provider registrations must not override Shiki for the five languages (or the Monarch modules finish loading before Shiki is applied, or Shiki's providers are re-applied when a language is first used). QA's R4 "late Shiki mid-upload and mid-language-switch" test passes.
- Test hygiene: the r2 paste test was flaky in the full run (empty shared clipboard); QA hardened it. No product change.

Process change (your request): fix rounds run unit tests and the specs for the area touched only; one full Playwright run happens once, before final approval.

Validation addition:
- [ ] After a slow first load, switching language right away colors the code with Shiki for that language, and still does after re-selecting it (Playwright, all five languages).

## Rollback
- Revert the branch `fix/code-editor-language`. No data, contract or schema changes. Removing the new dependencies restores the CDN-loaded editor.
