import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { FILE_DRAFT_MENU_ID } from '../../src/components/FileDraftPicker'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import { failedFileDraftOf, fileDraftOf, importSessionOf, skippedFileDraftOf, type ImportSessionDto } from '../../src/models/import-session.model'
import { importFileSelected, initialReviewState } from '../../src/store/review.slice'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { renderWithStore, settle } from '../utils/renderWithStore'

// Plan 038, Revision 1: below `md` the imported files are a dropdown: one row with the open file,
// its language, mark and "N of M"; a vertical list under it; no open/close toggle.

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <textarea data-testid="monaco" value={value} readOnly />
}))

const realMatchMedia = window.matchMedia

// A phone viewport: no min-width query matches. `reducedMotion` answers prefers-reduced-motion.
function phoneViewport(reducedMotion = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  window.localStorage.clear()
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.matchMedia = realMatchMedia
})

const failure = new AppError({ code: ERROR_CODE.githubFileImport, kind: 'http', message: 'x' }).toJSON()

function sessionOf(): ImportSessionDto {
  const session = importSessionOf('demo', [
    fileDraftOf(0, 'src/greet.ts', 'TypeScript', 'export const greet = 1\n'),
    failedFileDraftOf(1, 'src/broken.ts', 'TypeScript', failure),
    fileDraftOf(2, 'src/util.py', 'Python', 'total = 2\n'),
    skippedFileDraftOf(3, 'assets/logo.png', 'binary'),
    fileDraftOf(4, 'src/last.ts', 'TypeScript', 'export const last = 4\n')
  ])
  if (!session) throw new Error('no session')
  return session
}

async function renderPhone(session = sessionOf()) {
  const result = renderWithStore(<App />, { route: '/review/new', preloadedState: { review: { ...initialReviewState, importSession: session } } })
  await settle()
  return result
}

const nav = () => screen.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
const trigger = () => within(nav()).getByRole('button', { expanded: false }) as HTMLButtonElement
const openTrigger = () => within(nav()).getByRole('button', { expanded: true }) as HTMLButtonElement
const menu = () => screen.queryByRole('list', { name: FILE_DRAFT_TEXT.menuLabel })
const option = (path: RegExp) => within(menu()!).getByRole('button', { name: path })
const editor = () => screen.getByTestId('monaco') as HTMLTextAreaElement

describe('phone file dropdown', () => {
  it('shows one row with the open file, its language, its mark and "N of M", and no open/close toggle', async () => {
    await renderPhone()
    const row = trigger()
    expect(row).toHaveTextContent('src/greet.ts')
    expect(row).toHaveTextContent('TypeScript')
    expect(within(row).getByTestId('file-draft-mark')).toHaveTextContent('Draft')
    expect(row).toHaveTextContent('1 of 5')
    expect(row).toHaveAttribute('aria-controls', FILE_DRAFT_MENU_ID)
    expect(document.getElementById(FILE_DRAFT_MENU_ID)).toHaveAttribute('hidden')
    expect(menu()).toBeNull()
    expect(screen.queryByRole('button', { name: FILE_DRAFT_TEXT.hideList })).toBeNull()
    expect(screen.queryByRole('button', { name: FILE_DRAFT_TEXT.showList })).toBeNull()
  })

  it('opens a named list of every file with language, mark and the reason; unopenable files are disabled', async () => {
    const user = userEvent.setup()
    await renderPhone()
    await user.click(trigger())
    expect(openTrigger()).toHaveAttribute('aria-expanded', 'true')
    const list = menu()!
    expect(list.id).toBe(FILE_DRAFT_MENU_ID)
    expect(list.className).toMatch(/overflow-y-auto/)
    expect(list.className).toMatch(/max-h-\[50dvh\]/)
    const rowList = within(list).getAllByRole('button')
    expect(rowList.map((row) => row.querySelector('.font-mono')?.textContent)).toEqual(['src/greet.ts', 'src/broken.ts', 'src/util.py', 'assets/logo.png', 'src/last.ts'])
    expect(within(list).getAllByTestId('file-draft-mark').map((mark) => mark.textContent)).toEqual(['Draft', 'Not imported', 'Draft', 'Skipped', 'Draft'])
    expect(option(/src\/broken\.ts/)).toBeDisabled()
    expect(option(/assets\/logo\.png/)).toBeDisabled()
    expect(within(option(/src\/broken\.ts/)).getByText(failure.userMessage)).toBeInTheDocument()
    expect(option(/src\/greet\.ts/)).toHaveAttribute('aria-current', 'true')
    // The focus moves to the open file.
    expect(option(/src\/greet\.ts/)).toHaveFocus()
  })

  it('choosing a file opens it, closes the list, updates the row and returns the focus to the row', async () => {
    const user = userEvent.setup()
    const { store } = await renderPhone()
    await user.click(trigger())
    await user.click(option(/src\/util\.py/))
    expect(menu()).toBeNull()
    expect(store.getState().review.importSession?.selectedKey).toBe('file-2')
    expect(editor().value).toBe('total = 2\n')
    expect(trigger()).toHaveTextContent('src/util.py')
    expect(trigger()).toHaveTextContent('Python')
    expect(trigger()).toHaveTextContent('3 of 5')
    expect(trigger()).toHaveFocus()
  })

  it('a disabled file cannot be chosen', async () => {
    const user = userEvent.setup()
    const { store } = await renderPhone()
    await user.click(trigger())
    await user.click(option(/src\/broken\.ts/))
    expect(store.getState().review.importSession?.selectedKey).toBe('file-0')
    expect(menu()).not.toBeNull()
  })

  it('works with the keyboard: Enter opens, arrows skip disabled files, End/Home, Escape closes and returns the focus', async () => {
    const user = userEvent.setup()
    await renderPhone()
    trigger().focus()
    await user.keyboard('{Enter}')
    expect(option(/src\/greet\.ts/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(option(/src\/util\.py/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(option(/src\/last\.ts/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(option(/src\/greet\.ts/)).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(option(/src\/last\.ts/)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(option(/src\/greet\.ts/)).toHaveFocus()
    await user.keyboard('{End}')
    expect(option(/src\/last\.ts/)).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(menu()).toBeNull()
    expect(trigger()).toHaveFocus()

    // Space opens too, and Enter on a file chooses it.
    await user.keyboard(' ')
    expect(menu()).not.toBeNull()
    await user.keyboard('{End}{Enter}')
    expect(menu()).toBeNull()
    expect(trigger()).toHaveTextContent('src/last.ts')
    expect(trigger()).toHaveFocus()
  })

  it('ArrowDown on the closed row opens the list', async () => {
    const user = userEvent.setup()
    await renderPhone()
    trigger().focus()
    await user.keyboard('{ArrowDown}')
    expect(menu()).not.toBeNull()
    expect(option(/src\/greet\.ts/)).toHaveFocus()
  })

  it('a tap outside closes the list and returns the focus to the row', async () => {
    const user = userEvent.setup()
    await renderPhone()
    await user.click(trigger())
    expect(menu()).not.toBeNull()
    await user.click(screen.getByTestId('review-name'))
    expect(menu()).toBeNull()
    await vi.waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('leaving the list with Tab closes it', async () => {
    const user = userEvent.setup()
    await renderPhone()
    await user.click(trigger())
    await user.keyboard('{End}')
    await user.tab()
    expect(menu()).toBeNull()
  })

  it('follows a selection made elsewhere', async () => {
    const { store } = await renderPhone()
    act(() => {
      store.dispatch(importFileSelected('file-4'))
    })
    expect(trigger()).toHaveTextContent('src/last.ts')
    expect(trigger()).toHaveTextContent('5 of 5')
  })

  it('animates the arrow only without reduced motion', async () => {
    await renderPhone()
    expect(trigger().querySelector('svg.lucide-chevron-down')?.getAttribute('class')).toMatch(/transition-transform/)
  })

  it('has no animation with prefers-reduced-motion', async () => {
    phoneViewport(true)
    await renderPhone()
    expect(trigger().querySelector('svg.lucide-chevron-down')?.getAttribute('class')).not.toMatch(/transition/)
  })
})
