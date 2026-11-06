# Generated Tests Tab UI (mock data)

Status: done
Owner: Ilana
Last updated: 2026-10-19

## Goal
- Build the "Generated tests" tab of the Review Results page from the "Generated Tests" panel in `frontend/src/assets/code-reviewer-concept.png`, with mock data only.

## Scope
- Frontend only (no `stack:full`); no backend, no AI calls. No Figma attached.
- In scope, inside the existing `Generated tests` tab of `ReviewTabs`:
  - A left sidebar card (`TestConfigPanel`):
    - **Test Configuration** title.
    - **Framework** dropdown (for example Jest).
    - **Test Type** checkboxes, several selectable: Unit Tests, Edge Cases, Error Cases.
    - **Tests generated for** title, then the list of files the tests were generated for, file names in bold with the language below each (for example "TypeScript"). The active file is highlighted; clicking a file shows its tests in the editor.
    - **Copy All** button below the content: copies the tests of all files together to the clipboard.
  - The main area: the Monaco editor (`CodeEditor`, same `vs-dark` colors as the Summary tab) showing the tests of the active file, with a header showing the **file name** (when the code came from a GitHub repository file) and a **Copy** button on the right that copies the shown tests to the clipboard.
  - A **Regenerate** button at the top of the tab (mock: short loading state, then new mock test content, toast "Tests regenerated").
  - Mock data in `src/mocks/review.ts` (generated tests per file, frameworks, test types); types in `src/types/index.ts`; the tab label count comes from the data instead of the hard-coded `(1)`.
- Out of scope: real test generation, real regeneration, changing tests by framework/type on the server, saving files, other tabs (Findings, Suggested refactors), mobile layout beyond not breaking.

## Assumptions
- Reuse the existing `CodeEditor` (Monaco, `vs-dark`) by extending it with optional props: a `title` (file name), an optional right-side action (Copy button), and hiding the language select when no language list is given. The Summary tab keeps working unchanged.
- Copy uses `navigator.clipboard.writeText` and shows a `sonner` toast ("Copied to clipboard"); if the clipboard is unavailable, an error toast. Toasts already have a close button.
- Mock data has two files from a GitHub repo (for example `src/userService.ts` and `src/hooks/useAuth.ts`, both TypeScript) so that the list, switching and Copy All are visible. The file name shows in the editor header only when the file has a `repo` set; for a pasted snippet it falls back to "Generated tests".
- Framework and Test Type choices are UI state only in this task; they do not change the mock code (no functionality yet). Regenerate swaps to an alternate mock version per file.
- Cards use `bg-card`, theme tokens only (no hard-coded hex), icons from `lucide-react` (`Copy`, `RefreshCw`, `Info`).
- File names in the list are bold, list content is left-aligned and long names truncate without clipping (lessons from earlier UI fixes).

## Open Questions
1. Frameworks in the dropdown? Recommended: **Jest, Vitest, Mocha** (default Jest).
2. Test Type defaults? Recommended: **Unit Tests checked, Edge Cases and Error Cases checked** as in the concept (all three selected); all can be toggled freely, including none.
3. Where does Regenerate sit? Recommended: **top right of the tab content**, above the sidebar and editor, as in the concept header.
4. Copy All format: **tests of each file separated by a comment line with the file name** (for example `// ---- src/userService.test.ts ----`). Recommended: yes.
5. Test file names: show the **test file name** (for example `userService.test.ts`) in the editor header, with the source file in the sidebar list? Recommended: **yes**, as in the concept (list shows source files, header shows the test file).

## Steps
1. Branch `feat/generated-tests-tab` from the current branch.
2. Types: `GeneratedTestFile` (`id`, `sourceFile`, `testFile`, `language`, `repo?`, `code`, `altCode`), `TestFramework`, `TestType`.
3. Mocks in `src/mocks/review.ts`: `generatedTestFileList`, `frameworkList`, `testTypeList`; replace the single `generatedTest` string in `ReviewMock`.
4. Extend `CodeEditor` with optional `title`, `action` and hidden language select; keep existing behavior and tests.
5. Components in `src/components/`: `GeneratedTestsTab` (layout + state), `TestConfigPanel` (framework select, test type checkboxes, file list, Copy All), `CopyButton`.
6. Wire into `ReviewTabs` (tab label count from data, remove the `<pre>` placeholder).
7. Tests (Vitest + RTL, Monaco mocked): framework dropdown options, several test types checkable and unchecked, file list shows bold names and language, clicking a file switches the editor content, header shows the file name, Copy writes the shown tests to the clipboard (mock `navigator.clipboard`) and toasts, Copy All writes all files separated by headers, Regenerate shows loading then new content and a toast, tab label count.
8. Update `.doc/architecture.md` (components, change log) and `.doc/glossary.md` (generated test, test type, framework).

## Validation
- `cd frontend && npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check with `npm run dev` against the concept image (sidebar, editor colors, header, buttons).

## Risks
- The Monaco mock in tests hides the editor content; tests assert on the props passed to the mock.
- `navigator.clipboard` is missing in jsdom; tests must stub it.
- Extending `CodeEditor` could regress the Summary tab; covered by existing tests.
- Concept is a raster image, so spacing and sizing are approximate.

## Rollout Order
1. Types and mocks. 2. `CodeEditor` extension. 3. Sidebar, copy buttons and tab layout. 4. Tests and docs.

## Rollback
- Revert the branch commit(s); `ReviewTabs` returns to the `<pre>` placeholder.
