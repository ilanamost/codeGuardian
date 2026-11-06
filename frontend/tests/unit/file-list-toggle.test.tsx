import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { FILE_DRAFT_LIST_ID } from '../../src/components/FileDraftList'
import { fileListStorageKey } from '../../src/lib/fileListOpen'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { failedFileDraftOf, fileDraftOf, importSessionOf, type ImportSessionDto } from '../../src/models/import-session.model'
import { AppError } from '../../src/models/app-error'
import { importFileSelected, initialReviewState } from '../../src/store/review.slice'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { renderWithStore, settle } from '../utils/renderWithStore'

// Plan 038: the imported files list can be closed and opened. Closed, a rail (a bar on phones)
// keeps the toggle, the file count and the open file's name; the list stays mounted.

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <textarea data-testid="monaco" value={value} readOnly />
}))

const realMatchMedia = window.matchMedia

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = realMatchMedia
})

function sessionOf(): ImportSessionDto {
  const session = importSessionOf('demo', [
    fileDraftOf(0, 'src/greet.ts', 'TypeScript', 'export const greet = 1\n'),
    fileDraftOf(1, 'src/util.py', 'Python', 'total = 2\n'),
    failedFileDraftOf(2, 'src/extra.ts', 'TypeScript', new AppError({ code: ERROR_CODE.githubFileImport, kind: 'http', message: 'x' }).toJSON())
  ])
  if (!session) throw new Error('no session')
  return session
}

async function renderSession(session = sessionOf()) {
  const result = renderWithStore(<App />, { route: '/review/new', preloadedState: { review: { ...initialReviewState, importSession: session } } })
  await settle()
  return result
}

const toggle = () => screen.getByRole('button', { name: /imported files$/ })
const list = () => screen.queryByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
// Closed, the list is out of the accessibility tree (no accessible name), so it is found by its id.
const hiddenList = () => {
  const element = document.getElementById(FILE_DRAFT_LIST_ID)
  if (!element) throw new Error('the list is not mounted')
  return element
}

describe('file list toggle', () => {
  it('starts open with a Hide button that controls the list', async () => {
    await renderSession()
    const button = toggle()
    expect(button).toHaveAccessibleName(FILE_DRAFT_TEXT.hideList)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button.getAttribute('aria-controls')).toBe(list()?.id)
    expect(list()).toBeVisible()
    expect(button.className).toMatch(/cursor-pointer/)
    expect(button.className).toMatch(/focus-visible:outline-2/)
    expect(button.className).toMatch(/hover:/)
  })

  it('closes and opens the list, and the button says what it will do', async () => {
    const user = userEvent.setup()
    await renderSession()
    await user.click(toggle())
    expect(toggle()).toHaveAccessibleName(FILE_DRAFT_TEXT.showList)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(list()).toBeNull()
    expect(hiddenList()).toHaveAttribute('hidden')
    expect(hiddenList()).toHaveAttribute('aria-label', FILE_DRAFT_TEXT.listLabel)
    expect(toggle().getAttribute('aria-controls')).toBe(hiddenList().id)

    await user.click(toggle())
    expect(toggle()).toHaveAccessibleName(FILE_DRAFT_TEXT.hideList)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(list()).toBeVisible()
  })

  it('works with the keyboard: Enter closes, Space opens', async () => {
    const user = userEvent.setup()
    await renderSession()
    toggle().focus()
    await user.keyboard('{Enter}')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveFocus()
    await user.keyboard(' ')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('takes the file buttons out of the Tab order while closed, but keeps them mounted with their marks and selection', async () => {
    const user = userEvent.setup()
    await renderSession()
    const markBefore = within(list()!).getAllByTestId('file-draft-mark').map((mark) => mark.textContent)
    expect(markBefore).toEqual(['Draft', 'Draft', 'Not imported'])
    await user.click(within(list()!).getByRole('button', { name: /src\/util\.py/ }))
    await user.click(toggle())

    const fileButtonList = within(hiddenList()).getAllByRole('button', { hidden: true })
    expect(fileButtonList).toHaveLength(3)
    // Tab through the whole page: no file button ever gets the focus.
    toggle().focus()
    for (let step = 0; step < 40; step += 1) {
      await user.tab()
      expect(fileButtonList).not.toContain(document.activeElement)
    }

    await user.click(toggle())
    expect(within(list()!).getAllByTestId('file-draft-mark').map((mark) => mark.textContent)).toEqual(markBefore)
    expect(within(list()!).getByRole('button', { name: /src\/util\.py/ })).toHaveAttribute('aria-current', 'true')
  })

  it('shows the file count and the open file in the closed rail, and follows a selection made while closed', async () => {
    const user = userEvent.setup()
    const { store } = await renderSession()
    expect(screen.queryByTestId('file-draft-summary')).toBeNull()
    await user.click(toggle())
    const summary = screen.getByTestId('file-draft-summary')
    expect(summary).toHaveTextContent('3 files')
    expect(summary).toHaveTextContent('src/greet.ts')

    act(() => {
      store.dispatch(importFileSelected('file-1'))
    })
    expect(screen.getByTestId('file-draft-summary')).toHaveTextContent('src/util.py')
    expect(screen.getByTestId('file-draft-summary')).not.toHaveTextContent('src/greet.ts')
  })

  it('writes the choice to browser storage on every change', async () => {
    const user = userEvent.setup()
    await renderSession()
    expect(window.localStorage.getItem(fileListStorageKey)).toBeNull()
    await user.click(toggle())
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"closed"')
    await user.click(toggle())
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"open"')
  })

  it('reads the remembered choice on load', async () => {
    window.localStorage.setItem(fileListStorageKey, JSON.stringify('closed'))
    await renderSession()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(list()).toBeNull()
    expect(screen.getByTestId('file-draft-summary')).toHaveTextContent('3 files')
  })

  it('renders open, without an error, when storage throws', async () => {
    window.localStorage.setItem(fileListStorageKey, JSON.stringify('closed'))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    await renderSession()
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(list()).toBeVisible()
    // Toggling still works for this page.
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('animates the width change only without reduced motion', async () => {
    await renderSession()
    expect(screen.getByTestId('file-draft-panel').className).toMatch(/transition-\[width\]/)
  })

  it('has no width transition with prefers-reduced-motion', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      // A desktop viewport (min-width queries match) that asks for reduced motion.
      matches: query.includes('prefers-reduced-motion') || query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia
    await renderSession()
    expect(toggle()).toBeInTheDocument()
    expect(screen.getByTestId('file-draft-panel').className).not.toMatch(/transition/)
  })
})
