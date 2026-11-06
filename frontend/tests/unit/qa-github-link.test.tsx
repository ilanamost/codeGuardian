import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { GITHUB_LINK_TEXT } from '../../src/lib/github.constants'
import { AppError } from '../../src/models/app-error'
import type { GithubImportDto } from '../../src/models/dto'
import { parseGithubLink } from '../../src/models/github.model'
import { createGithubService } from '../../src/services/github.service'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { createStorageService } from '../../src/services/storage.service'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

// QA adversarial pass for plan 023 (AI-46): the "Paste a GitHub link" field. No network.

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>
}))

const fileLink = 'https://github.com/example-org/demo/blob/main/src/greet.ts'
const pullLink = 'https://github.com/example-org/demo/pull/1'

function linkField() {
  return screen.getByRole('textbox', { name: GITHUB_LINK_TEXT.label })
}

function importButton() {
  return screen.getByRole('button', { name: /Import/ })
}

function deferred() {
  let resolve: (value: GithubImportDto) => void = () => {}
  const promise = new Promise<GithubImportDto>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const result: GithubImportDto = { name: 'a.ts', language: 'TypeScript', content: 'const a = 1\n', fileList: [], skippedList: [] }

describe('QA: client shape check against hostile links', () => {
  it.each([
    'https://gіthub.com/example-org/demo/pull/1',
    'https://ｇｉｔｈｕｂ.com/example-org/demo/pull/1',
    'https://github.com./example-org/demo/pull/1',
    'https://a:b@github.com/example-org/demo/pull/1',
    'https://github.com@evil.com/example-org/demo/pull/1',
    'https://github.com%2f@evil.com/example-org/demo/pull/1',
    'https:\\\\github.com\\example-org/demo/pull/1',
    'https://github.com/example-org/demo/blob/main/.%2e/a.ts',
    'https://github.com/example-org/demo/blob/%2e%2e/a.ts',
    'javascript:alert(1)//https://github.com/example-org/demo/pull/1'
  ])('refuses %s', (url) => {
    expect(parseGithubLink(url)).toBeNull()
  })

  // Parity with the backend parser (backend accepts all three; see qa-report D3).
  it.each([
    'HTTPS://GITHUB.COM/example-org/demo/pull/1',
    `${pullLink}/`,
    `${pullLink}/files/`
  ])('accepts %s, as the backend does', (url) => {
    expect(parseGithubLink(url)).not.toBeNull()
  })
})

describe('QA: the field under rapid interaction', () => {
  it('a burst of submits while importing sends one request', async () => {
    const { services } = createFakeServices()
    const pending = deferred()
    services.github.importLink.mockImplementation(() => pending.promise)
    renderWithStore(<App />, { route: '/github', services })
    fireEvent.change(linkField(), { target: { value: fileLink } })

    const form = linkField().closest('form') as HTMLFormElement
    for (let index = 0; index < 5; index += 1) fireEvent.submit(form)

    expect(services.github.importLink).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(result))
    expect(await screen.findByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
  })

  it('a user who leaves the page while importing is not pulled to the editor', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    const pending = deferred()
    services.github.importLink.mockImplementation(() => pending.promise)
    renderWithStore(<App />, { route: '/github', services })
    await user.type(linkField(), fileLink)
    await user.click(importButton())

    await user.click(screen.getAllByRole('link', { name: /Help/ })[0])
    await act(async () => pending.resolve(result))

    expect(screen.queryByRole('heading', { name: 'Review Results' })).not.toBeInTheDocument()
  })
})

describe('QA: imported text is never rendered as HTML', () => {
  it('a hostile name and skipped path show as text in the toast', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    services.github.importLink.mockResolvedValue({
      ...result,
      name: '<img src=x onerror="window.__xss=1">',
      content: '<script>window.__xss=2</script>',
      skippedList: [{ path: '<b>bold</b>.png', reason: 'unsupported_type' }]
    })
    const { container } = renderWithStore(<App />, { route: '/github', services })
    await user.type(linkField(), fileLink)
    await user.click(importButton())

    expect(await screen.findByText(/Imported <img src=x/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })
})

describe('QA: fake backend refuses what the backend refuses', () => {
  const storage = createStorageService(() => undefined)
  const github = createGithubService(createFixtureDataSource({ storage }))

  it.each([
    ['an unknown field', { url: fileLink, extra: 1 }],
    ['a non-string url', { url: 1 }],
    ['a look-alike host', { url: 'https://github.com.evil.com/example-org/demo/pull/1' }]
  ])('answers %s with 422', async (_label, body) => {
    const source = createFixtureDataSource({ storage })
    const error = await source.request('POST', '/api/github/import', body).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).status).toBe(422)
  })

  it('answers the example file link and the PR link with no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect((await github.importLink(fileLink)).name).toBe('greet.ts')
    expect((await github.importLink(pullLink)).fileList).toHaveLength(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps a 400 bad_request (backend defect D1 path) to a link-import toast text', () => {
    const error = AppError.fromResponse(400, { error: { code: 'bad_request', message: 'The request URL is not correctly encoded.' } })
      .forAction(ERROR_CODE.githubLinkImport)
    expect(error.userMessage).toMatch(/^Could not import the GitHub link\./)
    expect(error.userMessage).not.toContain('request URL')
  })
})
