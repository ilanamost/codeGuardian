import { act } from '@testing-library/react'
import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CodeEditor from '../../src/components/CodeEditor'
import { EDITOR_MODEL_PATH, FINDING_MARKER_OWNER, SYNTAX_CHECK_DELAY_MS, SYNTAX_MARKER_OWNER, SYNTAX_MARKER_SOURCE } from '../../src/lib/review.constants'
import type { SyntaxErrorMark } from '../../src/lib/syntaxCheck'
import type { Finding } from '../../src/types'
import { ERROR_MESSAGE } from '../../src/utils/error-messages'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 032: the syntax markers of the editable editor, on a fake Monaco that records markers by
// owner. The checker is mocked; tests/unit/syntaxCheck.test.ts tests the real one.
const fake = vi.hoisted(() => {
  type Marker = { severity: number; message: string; source?: string; startLineNumber: number }
  const markerByOwner = new Map<string, Marker[]>()
  const model = {
    value: '',
    version: 1,
    disposed: false,
    uri: { toString: () => 'inmemory://model/1' },
    getValue: () => model.value,
    getVersionId: () => model.version,
    isDisposed: () => model.disposed,
    getLinesContent: () => model.value.split('\n'),
    getLanguageId: () => 'python',
    setEOL: () => {}
  }
  const disposable = { dispose: () => {} }
  const editor = {
    getModel: () => model,
    getDomNode: () => null,
    onDidDispose: () => disposable,
    onDidChangeModelLanguage: () => disposable,
    createDecorationsCollection: () => ({ set: () => {} })
  }
  const scriptDefault = () => {
    let option = { noSemanticValidation: false, noSyntaxValidation: false }
    return { getDiagnosticsOptions: () => option, setDiagnosticsOptions: (next: typeof option) => (option = next) }
  }
  const monaco = {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    Range: class {},
    typescript: { typescriptDefaults: scriptDefault(), javascriptDefaults: scriptDefault() },
    editor: {
      EndOfLineSequence: { LF: 0 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
      setModelMarkers: (_model: unknown, owner: string, list: Marker[]) => markerByOwner.set(owner, list),
      getModelMarkers: ({ owner }: { owner: string }) => markerByOwner.get(owner) ?? [],
      onDidChangeMarkers: () => disposable
    }
  }
  return { markerByOwner, model, editor, monaco, checkSyntax: vi.fn(), path: { current: undefined as string | undefined } }
})

vi.mock('@monaco-editor/react', () => ({
  default: function Editor({
    value,
    path,
    beforeMount,
    onMount
  }: {
    value: string
    path?: string
    beforeMount?: (m: unknown) => void
    onMount?: (e: unknown, m: unknown) => void
  }) {
    fake.path.current = path
    // The wrapper puts a new value on the model before the page's effects run.
    useLayoutEffect(() => {
      if (fake.model.value !== value) {
        fake.model.value = value
        fake.model.version += 1
      }
    }, [value])
    // Mounts once, as Monaco does.
    const mount = useRef({ beforeMount, onMount })
    useEffect(() => {
      mount.current.beforeMount?.(fake.monaco)
      mount.current.onMount?.(fake.editor, fake.monaco)
    }, [])
    return <div data-testid="monaco" />
  }
}))

vi.mock('../../src/lib/syntaxCheck', () => ({ checkSyntax: fake.checkSyntax }))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

const mark: SyntaxErrorMark = { startLine: 2, startColumn: 5, endLine: 2, endColumn: 6, message: 'Unexpected `)`' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  fake.markerByOwner.clear()
  fake.model.value = ''
  fake.model.version = 1
  fake.model.disposed = false
  fake.checkSyntax.mockResolvedValue([mark])
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// renderWithStore, with a rerender that keeps the same store and router.
function renderEditor(ui: ReactElement) {
  const result = renderWithStore(ui)
  const wrap = (next: ReactElement) => (
    <Provider store={result.store}>
      <MemoryRouter>{next}</MemoryRouter>
    </Provider>
  )
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) }
}

function syntaxMarker() {
  return fake.markerByOwner.get(SYNTAX_MARKER_OWNER)
}

function editorFor(code: string, language = 'Python', option: { readOnly?: boolean; finding?: Finding[] } = {}) {
  return <CodeEditor value={code} language={language} readOnly={option.readOnly ?? false} onChange={() => {}} finding={option.finding} />
}

describe('CodeEditor syntax markers', () => {
  it('marks the syntax errors 400 ms after the code is set, with their own owner', async () => {
    renderEditor(editorFor('x = 1\ny = )'))
    await wait(SYNTAX_CHECK_DELAY_MS - 1)
    expect(fake.checkSyntax).not.toHaveBeenCalled()
    await wait(1)
    expect(fake.checkSyntax).toHaveBeenCalledWith('Python', 'x = 1\ny = )')
    expect(syntaxMarker()).toEqual([
      { severity: fake.monaco.MarkerSeverity.Error, source: SYNTAX_MARKER_SOURCE, message: mark.message, startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 6 }
    ])
  })

  it('checks once after a burst of edits, with the latest code', async () => {
    const { rerender } = renderEditor(editorFor('x'))
    for (const code of ['x =', 'x = (', 'x = (1']) {
      await wait(200)
      rerender(editorFor(code))
    }
    expect(fake.checkSyntax).not.toHaveBeenCalled()
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(fake.checkSyntax).toHaveBeenCalledTimes(1)
    expect(fake.checkSyntax).toHaveBeenCalledWith('Python', 'x = (1')
  })

  it('clears the markers when the fixed code is valid', async () => {
    const { rerender } = renderEditor(editorFor('x = )'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(syntaxMarker()).toHaveLength(1)
    fake.checkSyntax.mockResolvedValue([])
    rerender(editorFor('x = 1'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(syntaxMarker()).toEqual([])
  })

  it('drops a result for an older version of the code', async () => {
    let finish: (value: SyntaxErrorMark[]) => void = () => {}
    fake.checkSyntax.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const { rerender } = renderEditor(editorFor('x = )'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    fake.checkSyntax.mockResolvedValue([])
    rerender(editorFor('x = 1'))
    await act(async () => finish([mark]))
    expect(syntaxMarker()).toBeUndefined()
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(syntaxMarker()).toEqual([])
  })

  it('clears the markers of the old language at once and checks again with the new one', async () => {
    const { rerender } = renderEditor(editorFor('x = )'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(syntaxMarker()).toHaveLength(1)
    rerender(editorFor('x = )', 'Java'))
    expect(syntaxMarker()).toEqual([])
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(fake.checkSyntax).toHaveBeenLastCalledWith('Java', 'x = )')
    expect(syntaxMarker()).toHaveLength(1)
  })

  it('keeps the finding markers when the syntax markers change, and the other way round', async () => {
    const finding: Finding[] = [{ id: 'f1', severity: 'high', category: 'bug', message: 'm', detail: 'd', line_start: 1 }]
    const { rerender } = renderEditor(editorFor('x = 1\ny = )', 'Python', { finding }))
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(fake.markerByOwner.get(FINDING_MARKER_OWNER)).toHaveLength(1)
    expect(syntaxMarker()).toHaveLength(1)
    rerender(editorFor('x = 1\ny = )', 'Java', { finding }))
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(fake.markerByOwner.get(FINDING_MARKER_OWNER)).toHaveLength(1)
    rerender(editorFor('x = 1\ny = )', 'Java', { finding: [] }))
    expect(fake.markerByOwner.get(FINDING_MARKER_OWNER)).toEqual([])
    expect(syntaxMarker()).toHaveLength(1)
  })

  it('gives the editable editor the .tsx model path and the read-only one none (QA F2)', () => {
    const { rerender } = renderEditor(editorFor('const a = <div />', 'TypeScript'))
    expect(fake.path.current).toBe(EDITOR_MODEL_PATH)
    expect(EDITOR_MODEL_PATH.endsWith('.tsx')).toBe(true)
    rerender(editorFor('const a = <div />', 'TypeScript', { readOnly: true }))
    expect(fake.path.current).toBeUndefined()
  })

  it('never checks the read-only editor (Generated tests)', async () => {
    renderEditor(editorFor('x = )', 'Python', { readOnly: true }))
    await wait(SYNTAX_CHECK_DELAY_MS * 3)
    expect(fake.checkSyntax).not.toHaveBeenCalled()
    expect(syntaxMarker()).toBeUndefined()
  })

  it('turns off TypeScript and JavaScript semantic validation before the editor mounts', async () => {
    renderEditor(editorFor('const x = 1', 'TypeScript'))
    await wait(0)
    expect(fake.monaco.typescript.typescriptDefaults.getDiagnosticsOptions()).toEqual({ noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true })
    expect(fake.monaco.typescript.javascriptDefaults.getDiagnosticsOptions()).toEqual({ noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true })
  })

  it('shows no marker and one toast per session when the checker cannot load', async () => {
    fake.checkSyntax.mockRejectedValue(new Error('blocked'))
    const { rerender } = renderEditor(editorFor('x = )'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    rerender(editorFor('x = ))'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    renderEditor(editorFor('y = )'))
    await wait(SYNTAX_CHECK_DELAY_MS)
    expect(fake.checkSyntax).toHaveBeenCalledTimes(3)
    expect(syntaxMarker()).toEqual([])
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(ERROR_MESSAGE.syntaxCheck)
  })
})
