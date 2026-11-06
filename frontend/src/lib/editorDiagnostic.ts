// Monaco's own TypeScript and JavaScript diagnostics (the CDN build's language service) mark their
// errors under the language id as owner. They belong only to a model of that language.
export const SCRIPT_DIAGNOSTIC_OWNER_LIST = ['typescript', 'javascript']

// The diagnostics owners whose markers are stale on a model of `languageId` (QA round 3, P1): after
// a switch to Python, Go or Java, or an upload of such a file into the TypeScript editor, the
// TypeScript service can still finish a check of the code and mark it. Only Monaco's own owners
// are listed: the finding and syntax owners (lib/review.constants.ts) are never cleared here.
export function staleDiagnosticOwnerList(languageId: string): string[] {
  return SCRIPT_DIAGNOSTIC_OWNER_LIST.filter((owner) => owner !== languageId)
}

// The part of Monaco's TypeScript language defaults this module uses (no Monaco types here).
type DiagnosticOption = { noSemanticValidation?: boolean; noSyntaxValidation?: boolean; noSuggestionDiagnostics?: boolean }
type CompilerOption = Record<string, unknown> & { jsx?: unknown }
type ScriptDefault = {
  getDiagnosticsOptions: () => DiagnosticOption
  setDiagnosticsOptions: (option: DiagnosticOption) => void
  getCompilerOptions?: () => CompilerOption
  setCompilerOptions?: (option: CompilerOption) => void
}
type ScriptLanguage = { typescriptDefaults?: ScriptDefault; javascriptDefaults?: ScriptDefault; JsxEmit?: { Preserve?: number } }
export type ScriptMonaco = { typescript?: unknown; languages?: { typescript?: unknown } }

function isScriptLanguage(value: unknown): value is Required<ScriptLanguage> {
  const item = value as ScriptLanguage | undefined
  return typeof item?.typescriptDefaults?.setDiagnosticsOptions === 'function' && typeof item.javascriptDefaults?.setDiagnosticsOptions === 'function'
}

// Plan 032 (answer 2A): TypeScript and JavaScript show syntax errors only. Monaco's semantic
// validation ("Cannot find name", "Cannot find module", common in a snippet pasted without its
// imports) is turned off and its syntax validation kept. Its suggestion diagnostics (hints about
// an unknown name in JavaScript, also semantic) are turned off too. The CDN build exposes
// the defaults as `monaco.typescript` (0.55 and later) or `monaco.languages.typescript`
// (earlier). Returns whether they were found. Setting the same options again changes nothing.
const SYNTAX_ONLY_OPTION = { noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true }

// TypeScript's `JsxEmit.Preserve`, used when the Monaco build does not expose the enum.
const JSX_PRESERVE = 1

// QA F2: the editable editor's model has a `.tsx` path (EDITOR_MODEL_PATH), so TypeScript code may
// hold JSX like a VS Code `.tsx` file; `jsx: Preserve` is set with it, as a `.tsx` file needs a
// JSX mode.

export function applyScriptDiagnosticOption(monaco: ScriptMonaco): boolean {
  const script = [monaco.typescript, monaco.languages?.typescript].find(isScriptLanguage)
  if (!script) return false
  for (const defaults of [script.typescriptDefaults, script.javascriptDefaults]) {
    const current = defaults.getDiagnosticsOptions()
    const key = Object.keys(SYNTAX_ONLY_OPTION) as (keyof DiagnosticOption)[]
    if (!key.every((name) => current[name] === SYNTAX_ONLY_OPTION[name])) defaults.setDiagnosticsOptions({ ...current, ...SYNTAX_ONLY_OPTION })
    const compiler = defaults.getCompilerOptions?.()
    if (compiler && compiler.jsx === undefined) defaults.setCompilerOptions?.({ ...compiler, jsx: script.JsxEmit?.Preserve ?? JSX_PRESERVE })
  }
  return true
}
