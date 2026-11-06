import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import App from '../../src/App'
import { GITHUB_IMPORT_LIMIT } from '../../src/lib/github.constants'
import { FILE_DRAFT_TEXT } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import type { GithubFileDto } from '../../src/models/dto'
import { fileDraftMarkOf, fileDraftOf, hasUnsavedFileDraft, importSessionOf } from '../../src/models/import-session.model'
import { isImportSessionPath, openFileDraftOf } from '../../src/lib/importSession'
import { fixtureData } from '../utils/fixtureData'
import { createAppStore } from '../../src/store'
import { importGithubFileList } from '../../src/store/github.slice'
import { importFileEdited, importFileReviewed, importFileSelected, importSessionCleared } from '../../src/store/review.slice'
import { ERROR_CODE, ERROR_MESSAGE, FORM_ERROR_MESSAGE, GITHUB_WIZARD_HINT } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore, settle } from '../utils/renderWithStore'

// Plan 034, Workstream B: several imported files open as an import session on the New Review
// page. Each file is its own draft (code, language, edits) and gets its own review; failures of
// single files are listed and reported without losing the others.

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language, onChange }: { value: string; language: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" data-language={language} value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

beforeEach(() => {
  window.localStorage.clear()
})

const fileOf = (index: number): GithubFileDto => ({ id: `f${index}`, path: `src/file-${index}.ts`, language: 'TypeScript' })

const httpError = (status: number) => AppError.fromResponse(status, { error: { code: 'x', message: 'x' } })

function fakeWithFiles(count: number) {
  const fake = createFakeServices()
  fake.services.github.listFile.mockResolvedValue({ items: Array.from({ length: count }, (_, index) => fileOf(index + 1)), truncated: false })
  fake.services.github.getFile.mockImplementation(async (_repoId: string, fileId: string) => {
    const index = Number(fileId.slice(1))
    return { ...fileOf(index), content: `const value${index} = ${index}\n` }
  })
  return fake
}

const frontendFileList = fixtureData.githubFileListByRepo['frontend-app']

async function importFrontendFiles(user: ReturnType<typeof userEvent.setup>, pathList = frontendFileList.map((file) => file.path)) {
  await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
  await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
  await user.click(await screen.findByRole('radio', { name: 'frontend-app' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  for (const path of pathList) await user.click(await screen.findByRole('checkbox', { name: path }))
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  return screen.findByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
}

const editor = () => screen.getByTestId('monaco') as HTMLTextAreaElement

describe('importGithubFileList (store)', () => {
  it('downloads every file one after the other and opens them as an import session', async () => {
    const { services } = fakeWithFiles(3)
    const store = createAppStore({ services })
    const progressList: unknown[] = []
    store.subscribe(() => progressList.push(store.getState().github.importProgress))

    const result = await store.dispatch(importGithubFileList({ repoId: 'repo', fileList: [fileOf(1), fileOf(2), fileOf(3)] }))

    expect(importGithubFileList.fulfilled.match(result)).toBe(true)
    expect(services.github.getFile.mock.calls.map((call) => call[1])).toEqual(['f1', 'f2', 'f3'])
    expect(progressList).toContainEqual({ done: 2, total: 3 })
    expect(store.getState().github.importProgress).toBeNull()
    const session = store.getState().review.importSession
    expect(session?.name).toBe('repo')
    expect(session?.fileList.map((file) => [file.path, file.status, file.code])).toEqual([
      ['src/file-1.ts', 'draft', 'const value1 = 1\n'],
      ['src/file-2.ts', 'draft', 'const value2 = 2\n'],
      ['src/file-3.ts', 'draft', 'const value3 = 3\n']
    ])
    expect(session?.selectedKey).toBe(session?.fileList[0].key)
    expect(store.getState().review.draft).toBeNull()
  })

  it('keeps the other files when one download fails', async () => {
    const { services } = fakeWithFiles(3)
    services.github.getFile.mockImplementationOnce(async () => ({ ...fileOf(1), content: 'a\n' })).mockRejectedValueOnce(httpError(500))
    const store = createAppStore({ services })

    await store.dispatch(importGithubFileList({ repoId: 'repo', fileList: [fileOf(1), fileOf(2), fileOf(3)] }))

    const fileList = store.getState().review.importSession?.fileList ?? []
    expect(fileList.map((file) => file.status)).toEqual(['draft', 'failed', 'draft'])
    expect(fileList[1].error).toMatchObject({ code: ERROR_CODE.githubFileImport, causeCode: ERROR_CODE.server })
    expect(fileDraftMarkOf(fileList[1])).toBe('importFailed')
  })

  it('stops asking GitHub after a 429 and marks the remaining files with the same error', async () => {
    const { services } = fakeWithFiles(3)
    services.github.getFile.mockImplementationOnce(async () => ({ ...fileOf(1), content: 'a\n' })).mockRejectedValueOnce(httpError(429))
    const store = createAppStore({ services })

    await store.dispatch(importGithubFileList({ repoId: 'repo', fileList: [fileOf(1), fileOf(2), fileOf(3)] }))

    expect(services.github.getFile).toHaveBeenCalledTimes(2)
    const fileList = store.getState().review.importSession?.fileList ?? []
    expect(fileList.map((file) => file.status)).toEqual(['draft', 'failed', 'failed'])
    expect(fileList[2].error?.userMessage).toContain(GITHUB_WIZARD_HINT.rateLimited)
  })

  it('rejects when every file failed, and opens nothing', async () => {
    const { services } = fakeWithFiles(2)
    services.github.getFile.mockRejectedValue(httpError(404))
    const store = createAppStore({ services })

    const result = await store.dispatch(importGithubFileList({ repoId: 'repo', fileList: [fileOf(1), fileOf(2)] }))

    expect(importGithubFileList.rejected.match(result)).toBe(true)
    expect(store.getState().review.importSession).toBeNull()
    expect(store.getState().github.importStatus).toBe('failed')
  })

  it('rejects at once on a 409 (no connected account) and clears the account', async () => {
    const { services } = fakeWithFiles(2)
    services.github.getFile.mockRejectedValue(httpError(409))
    const store = createAppStore({ services })
    await store.dispatch({ type: 'github/connect/fulfilled', payload: { account: { login: 'octocat', name: null }, repoList: { items: [], truncated: false } } })

    await store.dispatch(importGithubFileList({ repoId: 'repo', fileList: [fileOf(1), fileOf(2)] }))

    expect(services.github.getFile).toHaveBeenCalledTimes(1)
    expect(store.getState().github.account).toBeNull()
  })

  it(`refuses more than ${GITHUB_IMPORT_LIMIT.fileCount} files without asking GitHub`, async () => {
    const { services } = fakeWithFiles(21)
    const store = createAppStore({ services })

    const result = await store.dispatch(importGithubFileList({ repoId: 'repo', fileList: Array.from({ length: 21 }, (_, index) => fileOf(index + 1)) }))

    expect(importGithubFileList.rejected.match(result)).toBe(true)
    expect(services.github.getFile).not.toHaveBeenCalled()
  })
})

describe('import session (store and helpers)', () => {
  const session = importSessionOf('repo', [fileDraftOf(0, 'a.ts', 'TypeScript', 'a'), fileDraftOf(1, 'b.py', 'Python', 'b')])

  it('keeps each draft own edits and links a draft to its review', () => {
    const store = createAppStore({ services: createFakeServices().services, preloadedState: { review: { ...createAppStore().getState().review, importSession: session } } })

    store.dispatch(importFileEdited({ key: 'file-1', code: 'b2', language: 'Go' }))
    store.dispatch(importFileSelected('file-1'))
    store.dispatch(importFileReviewed({ key: 'file-0', reviewId: 'r9' }))

    const after = store.getState().review.importSession
    expect(after?.fileList.map((file) => [file.code, file.language, file.reviewId])).toEqual([
      ['a', 'TypeScript', 'r9'],
      ['b2', 'Go', null]
    ])
    expect(after?.selectedKey).toBe('file-1')
    expect(hasUnsavedFileDraft(after)).toBe(true)
    expect(isImportSessionPath(after!, '/review/r9')).toBe(true)
    expect(isImportSessionPath(after!, '/history')).toBe(false)
    store.dispatch(importSessionCleared())
    expect(store.getState().review.importSession).toBeNull()
  })

  it('opens the selected draft, else the first one without a review', () => {
    expect(openFileDraftOf(session)?.key).toBe('file-0')
    const reviewed = { ...session!, fileList: session!.fileList.map((file, index) => (index === 0 ? { ...file, reviewId: 'r1' } : file)) }
    expect(openFileDraftOf(reviewed)?.key).toBe('file-1')
    expect(openFileDraftOf(null)).toBeNull()
  })
})

describe('Multi-file import in the app (fake backend)', () => {
  it('imports every ticked file, opens the first, and switching keeps each file own code and edits', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/github' })

    const list = await importFrontendFiles(user)

    expect(await screen.findByText('Imported 3 files from frontend-app')).toBeInTheDocument()
    const itemList = within(list).getAllByRole('button')
    expect(itemList.map((item) => item.title)).toEqual(frontendFileList.map((file) => file.path))
    expect(itemList[0]).toHaveAttribute('aria-current', 'true')
    expect(within(list).getAllByTestId('file-draft-mark').map((mark) => mark.textContent)).toEqual(['Draft', 'Draft', 'Draft'])
    expect(editor().value).toBe(fixtureData.githubFileContentById['fe-1'])

    await user.clear(editor())
    await user.type(editor(), 'edited first')
    await user.click(itemList[2])
    expect(editor().value).toBe(fixtureData.githubFileContentById['fe-3'])
    expect(editor()).toHaveAttribute('data-language', 'javascript')
    expect(screen.getByTestId('review-name')).toHaveTextContent('src/utils/format.js')

    await user.click(within(list).getAllByRole('button')[0])
    expect(editor().value).toBe('edited first')
  })

  it('runs a review for the selected file only; the others stay drafts and keep their code', async () => {
    const user = userEvent.setup()
    const { store } = renderWithStore(<App />, { route: '/github' })
    const list = await importFrontendFiles(user)

    await user.click(within(list).getAllByRole('button')[1])
    await user.click(screen.getByRole('button', { name: 'Run review' }))

    // The review of the second file, with the list still beside it.
    expect(await screen.findByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })).toBeInTheDocument()
    await settle()
    const session = store.getState().review.importSession
    const reviewId = session?.fileList[1].reviewId
    expect(reviewId).toBeTruthy()
    expect(store.getState().review.current?.id).toBe(reviewId)
    expect(store.getState().review.current?.review?.content).toBe(fixtureData.githubFileContentById['fe-2'])
    expect(session?.fileList.map((file) => file.reviewId === null)).toEqual([true, false, true])

    // Back to a draft: its own code, still unreviewed.
    await user.click(within(screen.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })).getAllByRole('button')[0])
    expect(await screen.findByRole('button', { name: 'Run review' })).toBeInTheDocument()
    expect(editor().value).toBe(fixtureData.githubFileContentById['fe-1'])
    await user.click(screen.getByRole('button', { name: 'Run review' }))
    await settle()
    const after = store.getState().review.importSession?.fileList ?? []
    expect(after.filter((file) => file.reviewId).length).toBe(2)
    expect(new Set(after.map((file) => file.reviewId).filter(Boolean)).size).toBe(2)
    expect(after[2].reviewId).toBeNull()
  })

  it('asks before leaving unsaved drafts: Stay keeps them, Leave drops the session', async () => {
    const user = userEvent.setup()
    const { store } = renderWithStore(<App />, { route: '/github' })
    await importFrontendFiles(user)

    await user.click(screen.getAllByRole('link', { name: /Review History/ })[0])
    const dialog = await screen.findByRole('dialog', { name: FILE_DRAFT_TEXT.leaveTitle })
    await user.click(within(dialog).getByRole('button', { name: FILE_DRAFT_TEXT.stay }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /Review History/ })[0])
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: FILE_DRAFT_TEXT.leaveConfirm }))
    expect(await screen.findByRole('heading', { name: 'Review History' })).toBeInTheDocument()
    expect(store.getState().review.importSession).toBeNull()
  })

  it('lists a failed file with its error, reports it once, and keeps the others', async () => {
    const user = userEvent.setup()
    const { services, toast } = fakeWithFiles(3)
    services.github.getFile.mockImplementation(async (_repoId: string, fileId: string) => {
      if (fileId === 'f2') throw httpError(429)
      const index = Number(fileId.slice(1))
      return { ...fileOf(index), content: `const value${index} = ${index}\n` }
    })
    renderWithStore(<App />, { route: '/github', services })
    await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    for (const index of [1, 2, 3]) await user.click(await screen.findByRole('checkbox', { name: `src/file-${index}.ts` }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    const list = await screen.findByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })
    expect(await screen.findByText('Imported 1 of 3 files from repo')).toBeInTheDocument()
    const itemList = within(list).getAllByRole('button')
    expect(within(list).getAllByTestId('file-draft-mark').map((mark) => mark.textContent)).toEqual(['Draft', 'Not imported', 'Not imported'])
    expect(itemList[1]).toBeDisabled()
    expect(itemList[1].title).toContain(GITHUB_WIZARD_HINT.rateLimited)
    // One error toast for the failed downloads, with GitHub's rate-limit hint.
    const message = `${ERROR_MESSAGE.githubFileImport} ${GITHUB_WIZARD_HINT.rateLimited}`
    expect(within(list).getAllByText(message)).toHaveLength(2)
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(services.github.getFile).toHaveBeenCalledTimes(2)
    expect(editor().value).toBe('const value1 = 1\n')
  })

  it(`refuses more than ${GITHUB_IMPORT_LIMIT.fileCount} ticked files with a clear message`, async () => {
    const user = userEvent.setup()
    const { services } = fakeWithFiles(21)
    renderWithStore(<App />, { route: '/github', services })
    await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    for (let index = 1; index <= 21; index += 1) await user.click(await screen.findByRole('checkbox', { name: `src/file-${index}.ts` }))

    expect(screen.getByRole('alert')).toHaveTextContent(FORM_ERROR_MESSAGE.githubFileLimit(GITHUB_IMPORT_LIMIT.fileCount))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'src/file-21.ts' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    // 21 checkbox clicks take a while when the whole suite runs in parallel.
  }, 20_000)

  it('keeps no file code in browser storage', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/github' })
    await importFrontendFiles(user)
    await act(async () => {})

    const stored = Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key) ?? '').join('\n')
    expect(stored).not.toContain(fixtureData.githubFileContentById['fe-2'])
  })

  // QA 034 F-B1: browser Back (and Forward) with unsaved drafts asks first, like an in-app link.
  it('asks before the browser Back button leaves unsaved drafts: Stay keeps them, Leave drops them', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/github')
    const { store } = renderWithStore(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
      { router: false }
    )
    await importFrontendFiles(user)
    expect(window.location.pathname).toBe('/review/new')
    await user.type(editor(), ' edited')

    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const dialog = await screen.findByRole('dialog', { name: FILE_DRAFT_TEXT.leaveTitle })
    await vi.waitFor(() => expect(window.location.pathname).toBe('/review/new'))
    await user.click(within(dialog).getByRole('button', { name: FILE_DRAFT_TEXT.stay }))
    expect(screen.getByRole('navigation', { name: FILE_DRAFT_TEXT.listLabel })).toBeInTheDocument()
    expect(editor().value).toContain(' edited')
    expect(store.getState().review.importSession?.fileList).toHaveLength(3)

    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: FILE_DRAFT_TEXT.leaveConfirm }))
    await vi.waitFor(() => expect(window.location.pathname).toBe('/github'))
    expect(store.getState().review.importSession).toBeNull()
    expect(Object.values(window.sessionStorage).join('')).not.toContain(fixtureData.githubFileContentById['fe-1'])
  })
})
