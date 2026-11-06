import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { FILE_DRAFT_LIST_ID } from '../../src/components/FileDraftList'
import { fileListStorageKey, readFileListOpen, useFileListOpen } from '../../src/lib/fileListOpen'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { fileDraftOf, importSessionOf, type ImportSessionDto } from '../../src/models/import-session.model'
import { settingsStorageKey } from '../../src/services/settings.service'
import { signOut } from '../../src/store/session.slice'
import { importFileSelected, initialReviewState } from '../../src/store/review.slice'
import { renderHook } from '@testing-library/react'
import { createFixtureServices } from '../utils/fixtureDataSource'
import { renderWithStore, settle } from '../utils/renderWithStore'

// QA plan 038, adversarial: rapid toggling, one / twenty / very long files, garbage and throwing
// storage, the remount between /review/new and /review/:id, Run review with the list closed, and
// the storage key surviving sign-out (it is a display preference, not account data).

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function sessionWith(pathList: string[]): ImportSessionDto {
  const session = importSessionOf(
    'demo',
    pathList.map((path, index) => fileDraftOf(index, path, 'TypeScript', `export const v${index} = ${index}\n`))
  )
  if (!session) throw new Error('no session')
  return session
}

async function renderSession(session: ImportSessionDto) {
  const result = renderWithStore(<App />, { route: '/review/new', preloadedState: { review: { ...initialReviewState, importSession: session } } })
  await settle()
  return result
}

const toggle = () => screen.getByRole('button', { name: /imported files$/ })
const summary = () => screen.getByTestId('file-draft-summary')
const listElement = () => {
  const element = document.getElementById(FILE_DRAFT_LIST_ID)
  if (!element) throw new Error('the list is not mounted')
  return element
}

function blockStorage() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
}

describe('qa-038: toggle under stress', () => {
  it('survives 25 rapid clicks: ends closed, one list element, storage in step, no error', async () => {
    const user = userEvent.setup()
    await renderSession(sessionWith(['a.ts', 'b.ts', 'c.ts']))
    for (let click = 0; click < 25; click += 1) await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveAccessibleName(FILE_DRAFT_TEXT.showList)
    expect(document.querySelectorAll(`#${FILE_DRAFT_LIST_ID}`)).toHaveLength(1)
    expect(listElement()).toHaveAttribute('hidden')
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"closed"')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the toggle hook keeps every click when clicks land in the same tick (no stale closure)', () => {
    const { result } = renderHook(() => useFileListOpen())
    act(() => {
      result.current[1]()
      result.current[1]()
    })
    // Two toggles from the same render: a stale `open` would leave it closed after two clicks.
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"open"')
  })

  it('a single-file session says "1 file" and its name', async () => {
    const user = userEvent.setup()
    await renderSession(sessionWith(['only.ts']))
    await user.click(toggle())
    expect(summary()).toHaveTextContent('1 file')
    expect(summary()).not.toHaveTextContent('1 files')
    expect(summary()).toHaveTextContent('only.ts')
  })

  it('a 20-file session: "20 files", the open file follows a selection while closed, no file button is focusable', async () => {
    const user = userEvent.setup()
    const pathList = Array.from({ length: 20 }, (_, index) => `src/file-${index + 1}.ts`)
    const { store } = await renderSession(sessionWith(pathList))
    await user.click(toggle())
    expect(summary()).toHaveTextContent('20 files')
    act(() => {
      store.dispatch(importFileSelected('file-19'))
    })
    expect(summary()).toHaveTextContent('src/file-20.ts')
    const fileButtonList = within(listElement()).getAllByRole('button', { hidden: true })
    expect(fileButtonList).toHaveLength(20)
    toggle().focus()
    for (let step = 0; step < 30; step += 1) {
      await user.tab()
      expect(fileButtonList).not.toContain(document.activeElement)
    }
    // Reopen: the selection made while closed is the current one.
    await user.click(toggle())
    expect(within(listElement()).getByRole('button', { name: /src\/file-20\.ts/ })).toHaveAttribute('aria-current', 'true')
  })

  it('a very long file name is truncated in the rail and kept whole in its title', async () => {
    const user = userEvent.setup()
    const longPath = `src/${'very-long-directory-name/'.repeat(12)}file.ts`
    await renderSession(sessionWith([longPath, 'b.ts']))
    await user.click(toggle())
    const name = within(summary()).getByText(longPath)
    expect(name).toHaveAttribute('title', longPath)
    expect(name.className).toMatch(/truncate/)
    expect(name.className).toMatch(/min-w-0/)
  })
})

describe('qa-038: remembered choice, hostile storage', () => {
  it('treats every garbage value as open', () => {
    const garbageList = ['"OPEN"', '"Closed"', '" closed"', 'null', '[]', '["closed"]', '{"open":false}', '""', `"${'x'.repeat(10_000)}"`, 'undefined']
    for (const raw of garbageList) {
      window.localStorage.setItem(fileListStorageKey, raw)
      expect(readFileListOpen(), raw.slice(0, 20)).toBe(true)
    }
  })

  it('renders open and toggles without an error when the localStorage accessor itself throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      }
    })
    try {
      const user = userEvent.setup()
      await renderSession(sessionWith(['a.ts', 'b.ts']))
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      await user.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    }
  })

  it('a garbage value already in storage renders open and is overwritten by a valid value on toggle', async () => {
    window.localStorage.setItem(fileListStorageKey, '{broken')
    const user = userEvent.setup()
    await renderSession(sessionWith(['a.ts', 'b.ts']))
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle())
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"closed"')
  })
})

describe('qa-038: across pages of the session', () => {
  it('Run review with the list closed: the review page stays closed and the rail names the reviewed file', async () => {
    const user = userEvent.setup()
    const { store } = await renderSession(sessionWith(['src/a.ts', 'src/b.ts']))
    await user.click(within(listElement()).getByRole('button', { name: /src\/b\.ts/ }))
    await user.click(toggle())
    await user.click(screen.getByRole('button', { name: 'Run review' }))
    await settle()
    await settle()
    const fileList = store.getState().review.importSession?.fileList ?? []
    expect(fileList[1].reviewId).toBeTruthy()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(summary()).toHaveTextContent('2 files')
    expect(summary()).toHaveTextContent('src/b.ts')
    // The mark of the reviewed file changed while closed; reopening shows it.
    await user.click(toggle())
    const markList = within(listElement()).getAllByTestId('file-draft-mark').map((mark) => mark.textContent)
    expect(markList[0]).toBe('Draft')
    expect(markList[1]).not.toBe('Draft')
  })

  it('with storage blocked, moving from /review/new to /review/:id keeps the list closed (same element type, no remount)', async () => {
    blockStorage()
    const user = userEvent.setup()
    const { store } = await renderSession(sessionWith(['src/a.ts', 'src/b.ts']))
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Run review' }))
    await settle()
    await settle()
    const reviewId = store.getState().review.importSession?.fileList[0].reviewId
    expect(reviewId).toBeTruthy()
    expect(store.getState().review.current?.id).toBe(reviewId)
    // Observed: React Router keeps the ReviewPage instance across the two routes, so the
    // in-memory choice holds even without storage.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('qa-038: sign-out', () => {
  it('sign-out keeps ui.fileList (a per-browser display preference) and removes cr.settings', async () => {
    const user = userEvent.setup()
    const services = createFixtureServices({ supportDelayMs: 0 })
    const { store } = renderWithStore(<App />, {
      route: '/review/new',
      services: { ...services, session: { ...services.session, signOut: vi.fn(async () => undefined) } },
      preloadedState: { review: { ...initialReviewState, importSession: sessionWith(['a.ts', 'b.ts']) } }
    })
    await settle()
    await user.click(toggle())
    await act(async () => {
      await store.dispatch(signOut())
    })
    await settle()
    expect(store.getState().session.status).toBe('signedOut')
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"closed"')
    // Not account data: the value is only one of the two display values.
    expect(['"open"', '"closed"']).toContain(window.localStorage.getItem(fileListStorageKey))
  })
})
