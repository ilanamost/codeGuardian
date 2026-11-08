# Plan 050: UI fixes — Monaco error tooltips, editor vertical scrollbar, phone tap targets

Status: done (approved 2026-11-08; Q1 to Q3 = A, the recommended answers; QA passed items 1 to 8, item 9 is the owner's iPhone check; known limits in the backlog)
Owner: orchestrator (frontend agent implements)
Last updated: 2026-11-08
Branch: feat/ui-fixes-editor-and-tap-targets
Backlog task: "UI fixes" with three parts: (1) some Monaco error tooltips are cut and should be fully readable; (2) vertical scrolling is difficult on mobile, so make the vertical scrollbar of the Monaco editor as thick as the horizontal one; (3) phone tap targets from plan 049's check: "Switch account" (16 px high) and the link import's "Import" (36 px high) need at least 44 px, then move the draft phone spec into `frontend/tests/e2e/github-mobile.spec.ts` with hard tap-size assertions.
Figma: none
Related: plan 021 (code editor, horizontal scrollbar), plan 029 (mobile editor scrollbar), plan 032 (syntax errors), plan 049 (phone check), plan 008, 023 and 030 (wizard and link import), plan 012 (responsive layout)

## Goal
- Every Monaco error or finding tooltip can be read in full, on desktop and on a phone-size viewport.
- The vertical scrollbar of the code editor is as thick as the horizontal one, so it can be dragged with a finger and all the code is reachable.
- Every button on the GitHub Integration page is at least 44 px high and 44 px wide on a phone, and a Playwright spec in the repo fails if one shrinks again.
- Desktop layout is unchanged except what the first two points need.

## Scope
Frontend only (no `stack:full` marker): `frontend/src/components/CodeEditor.tsx`, `frontend/src/lib/config.ts` (and `frontend/src/lib/editorDiagnostic.ts` only if the tooltip audit shows it), `frontend/src/styles/` only if the audit shows a clipping rule, `frontend/src/components/GithubConnectCard.tsx`, `GithubLinkImport.tsx`, `WizardFooter.tsx`, `WizardStepper.tsx` (as the audit shows), tests, docs if a described behaviour changes. No backend, contract or store change.

Out of scope: tap targets on other pages, a global button component, the Monaco hover on touch devices that have no hover (see Q1), the two pending non-UI backlog items.

## Findings from the code
- **Tooltips.** `CodeEditor.tsx:246-250` wraps the editor in a `<section>` with `overflow-hidden` and a fixed height (`h-[42dvh]` on phones). Monaco draws its hover widget (syntax error markers from plan 032 and the AI finding `glyphMarginHoverMessage` at line 235) inside the editor's own DOM, so a long message is clipped by the editor box or the section. The editor options at lines 333 to 345 do not set `fixedOverflowWidgets`, the Monaco option that renders hover and suggest widgets with `position: fixed` so they can leave the editor box.
- **Vertical scrollbar.** `verticalScrollbarSize: scrollbarSize` at `CodeEditor.tsx:342` uses the global 4 px size (`frontend/src/lib/config.ts:3`), while the horizontal bar uses `editorHorizontalScrollbarSize` (16 px below `md`, 12 px from `md`). The config comment at lines 5 to 8 says so on purpose, from plan 021.
- **Tap targets.** "Switch account" (`GithubConnectCard.tsx`) is a bare `text-xs` button, 16 px high. "Import" (`GithubLinkImport.tsx`) is `px-4 py-2 text-sm`, 36 px high. Not measured in plan 049, so unknown but probably short: "Connect GitHub" (`px-3 py-1.5`), and "Cancel", "Next", "Approve" (`WizardFooter.tsx`, `px-4 py-2`), and the finished-step button in `WizardStepper.tsx`.
- Tailwind v4 utilities only, no new `.css` files, no inline styles (`.claude/rules/ui-and-styling.md`). Breakpoints: `xs` 480, `md` 768, `lg` 1024, `xl` 1280 (`frontend/src/styles/setup/theme.css`).
- Existing editor specs to keep green: `editor-mobile-scroll.spec.ts`, `editor-phone-layout.spec.ts`, `editor-syntax-error.spec.ts`, `qa-editor-syntax-error.spec.ts`, `code-editor*.spec.ts`. The draft phone spec (plan 049 scratchpad) imports no backend harness, so `.github/workflows/deploy-frontend.yml` needs no change for it.

## Assumptions
- A tooltip is "cut" when part of its text is hidden by an edge of the editor box or the page. It is "fully visible" when its whole box lies inside the browser window.
- A tap target is the element the user touches, measured by its bounding box; rows tapped through their label are already 44 px or more.
- Chromium emulation of an iPhone 13 is the automated check; the real iPhone stays manual.
- Code style: no trailing semicolons.

## Open Questions
Answer inline under each. Recommended answer first.

**Q1. What exactly is cut in the tooltip?**
- (A, recommended) The hover box is clipped by the edge of the editor (or the page) and the end of a long message is hidden. Fix: render the Monaco widgets outside the editor box (`fixedOverflowWidgets`) and verify that no part of the box leaves the window.
- (B) The text inside the box is shortened with "..." or a scroll. Fix: allow the box to grow to the message length (hover sizing options).
- (C) It happens on a phone, where there is no hover. Fix: also show the message on tap (a larger piece of work; would be split into its own plan).
Answer: (not answered yet)

**Q2. How thick is the vertical scrollbar?**
- (A, recommended) The same as the horizontal one: 16 px below `md`, 12 px from `md` up, in one shared constant.
- (B) 16 px at every width.
Answer: (not answered yet)

**Q3. Tap targets: which controls, up to which width, how enlarged?**
- (A, recommended) Every button on `/github` that the audit finds shorter than 44 px (the two reported ones plus Connect GitHub, Cancel, Next, Approve and any finished-step button), below `md` (768 px) only, enlarged with `min-h-11` (and padding plus a minimum width for the bare "Switch account" text button). From `md` up the current sizes stay.
- (B) Only the two reported buttons.
- (C) At every width.
Answer: (not answered yet)

## Steps
1. **Audit** (frontend agent, no source change yet): (a) in a Playwright run at 390x844 and 320x568 and at 1280x720, trigger a long syntax error (for example a long unterminated string in TypeScript) and a long AI finding on the editor, hover it, and record the hover box's bounding box against the window and the editor box; (b) record the vertical and horizontal scrollbar sizes; (c) measure every button on `/github` (both wizard steps and the link import). Write the numbers into `.orchestrate/frontend-agent-report.md`.
2. **Tests first**: a Playwright spec `frontend/tests/e2e/editor-tooltip.spec.ts` (hover box inside the window, whole text visible, on desktop and phone viewports); a unit test that the vertical scrollbar size equals the horizontal one at both breakpoints (`frontend/tests/unit/`); the draft phone spec moved to `frontend/tests/e2e/github-mobile.spec.ts` with hard tap-size assertions for every button the audit lists. All fail before the fix.
3. **Fix**: tooltip per Q1; a shared constant for the editor scrollbar size in `frontend/src/lib/config.ts` used for both bars (and the comment updated); tap targets per Q3.
4. **Regression**: the editor specs listed in Findings, the wizard and link import specs (`github-wizard.spec.ts`, `github-link-import.spec.ts`) and the layout specs still pass; at 1280 px the sizes of Next, Cancel, Connect GitHub and Import are unchanged.
5. Run `cd frontend && npm test`, `npm run typecheck` (2 known `String.isWellFormed` errors), `npm run lint`, and the new and the listed Playwright specs.
6. Update `.doc/summary-frontend.md` if a described behaviour changes (scrollbar sizes, tooltips).

## Validation
1. A long syntax error tooltip and a long AI finding tooltip lie fully inside the browser window and show their whole text, at 1280x720, 390x844 and 320x568 (Playwright: hover box inside the window; text equals the marker message).
2. The vertical scrollbar of the code editor measures the same as the horizontal one: 16 px at 390 and 320 wide, 12 px at 768 and up (unit test of the constant and a Playwright size check of the Monaco scrollbar elements).
3. On a touch viewport, the code editor scrolls vertically by dragging the thicker bar until the last line is visible (Playwright, extends `editor-mobile-scroll.spec.ts`).
4. At 390x844 and 320x568 every button on `/github` (wizard steps 1 and 2, link import) has a bounding box of at least 44x44 px (hard assertions in `github-mobile.spec.ts`).
5. At those viewports there is no horizontal scroll, and the first and last controls are reachable and not covered by the bottom navigation; both GitHub flows still end in the editor with the code, with the session cookie stripped and the token stored.
6. At 1280 px the sizes of Next, Cancel, Connect GitHub and Import are the same as before this plan, and the editor layout is unchanged apart from the wider scrollbar rule.
7. The new specs fail against the code before the fixes (shown in the agent's report) and pass after.
8. `cd frontend && npm test` passes; typecheck shows only the 2 known errors; lint is clean; the editor and GitHub specs listed in Findings pass.
9. Manual (owner): on the iPhone 13, the editor scrolls easily, long error messages can be read in full, and Switch account and Import are easy to tap.

## Risks
- `fixedOverflowWidgets` moves the hover into a fixed-position layer; the scroll guard (`frontend/src/lib/editorScrollGuard.ts`) and the dark editor theme classes must still apply to it, and a transformed ancestor could still clip it. The audit and the spec cover it.
- A 16 px vertical bar takes 12 px more width from the code on a phone; the editor stays readable because word wrap is off and the horizontal bar already does the same.
- Taller buttons can wrap or crowd the connect card at 320 px; the 320x568 run covers it.
- On touch devices Monaco shows no hover, so Q1 (C) would remain open if that is the report; it would be a separate plan.
- Playwright's bounding box measures the element, not an invisible tap overlay, which is why Q3 uses real size.
- Nothing is committed without your approval.

## Rollout Order
1. Audit. 2. Failing specs. 3. Fixes. 4. Full run. 5. Owner checks on the iPhone after the web app is deployed.

## Rollback
Revert the branch `feat/ui-fixes-editor-and-tap-targets`. No backend, contract, migration or store change.
