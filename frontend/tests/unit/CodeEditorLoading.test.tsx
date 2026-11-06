import { act, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CodeEditor from '../../src/components/CodeEditor'
import { EDITOR_THEME_ID } from '../../src/lib/editorHighlight'
import type { Highlight } from '../../src/lib/useHighlight'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 027: the CDN editor never waits for Shiki (QA round 3, R3-1). It renders with vs-dark until
// the highlighting is ready, then with the Shiki theme; beforeMount puts Shiki on Monaco.
const state = vi.hoisted(() => ({ highlight: { status: 'loading' } as Highlight, props: vi.fn() }))

vi.mock('../../src/lib/useHighlight', () => ({ useHighlight: () => state.highlight }))

type EditorProps = {
  value: string
  theme: string
  onChange?: (next: string) => void
  beforeMount?: (monaco: unknown) => void
  onMount?: (editor: unknown, monaco: unknown) => void
}

vi.mock('@monaco-editor/react', () => ({
  default: (props: EditorProps) => {
    state.props(props)
    return <div data-testid="monaco">{props.value}</div>
  }
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

const last = () => state.props.mock.calls.at(-1)?.[0] as EditorProps

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('CodeEditor and the Shiki highlighting', () => {
  it('renders the editor at once with vs-dark while the highlighting loads', () => {
    state.highlight = { status: 'loading' }
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)
    expect(screen.getByTestId('monaco')).toHaveTextContent('const a = 1')
    expect(last().theme).toBe('vs-dark')
    expect(() => last().beforeMount?.({ editor: {} })).not.toThrow()
  })

  it('renders the editor with the shared theme and puts the highlighting on Monaco before it mounts', () => {
    const apply = vi.fn()
    state.highlight = { status: 'ready', apply }
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)
    expect(screen.getByTestId('monaco')).toHaveTextContent('const a = 1')
    expect(last().theme).toBe(EDITOR_THEME_ID)

    const monaco = { editor: {} }
    last().beforeMount?.(monaco)
    expect(apply).toHaveBeenCalledWith(monaco)
  })

  it('falls back to Monaco\'s own coloring and theme when the highlighting could not load, without an error', () => {
    state.highlight = { status: 'failed' }
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)
    expect(screen.getByTestId('monaco')).toHaveTextContent('const a = 1')
    expect(last().theme).toBe('vs-dark')
    expect(() => last().beforeMount?.({ editor: {} })).not.toThrow()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('CodeEditor value sync (QA round 1, F3, and round 2, R2-1)', () => {
  beforeEach(() => {
    state.highlight = { status: 'ready', apply: () => {} }
  })

  // @monaco-editor/react syncs `value` in an effect; the page's update for a typed key is
  // committed before onChange returns, so that effect never sees an older value.
  it('commits the page update for a typed key before the next key can arrive', () => {
    let setCode: (code: string) => void = () => {}
    function Harness() {
      const [code, set] = useState('a')
      setCode = set
      return <CodeEditor value={code} language="TypeScript" readOnly={false} onChange={set} />
    }
    renderWithStore(<Harness />)
    expect(last().value).toBe('a')

    // No act(): the re-render with the typed code has happened when onChange returns.
    last().onChange?.('ab')
    expect(last().value).toBe('ab')
    last().onChange?.('abc')
    expect(last().value).toBe('abc')

    // A change from outside (an upload) still reaches the editor.
    act(() => setCode('uploaded'))
    expect(last().value).toBe('uploaded')
  })

  it('gives the read-only editor no onChange, so the wrapper never calls flushSync inside a commit', () => {
    renderWithStore(<CodeEditor value="test()" language="TypeScript" />)
    expect(last().onChange).toBeUndefined()
  })

  it('passes the code to the editor with LF line breaks', () => {
    renderWithStore(<CodeEditor value={'const a = 1\r\nconst b = 2\r\n'} language="TypeScript" />)
    expect(last().value).toBe('const a = 1\nconst b = 2\n')
  })
})

// QA round 3, P1: Monaco's TypeScript/JavaScript diagnostics are cleared from a model of another
// language, when the language changes and when the service marks the model late.
describe('CodeEditor and stale TypeScript diagnostics', () => {
  function fakeMonaco(languageId: { current: string }) {
    const uri = { toString: () => 'inmemory://model/1' }
    const markerByOwner: Record<string, unknown[]> = { typescript: [{ message: 'old' }], javascript: [] }
    const listener = { language: () => {}, marker: (_uriList: { toString: () => string }[]) => {} }
    const model = { uri, getLanguageId: () => languageId.current, getLinesContent: () => ['x'], setEOL: () => {} }
    const editor = {
      getModel: () => model,
      getDomNode: () => null,
      onDidChangeModelLanguage: (callback: () => void) => {
        listener.language = callback
        return { dispose: () => {} }
      },
      createDecorationsCollection: () => ({ set: () => {} })
    }
    const setModelMarkers = vi.fn((_model: unknown, owner: string, list: unknown[]) => {
      markerByOwner[owner] = list
    })
    const monaco = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
      Range: class {},
      editor: {
        EndOfLineSequence: { LF: 0 },
        TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
        getModelMarkers: ({ owner }: { owner: string }) => markerByOwner[owner] ?? [],
        setModelMarkers,
        onDidChangeMarkers: (callback: (uriList: { toString: () => string }[]) => void) => {
          listener.marker = callback
          return { dispose: () => {} }
        }
      }
    }
    return { editor, monaco, markerByOwner, listener, uri, setModelMarkers }
  }

  beforeEach(() => {
    state.highlight = { status: 'ready', apply: () => {} }
  })

  it('keeps TypeScript markers on TypeScript code', () => {
    const languageId = { current: 'typescript' }
    const fake = fakeMonaco(languageId)
    renderWithStore(<CodeEditor value="const a: number = 'x'" language="TypeScript" />)
    act(() => last().onMount?.(fake.editor, fake.monaco))
    expect(fake.markerByOwner.typescript).toHaveLength(1)
    expect(fake.setModelMarkers).not.toHaveBeenCalledWith(expect.anything(), 'typescript', [])
  })

  it('clears TypeScript markers when the language changes, and when they arrive after the change', () => {
    const languageId = { current: 'typescript' }
    const fake = fakeMonaco(languageId)
    renderWithStore(<CodeEditor value="def f(): pass" language="TypeScript" />)
    act(() => last().onMount?.(fake.editor, fake.monaco))

    languageId.current = 'python'
    fake.listener.language()
    expect(fake.markerByOwner.typescript).toEqual([])

    // A check of the old TypeScript code finishes late and marks the Python code.
    fake.markerByOwner.typescript = [{ message: 'late' }]
    fake.listener.marker([fake.uri])
    expect(fake.markerByOwner.typescript).toEqual([])
  })

  it('clears TypeScript markers from JavaScript code, but not JavaScript ones', () => {
    const languageId = { current: 'javascript' }
    const fake = fakeMonaco(languageId)
    fake.markerByOwner.javascript = [{ message: 'js error' }]
    renderWithStore(<CodeEditor value="let a = 1" language="JavaScript" />)
    act(() => last().onMount?.(fake.editor, fake.monaco))
    expect(fake.markerByOwner.typescript).toEqual([])
    expect(fake.markerByOwner.javascript).toHaveLength(1)
  })
})
