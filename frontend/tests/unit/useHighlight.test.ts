import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Plan 027 Revision 3: the real hook (tests/setup.ts mocks it for every other unit test). Shiki
// and the CDN loader need a browser and are replaced here.
vi.unmock('../../src/lib/useHighlight')

const mock = vi.hoisted(() => ({
  createEditorHighlighter: vi.fn<() => Promise<unknown>>(),
  applyHighlight: vi.fn(),
  init: vi.fn<() => Promise<unknown>>(() => Promise.resolve({})),
  instance: vi.fn<() => unknown>(() => null)
}))
vi.mock('../../src/lib/shikiHighlight', () => ({
  createEditorHighlighter: mock.createEditorHighlighter,
  applyHighlight: mock.applyHighlight
}))
vi.mock('@monaco-editor/react', () => ({ loader: { init: mock.init, __getMonacoInstance: mock.instance } }))

// The hook keeps its state per module: each test loads a fresh copy.
async function freshHook() {
  vi.resetModules()
  return import('../../src/lib/useHighlight')
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.instance.mockReturnValue(null)
  mock.init.mockImplementation(() => Promise.resolve({}))
})

describe('useHighlight', () => {
  it('is loading until the highlighter exists, then ready, and apply puts it on Monaco', async () => {
    const highlighter = { id: 'shiki' }
    let finish = (value: unknown) => value
    mock.createEditorHighlighter.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { useHighlight } = await freshHook()

    const { result } = renderHook(() => useHighlight())
    expect(result.current.status).toBe('loading')
    // Monaco's CDN load starts at the same time.
    expect(mock.init).toHaveBeenCalledTimes(1)

    finish(highlighter)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const monaco = { editor: {} }
    result.current.apply?.(monaco as never)
    expect(mock.applyHighlight).toHaveBeenCalledWith(monaco, highlighter)
  })

  it('loads once for every editor, and a later editor is ready right away', async () => {
    mock.createEditorHighlighter.mockResolvedValue({})
    const { useHighlight } = await freshHook()

    const first = renderHook(() => useHighlight())
    const second = renderHook(() => useHighlight())
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    await waitFor(() => expect(second.result.current.status).toBe('ready'))

    expect(renderHook(() => useHighlight()).result.current.status).toBe('ready')
    expect(mock.createEditorHighlighter).toHaveBeenCalledTimes(1)
    expect(mock.init).toHaveBeenCalledTimes(1)
  })

  it('is failed, with no apply, when the highlighter cannot be created', async () => {
    mock.createEditorHighlighter.mockRejectedValue(new Error('grammar chunk failed'))
    const { useHighlight } = await freshHook()

    const { result } = renderHook(() => useHighlight())
    await waitFor(() => expect(result.current.status).toBe('failed'))
    expect(result.current.apply).toBeUndefined()
  })

  // QA round 3, R3-1: the editor does not wait for Shiki, so Shiki can arrive after Monaco.
  it('puts Shiki on an already loaded Monaco as soon as it arrives, before the editor hears of it', async () => {
    const monaco = { editor: {} }
    const highlighter = { id: 'late' }
    mock.instance.mockReturnValue(monaco)
    mock.createEditorHighlighter.mockResolvedValue(highlighter)
    const { loadHighlight } = await freshHook()

    await loadHighlight()
    expect(mock.applyHighlight).toHaveBeenCalledWith(monaco, highlighter)
  })

  it('puts Shiki on Monaco when Monaco loads after Shiki', async () => {
    const monaco = { editor: {} }
    let finishMonaco = (value: unknown) => value
    mock.init.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          finishMonaco = resolve
        })
    )
    mock.createEditorHighlighter.mockResolvedValue({})
    const { loadHighlight } = await freshHook()

    await loadHighlight()
    expect(mock.applyHighlight).not.toHaveBeenCalled()
    finishMonaco(monaco)
    await waitFor(() => expect(mock.applyHighlight).toHaveBeenCalledWith(monaco, {}))
  })
})
