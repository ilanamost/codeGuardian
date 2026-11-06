import { describe, expect, it, vi } from 'vitest'
import { applyScriptDiagnosticOption, SCRIPT_DIAGNOSTIC_OWNER_LIST, staleDiagnosticOwnerList } from '../../src/lib/editorDiagnostic'
import { FINDING_MARKER_OWNER, SYNTAX_MARKER_OWNER } from '../../src/lib/review.constants'

// QA round 3, P1: which of Monaco's script diagnostics are stale on a model of a language.
describe('staleDiagnosticOwnerList', () => {
  it('keeps the diagnostics of the model language and drops the other script one', () => {
    expect(staleDiagnosticOwnerList('typescript')).toEqual(['javascript'])
    expect(staleDiagnosticOwnerList('javascript')).toEqual(['typescript'])
  })

  it.each(['python', 'go', 'java'])('drops both script diagnostics on %s code', (languageId) => {
    expect(staleDiagnosticOwnerList(languageId)).toEqual(SCRIPT_DIAGNOSTIC_OWNER_LIST)
  })

  it.each(['typescript', 'javascript', 'python', 'go', 'java'])('never lists the syntax or finding owner (%s)', (languageId) => {
    expect(staleDiagnosticOwnerList(languageId)).not.toContain(SYNTAX_MARKER_OWNER)
    expect(staleDiagnosticOwnerList(languageId)).not.toContain(FINDING_MARKER_OWNER)
  })
})

// Plan 032 (answer 2A): TypeScript and JavaScript keep syntax validation, without semantic errors.
describe('applyScriptDiagnosticOption', () => {
  function scriptDefault(option: Record<string, unknown> = {}) {
    let current = { noSemanticValidation: false, noSyntaxValidation: false, onlyVisible: false, ...option }
    return {
      getDiagnosticsOptions: () => current,
      setDiagnosticsOptions: vi.fn((next: typeof current) => {
        current = next
      })
    }
  }

  it('turns semantic and suggestion diagnostics off and keeps syntax validation and the other options', () => {
    const typescriptDefaults = scriptDefault()
    const javascriptDefaults = scriptDefault({ noSyntaxValidation: true })
    expect(applyScriptDiagnosticOption({ typescript: { typescriptDefaults, javascriptDefaults } })).toBe(true)
    expect(typescriptDefaults.getDiagnosticsOptions()).toEqual({ noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true, onlyVisible: false })
    expect(javascriptDefaults.getDiagnosticsOptions()).toEqual({ noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true, onlyVisible: false })
  })

  it('finds the defaults on monaco.languages.typescript in older builds', () => {
    const typescriptDefaults = scriptDefault()
    const javascriptDefaults = scriptDefault()
    expect(applyScriptDiagnosticOption({ typescript: { deprecated: true }, languages: { typescript: { typescriptDefaults, javascriptDefaults } } })).toBe(true)
    expect(typescriptDefaults.getDiagnosticsOptions().noSemanticValidation).toBe(true)
  })

  it('sets nothing again when the options are already applied', () => {
    const typescriptDefaults = scriptDefault()
    const javascriptDefaults = scriptDefault()
    applyScriptDiagnosticOption({ typescript: { typescriptDefaults, javascriptDefaults } })
    applyScriptDiagnosticOption({ typescript: { typescriptDefaults, javascriptDefaults } })
    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1)
  })

  // QA F2: the editable model is a `.tsx` file, which needs a JSX mode.
  function compilerDefault(option: Record<string, unknown> = {}) {
    let current: Record<string, unknown> = { target: 99, ...option }
    return {
      ...scriptDefault(),
      getCompilerOptions: () => current,
      setCompilerOptions: vi.fn((next: Record<string, unknown>) => {
        current = next
      })
    }
  }

  it('sets jsx: Preserve for TypeScript and JavaScript and keeps the other compiler options', () => {
    const typescriptDefaults = compilerDefault()
    const javascriptDefaults = compilerDefault()
    applyScriptDiagnosticOption({ typescript: { typescriptDefaults, javascriptDefaults, JsxEmit: { Preserve: 1 } } })
    expect(typescriptDefaults.getCompilerOptions()).toEqual({ target: 99, jsx: 1 })
    expect(javascriptDefaults.getCompilerOptions()).toEqual({ target: 99, jsx: 1 })
  })

  it('keeps a JSX mode that is already set', () => {
    const typescriptDefaults = compilerDefault({ jsx: 4 })
    const javascriptDefaults = compilerDefault()
    applyScriptDiagnosticOption({ typescript: { typescriptDefaults, javascriptDefaults } })
    expect(typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled()
    expect(javascriptDefaults.getCompilerOptions().jsx).toBe(1)
  })

  it('returns false when Monaco has no TypeScript defaults', () => {
    expect(applyScriptDiagnosticOption({})).toBe(false)
    expect(applyScriptDiagnosticOption({ languages: { typescript: { deprecated: true } } })).toBe(false)
  })
})
