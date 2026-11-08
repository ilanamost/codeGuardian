import { afterEach, describe, expect, it, vi } from 'vitest'
import CodeEditor from '../../src/components/CodeEditor'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 050: the editor's vertical scrollbar is as thick as the horizontal one, so it can be
// dragged with a finger: 16 px below md, 12 px from md up.
const editorOptionList = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, options }: { value: string; options: Record<string, unknown> }) => {
    editorOptionList.push(options)
    return <div data-testid="monaco">{value}</div>
  }
}))

type ScrollbarOption = { verticalScrollbarSize: number; horizontalScrollbarSize: number }

function scrollbarOption(): ScrollbarOption {
  return editorOptionList.at(-1)?.scrollbar as ScrollbarOption
}

// jsdom has no matchMedia: the editor renders as below md until one is defined.
function stubMatchMedia(minWidth: number, viewportWidth: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === `(min-width: ${minWidth}px)` ? viewportWidth >= minWidth : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  // @ts-expect-error restore jsdom default (no matchMedia)
  delete window.matchMedia
  editorOptionList.length = 0
})

describe('Editor scrollbar sizes', () => {
  it('uses 16 px for both bars below md', () => {
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)

    expect(scrollbarOption()).toMatchObject({ verticalScrollbarSize: 16, horizontalScrollbarSize: 16 })
  })

  it('uses 12 px for both bars from md up', () => {
    stubMatchMedia(768, 1280)
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)

    expect(scrollbarOption()).toMatchObject({ verticalScrollbarSize: 12, horizontalScrollbarSize: 12 })
  })

  it('keeps the two bars equal at both breakpoints', () => {
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)
    const below = scrollbarOption()
    stubMatchMedia(768, 768)
    renderWithStore(<CodeEditor value="const b = 2" language="TypeScript" />)
    const from = scrollbarOption()

    expect(below.verticalScrollbarSize).toBe(below.horizontalScrollbarSize)
    expect(from.verticalScrollbarSize).toBe(from.horizontalScrollbarSize)
  })
})
