import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { GITHUB_IMPORT_LIMIT, GITHUB_LINK_TEXT } from '../../src/lib/github.constants'
import { AppError } from '../../src/models/app-error'
import { githubLinkKey, parseGithubLink } from '../../src/models/github.model'
import { AppSettings } from '../../src/models/settings.model'
import { createServices } from '../../src/services'
import { createApiService } from '../../src/services/api.service'
import { createGithubService } from '../../src/services/github.service'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { fixtureData } from '../utils/fixtureData'
import { createStorageService } from '../../src/services/storage.service'
import { createAppStore } from '../../src/store'
import { importGithubLink } from '../../src/store/github.slice'
import { ERROR_CODE, FORM_ERROR_MESSAGE, GITHUB_LINK_HINT } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco" data-language={language}>
      {value}
    </div>
  )
}))

const base = 'https://github.com/example-org'
const fileLink = `${base}/demo/blob/main/src/greet.ts`
const pullLink = `${base}/demo/pull/1`

function linkField() {
  return screen.getByRole('textbox', { name: GITHUB_LINK_TEXT.label })
}

async function paste(user: ReturnType<typeof userEvent.setup>, url: string) {
  await user.clear(linkField())
  if (url) await user.type(linkField(), url)
  await user.click(screen.getByRole('button', { name: GITHUB_LINK_TEXT.import }))
}

// The app on the fake backend, with error toasts captured.
function renderJsonApp(option: { reviewFailed?: boolean } = {}) {
  const toast = { success: vi.fn(), error: vi.fn() }
  const storage = createStorageService(() => undefined)
  const services = createServices({ dataSource: createFixtureDataSource({ storage }), storage, notification: { toast } })
  const settings = AppSettings.defaultDto()
  const preloadedState = { settings: { ...settings, notification: { ...settings.notification, reviewFailed: option.reviewFailed ?? true } } }
  const result = renderWithStore(<App />, { route: '/github', services, preloadedState })
  return { ...result, toast, services }
}

describe('parseGithubLink (client-side shape check)', () => {
  it.each([
    [fileLink, 'example-org/demo/blob/main/src/greet.ts'],
    [`${base}/demo/blob/v1.2.0/a.py`, 'example-org/demo/blob/v1.2.0/a.py'],
    [`${base}/demo/blob/0123456789abcdef0123456789abcdef01234567/a.go`, 'example-org/demo/blob/0123456789abcdef0123456789abcdef01234567/a.go'],
    [pullLink, 'example-org/demo/pull/1'],
    [`${pullLink}/files`, 'example-org/demo/pull/1'],
    [`  ${fileLink}?plain=1#L10  `, 'example-org/demo/blob/main/src/greet.ts'],
    // Parity with the backend parser (QA D3): a case-insensitive prefix, one trailing slash on a pull link.
    ['HTTPS://GITHUB.COM/example-org/demo/pull/1', 'example-org/demo/pull/1'],
    [`${pullLink}/`, 'example-org/demo/pull/1'],
    [`${pullLink}/files/`, 'example-org/demo/pull/1'],
    [`${base}/demo/blob/main/my%20file.ts`, 'example-org/demo/blob/main/my file.ts']
  ])('accepts %s', (url, key) => {
    const link = parseGithubLink(url)
    expect(link).not.toBeNull()
    expect(githubLinkKey(link!)).toBe(key)
  })

  it.each([
    '',
    'not a link',
    'http://github.com/example-org/demo/pull/1',
    'https://www.github.com/example-org/demo/pull/1',
    'https://github.com.evil.com/example-org/demo/pull/1',
    'https://user@github.com/example-org/demo/pull/1',
    'https://github.com:443/example-org/demo/pull/1',
    'https://raw.githubusercontent.com/example-org/demo/main/a.ts',
    'https://gist.github.com/example-org/1',
    `${base}/demo/tree/main/src`,
    `${base}/demo/commit/0123456`,
    `${base}/demo/blob/main/../secret.ts`,
    `${base}/demo/blob/main/%2e%2e/secret.ts`,
    `${base}/demo/blob/main/a%2fb.ts`,
    `${base}/demo/blob/main/a%5cb.ts`,
    `${base}/demo/blob/main/a%00.ts`,
    `${base}/demo/blob/main//a.ts`,
    `${base}/demo/blob/main`,
    `${base}/demo/pull/abc`,
    `${base}/demo/pull/01`,
    `${base}/demo/pull/1/commits`,
    'https://github.com/example-org',
    `${base}/demo/blob/main/${'a'.repeat(2000)}.ts`,
    // Refused by the backend too (QA D3): white space or a backslash in the raw text, a double dash.
    `${base}/demo/blob/main/my file.ts`,
    `${base}/demo/blob/main/a\\b.ts`,
    'https://github.com/example--org/demo/pull/1',
    `${pullLink}//`,
    `${base}/demo/blob/main/a.ts/`,
    `${base}/demo/blob/main/${'a/'.repeat(500)}b.ts`
  ])('rejects %s', (url) => {
    expect(parseGithubLink(url)).toBeNull()
  })
})

describe('GitHub link field', () => {
  it('is on the GitHub Integration page above the wizard, without connecting', () => {
    renderJsonApp()

    const heading = screen.getByRole('heading', { name: GITHUB_LINK_TEXT.title })
    const wizard = screen.getByRole('heading', { name: 'Select Repository' })
    expect(heading.compareDocumentPosition(wizard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(linkField()).toBeEnabled()
    expect(screen.getByText(new RegExp(GITHUB_LINK_TEXT.limit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
  })

  it('asks for a link when the field is empty and sends nothing', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: '/github', services })
    await paste(user, '')

    expect(screen.getByRole('alert')).toHaveTextContent(FORM_ERROR_MESSAGE.githubLinkRequired)
    expect(linkField()).toHaveAttribute('aria-invalid', 'true')
    expect(services.github.importLink).not.toHaveBeenCalled()
  })

  it('rejects a link of the wrong shape before sending, and clears the error once fixed', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: '/github', services })
    await paste(user, `${base}/demo/tree/main/src`)

    expect(screen.getByRole('alert')).toHaveTextContent(FORM_ERROR_MESSAGE.githubLinkInvalid)
    expect(services.github.importLink).not.toHaveBeenCalled()

    await user.clear(linkField())
    await user.type(linkField(), fileLink)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(linkField()).toHaveAttribute('aria-invalid', 'false')
  })

  it('imports a file link and opens it in the editor as a new unsaved review', async () => {
    const user = userEvent.setup()
    renderJsonApp()
    await paste(user, `  ${fileLink}  `)

    expect(await screen.findByText(`Imported greet.ts (1 file)`)).toBeInTheDocument()
    expect(screen.getByText(`No files skipped. ${GITHUB_LINK_TEXT.limit}`)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
    expect(screen.getByTestId('review-name')).toHaveTextContent('greet.ts')
    expect(screen.getByTestId('monaco')).toHaveTextContent('export function greet(name: any) {')
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'typescript')
    expect(screen.getByRole('button', { name: 'Run review' })).toBeEnabled()
  })

  it('imports a pull request and lists the skipped files in the success toast', async () => {
    const user = userEvent.setup()
    renderJsonApp()
    await paste(user, pullLink)

    expect(await screen.findByText('Imported example-org/demo#1 (2 files)')).toBeInTheDocument()
    expect(
      screen.getByText(`Skipped 2 files: assets/logo.png (unsupported type), src/old.js (removed). ${GITHUB_LINK_TEXT.limit}`)
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
    // Plan 034 (Open Question 3): each file of the pull request is its own draft in a file list,
    // with its own code (no header line); the skipped files are listed too.
    const list = screen.getByRole('navigation', { name: 'Imported files' })
    expect(within(list).getAllByRole('button').map((item) => item.title)).toEqual([
      'src/greet.ts',
      'src/util.py',
      'assets/logo.png: unsupported type',
      'src/old.js: removed'
    ])
    expect(screen.getByTestId('review-name')).toHaveTextContent('src/greet.ts')
    expect(screen.getByTestId('monaco')).toHaveTextContent('export function greet')
    expect(screen.getByTestId('monaco')).not.toHaveTextContent('=====')
  })

  it('sends the trimmed link and disables Import while it loads', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    let release = () => {}
    services.github.importLink.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ name: 'a.ts', language: 'TypeScript', content: 'x\n', fileList: [], skippedList: [] })
        })
    )
    renderWithStore(<App />, { route: '/github', services })
    await paste(user, ` ${fileLink} `)

    expect(services.github.importLink).toHaveBeenCalledWith(fileLink)
    expect(screen.getByRole('button', { name: GITHUB_LINK_TEXT.importing })).toBeDisabled()
    release()
    expect(await screen.findByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
  })
})

describe('GitHub link import error toasts', () => {
  const prefix = 'Could not import the GitHub link.'

  it.each([
    ['413 fileChar', `${base}/demo/blob/main/src/huge.ts`, GITHUB_LINK_HINT.limit.fileChar],
    ['429', `${base}/rate-limited/blob/main/a.ts`, GITHUB_LINK_HINT.rateLimited],
    ['502', `${base}/broken/blob/main/a.ts`, 'GitHub is unavailable or sent an unexpected answer, try again later.'],
    ['504', `${base}/slow/blob/main/a.ts`, 'GitHub took too long to answer, please try again.'],
    ['404', `${base}/demo/blob/main/src/missing.ts`, GITHUB_LINK_HINT.notFound]
  ])('%s shows its constant toast and keeps the page', async (_name, url, hint) => {
    const user = userEvent.setup()
    const { toast } = renderJsonApp()
    await paste(user, url)

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith(`${prefix} ${hint}`)
    expect(screen.getByRole('heading', { name: GITHUB_LINK_TEXT.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: GITHUB_LINK_TEXT.import })).toBeEnabled()
  })

  it('shows each 413 limit with the frontend numbers, and the other errors per cause', () => {
    const error = (status: number, code: string, details?: object) =>
      AppError.fromResponse(status, { error: { code, message: 'server text', details } }).forAction(ERROR_CODE.githubLinkImport)

    expect(error(413, 'payload_too_large', { limit: 'fileChar', max: 1 }).userMessage).toBe(`${prefix} A file is over 50,000 characters.`)
    expect(error(413, 'payload_too_large', { limit: 'totalChar', max: 1 }).userMessage).toBe(`${prefix} The code is over 100,000 characters in total.`)
    expect(error(413, 'payload_too_large', { limit: 'fileCount', max: 1 }).userMessage).toBe(`${prefix} The pull request changes more than 20 files.`)
    expect(error(413, 'payload_too_large').userMessage).toBe(`${prefix} It is too large, shorten it and try again.`)
    expect(error(422, 'validation_error', { issue: [{ field: 'url', message: 'x' }] }).userMessage).toBe(`${prefix} ${GITHUB_LINK_HINT.validation}`)
    expect(error(500, 'internal_error').userMessage).toBe(`${prefix} The server had a problem, please try again shortly.`)
    expect(GITHUB_IMPORT_LIMIT).toEqual({ fileChar: 50_000, totalChar: 100_000, fileCount: 20 })
    // The server's own text is never what the user sees.
    expect(error(502, 'upstream_error').userMessage).not.toContain('server text')
  })

  it('shows GitHub import failures even when "Review failed" notifications are off', async () => {
    const user = userEvent.setup()
    const { toast } = renderJsonApp({ reviewFailed: false })
    await paste(user, `${base}/broken/blob/main/a.ts`)

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toMatch(/^Could not import the GitHub link\./)
  })

  it('shows a network failure as a connection problem', async () => {
    const user = userEvent.setup()
    const { services, toast } = createFakeServices()
    services.github.importLink.mockRejectedValue(new AppError({ code: ERROR_CODE.network, kind: 'network' }))
    renderWithStore(<App />, { route: '/github', services })
    await paste(user, fileLink)

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith(`${prefix} Check your internet connection and try again.`)
  })
})

describe('importGithubLink thunk', () => {
  it('keeps the imported code as the new review draft', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services })
    const pending = store.dispatch(importGithubLink(pullLink))
    expect(store.getState().github.linkImportStatus).toBe('loading')
    await pending

    expect(services.github.importLink).toHaveBeenCalledWith(pullLink)
    expect(store.getState().github.linkImportStatus).toBe('succeeded')
    expect(store.getState().review.draft).toEqual({ title: 'a.ts', language: 'TypeScript', content: 'const a = 1\n' })
  })

  it('cuts a long suggested name to the review name limit', async () => {
    const { services } = createFakeServices()
    services.github.importLink.mockResolvedValue({ name: 'n'.repeat(120), language: 'Go', content: 'x', fileList: [], skippedList: [] })
    const store = createAppStore({ services })
    await store.dispatch(importGithubLink(pullLink))

    expect(store.getState().review.draft?.title?.length ?? 0).toBeLessThanOrEqual(80)
    expect(store.getState().review.draft?.title).toMatch(/^n+/)
  })

  it('rejects with the link-import action and the cause, and leaves the draft alone', async () => {
    const { services } = createFakeServices()
    services.github.importLink.mockRejectedValue(
      AppError.fromResponse(413, { error: { code: 'payload_too_large', message: 'x', details: { limit: 'totalChar', max: 100000 } } })
    )
    const store = createAppStore({ services })
    const result = await store.dispatch(importGithubLink(pullLink))

    expect(importGithubLink.rejected.match(result)).toBe(true)
    expect(store.getState().github.linkImportStatus).toBe('failed')
    expect(store.getState().github.error).toMatchObject({
      code: ERROR_CODE.githubLinkImport,
      causeCode: ERROR_CODE.payloadTooLarge,
      status: 413,
      limit: 'totalChar'
    })
    expect(store.getState().review.draft).toBeNull()
  })
})

describe('github.importLink on both data sources', () => {
  it('JSON: answers the seeded code for the example links, with no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const github = createGithubService(createFixtureDataSource({ storage: createStorageService(() => undefined) }))

    expect(await github.importLink(fileLink)).toEqual(fixtureData.githubImportByLink['example-org/demo/blob/main/src/greet.ts'])
    expect((await github.importLink(`${pullLink}/files`)).skippedList).toHaveLength(2)
    await expect(github.importLink(`${base}/other/pull/1`)).rejects.toMatchObject({ code: ERROR_CODE.notFound, status: 404 })
    await expect(github.importLink('http://github.com/a/b/pull/1')).rejects.toMatchObject({ code: ERROR_CODE.validation, status: 422 })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('API: posts { url } to /api/github/import and checks the answer', async () => {
    const answer = fixtureData.githubImportByLink['example-org/demo/pull/1']
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }))
    const github = createGithubService(createApiService({ baseUrl: 'http://api.test', fetchFn }))

    expect(await github.importLink(` ${pullLink} `)).toEqual(answer)
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/api/github/import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: pullLink }) }))
  })

  it('API: an answer of the wrong shape is a parse error', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ name: 'a.ts' }), { status: 200 }))
    const github = createGithubService(createApiService({ baseUrl: 'http://api.test', fetchFn }))

    await expect(github.importLink(fileLink)).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('API: maps upstream_error and upstream_timeout by their server code, and keeps a plain 502 a server error', async () => {
    const respond = (status: number, code: string) =>
      createGithubService(
        createApiService({ baseUrl: 'http://api.test', fetchFn: async () => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status }) })
      ).importLink(fileLink)

    await expect(respond(502, 'upstream_error')).rejects.toMatchObject({ code: ERROR_CODE.upstreamError })
    await expect(respond(504, 'upstream_timeout')).rejects.toMatchObject({ code: ERROR_CODE.upstreamTimeout })
    await expect(respond(502, 'internal_error')).rejects.toMatchObject({ code: ERROR_CODE.server })
  })

  it('keeps the 413 limit through forAction, toJSON and fromJson', () => {
    const error = AppError.fromResponse(413, { error: { code: 'payload_too_large', message: 'x', details: { limit: 'fileCount', max: 20 } } })
    const json = error.forAction(ERROR_CODE.githubLinkImport).toJSON()

    expect(json.limit).toBe('fileCount')
    expect(AppError.fromJson(json).userMessage).toBe(json.userMessage)
    expect(AppError.fromResponse(404, { error: { code: 'not_found', message: 'x' } }).toJSON()).not.toHaveProperty('limit')
  })
})
