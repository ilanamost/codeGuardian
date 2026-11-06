import { act, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { FILE_DRAFT_MENU_ID } from '../../src/components/FileDraftPicker'
import { FILE_DRAFT_LIST_ID } from '../../src/components/FileDraftList'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { useBreakpoint } from '../../src/lib/useBreakpoint'
import { fileDraftOf, importSessionOf, type ImportSessionDto } from '../../src/models/import-session.model'
import { initialReviewState } from '../../src/store/review.slice'
import { renderWithStore, settle } from '../utils/renderWithStore'

// QA plan 038 Revision 1, adversarial: the useBreakpoint fallback, a breakpoint change at run
// time (rotation across md: picker <-> list), a session whose files all have a review (no open
// file on /review/new), one file, a file with no language.

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <textarea data-testid="monaco" value={value} readOnly />
}))

const realMatchMedia = window.matchMedia

// A matchMedia whose min-width answer can be flipped at run time, firing the change listeners.
function controllableViewport(wide: boolean) {
  let isWide = wide
  const listenerList = new Set<() => void>()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query.includes('min-width') ? isWide : false
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listenerList.add(listener),
    removeEventListener: (_: string, listener: () => void) => listenerList.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia
  return (next: boolean) => {
    isWide = next
    act(() => {
      for (const listener of listenerList) listener()
    })
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = realMatchMedia
})

function sessionOf(fileList = [fileDraftOf(0, 'src/a.ts', 'TypeScript', 'a\n'), fileDraftOf(1, 'src/b.py', 'Python', 'b\n'), fileDraftOf(2, 'src/c.ts', 'TypeScript', 'c\n')]): ImportSessionDto {
  const session = importSessionOf('demo', fileList)
  if (!session) throw new Error('no session')
  return session
}

async function render(session: ImportSessionDto) {
  const result = renderWithStore(<App />, { route: '/review/new', preloadedState: { review: { ...initialReviewState, importSession: session } } })
  await settle()
  return result
}

const trigger = () => screen.getByRole('button', { expanded: false, name: /of \d+/ })
const menu = () => document.getElementById(FILE_DRAFT_MENU_ID)

describe('qa-038 R1: useBreakpoint fallback', () => {
  it('without matchMedia: false by default (existing callers unchanged), the given fallback otherwise', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined })
    expect(renderHook(() => useBreakpoint('md')).result.current).toBe(false)
    expect(renderHook(() => useBreakpoint('md', true)).result.current).toBe(true)
    expect(renderHook(() => useBreakpoint('md', false)).result.current).toBe(false)
  })

  it('with matchMedia the fallback is ignored', () => {
    controllableViewport(false)
    expect(renderHook(() => useBreakpoint('md', true)).result.current).toBe(false)
    controllableViewport(true)
    expect(renderHook(() => useBreakpoint('md', false)).result.current).toBe(true)
  })
})

describe('qa-038 R1: crossing md at run time (rotation)', () => {
  it('phone -> desktop -> phone keeps the selection and the desktop open/closed choice', async () => {
    const setWide = controllableViewport(true)
    const user = userEvent.setup()
    await render(sessionOf())
    // Desktop: pick b.py, close the list.
    await user.click(within(document.getElementById(FILE_DRAFT_LIST_ID)!).getByRole('button', { name: /src\/b\.py/ }))
    await user.click(screen.getByRole('button', { name: FILE_DRAFT_TEXT.hideList }))

    setWide(false)
    // Phone: the picker, no toggle, the same file.
    expect(screen.queryByRole('button', { name: /imported files$/ })).toBeNull()
    expect(screen.getByTestId('file-draft-summary')).toHaveTextContent('src/b.py')
    expect(screen.getByText(FILE_DRAFT_TEXT.position(2, 3))).toBeInTheDocument()
    expect(screen.getByTestId('monaco')).toHaveValue('b\n')

    setWide(true)
    expect(screen.getByRole('button', { name: FILE_DRAFT_TEXT.showList })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('file-draft-summary')).toHaveTextContent('src/b.py')
  })

  it('an open phone list does not leak into the desktop layout, and comes back closed', async () => {
    const setWide = controllableViewport(false)
    const user = userEvent.setup()
    await render(sessionOf())
    await user.click(trigger())
    expect(menu()).not.toHaveAttribute('hidden')
    setWide(true)
    expect(menu()).toBeNull()
    setWide(false)
    expect(menu()).toHaveAttribute('hidden')
    expect(screen.getByRole('button', { name: /of 3/ })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('qa-038 R1: odd sessions on the phone', () => {
  beforeEach(() => {
    controllableViewport(false)
  })

  it('one file: "1 of 1" and a one-row list', async () => {
    const user = userEvent.setup()
    await render(sessionOf([fileDraftOf(0, 'only.ts', 'TypeScript', 'x\n')]))
    expect(screen.getByText(FILE_DRAFT_TEXT.position(1, 1))).toBeInTheDocument()
    await user.click(trigger())
    expect(within(menu()!).getAllByRole('button')).toHaveLength(1)
  })

  it('a file with no language shows no stray separator in the row', async () => {
    await render(sessionOf([fileDraftOf(0, 'Makefile', '', 'all:\n'), fileDraftOf(1, 'b.ts', 'TypeScript', 'b\n')]))
    const summary = screen.getByTestId('file-draft-summary')
    expect(summary).toHaveTextContent('Makefile')
    expect(summary.textContent).not.toMatch(/·/)
    expect(within(summary).getByTestId('file-draft-mark')).toHaveTextContent('Draft')
  })

  it('every file already has a review: /review/new says "No file open" (what does N of M say?)', async () => {
    const reviewed = sessionOf()
    const session = { ...reviewed, fileList: reviewed.fileList.map((file, index) => ({ ...file, reviewId: `r${index}` })) }
    await render(session)
    const row = screen.getByRole('button', { name: /of 3/ })
    expect(row).toHaveTextContent(FILE_DRAFT_TEXT.noOpenFile)
    // "0 of 3" next to "No file open" is odd but not wrong; recorded in the report.
    expect(row).toHaveTextContent(FILE_DRAFT_TEXT.position(0, 3))
  })
})
