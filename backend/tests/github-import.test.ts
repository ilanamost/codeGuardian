import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGithubClient } from '../src/lib/github-fetch.js'
import { createFakeGithubFetch, FAKE_GITHUB_FILE } from '../src/lib/github-fake.js'
import { LIMIT } from '../src/utils/limits.js'
import { buildApp } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'
import { API, delay, expectOnlyGithubApi, fakeGithub, fileResponse, jsonResponse, notFound, textOf, type FakeHandler } from './helper/github.js'

// POST /api/github/import (plan 023, contract 0.7.0), through the app with a fake GitHub.

const sha = '0123456789abcdef0123456789abcdef01234567'
const blobUrl = 'https://github.com/octo/repo/blob/main/src/a.ts'
const pullUrl = 'https://github.com/octo/repo/pull/7'

function appWith(handler: FakeHandler, option: { callTimeoutMs?: number, totalTimeoutMs?: number } = {}) {
  const github = fakeGithub(handler)
  const { app } = buildApp({
    githubClient: github.client({ callTimeoutMs: option.callTimeoutMs }),
    githubImport: { totalTimeoutMs: option.totalTimeoutMs }
  })
  return { app, callList: github.callList }
}

function post(app: ReturnType<typeof buildApp>['app'], body: unknown) {
  return request(app).post('/api/github/import').send(body as object)
}

type PullFile = { filename: string, status: string, changes: number }

// A fake PR: its metadata, its file list, and each file's content at the head commit.
function pullHandler(fileList: PullFile[], contentByPath: Record<string, () => Response>, changedFiles = fileList.length): FakeHandler {
  return (url) => {
    if (url.pathname === '/repos/octo/repo/pulls/7') return jsonResponse({ changed_files: changedFiles, head: { sha } })
    if (url.pathname === '/repos/octo/repo/pulls/7/files') return jsonResponse(fileList)
    const prefix = '/repos/octo/repo/contents/'
    if (url.pathname.startsWith(prefix) && url.searchParams.get('ref') === sha) {
      const answer = contentByPath[decodeURIComponent(url.pathname.slice(prefix.length))]
      if (answer) return answer()
    }
    return notFound()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/github/import: a file (blob) link', () => {
  it('returns the file text unchanged, named after the file', async () => {
    const { app, callList } = appWith(() => fileResponse('const a: any = 1\n'))

    const response = await post(app, { url: blobUrl })

    expectContract(response, '/api/github/import', 'POST')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      name: 'a.ts',
      language: 'TypeScript',
      content: 'const a: any = 1\n',
      fileList: [{ path: 'src/a.ts', language: 'TypeScript', size: 17 }],
      skippedList: [],
      // Plan 034: one entry equal to `content`.
      fileContentList: [{ path: 'src/a.ts', language: 'TypeScript', content: 'const a: any = 1\n' }]
    })
    expect(callList.map((call) => call.url)).toEqual([`${API}/repos/octo/repo/contents/src/a.ts?ref=main`])
    expectOnlyGithubApi(callList)
  })

  it.each([
    ['a.tsx', 'TypeScript'], ['a.mjs', 'JavaScript'], ['A.PY', 'Python'], ['main.go', 'Go'], ['App.java', 'Java']
  ])('detects the language of %s as %s', async (file, language) => {
    const { app } = appWith(() => fileResponse('x\n'))

    const response = await post(app, { url: `https://github.com/octo/repo/blob/main/${file}` })

    expect(response.body.language).toBe(language)
  })

  it.each(['README.md', 'logo.png', 'Makefile', '.gitignore'])('refuses %s as Unsupported file type before any GitHub call', async (file) => {
    const { app, callList } = appWith(() => fileResponse('x\n'))

    const response = await post(app, { url: `https://github.com/octo/repo/blob/main/${file}` })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.error.message).toContain('Unsupported file type')
    expect(callList).toHaveLength(0)
  })

  it.each([
    ['a folder', () => jsonResponse([]), /folder/],
    ['a symlink', () => jsonResponse({ type: 'symlink', size: 3 }), /symbolic link/],
    ['a binary file', () => fileResponse(new Uint8Array([0, 1, 2])), /not a text file/],
    ['an empty file', () => fileResponse(''), /empty/]
  ])('refuses %s with 422', async (_label, answer, message) => {
    const { app } = appWith(answer)

    const response = await post(app, { url: blobUrl })

    expectError(response, 422, 'validation_error')
    expect(response.body.error.message).toMatch(message)
  })

  it('cuts a long file name to the 80-character review name limit', async () => {
    const { app } = appWith(() => fileResponse('x\n'))

    const response = await post(app, { url: `https://github.com/octo/repo/blob/main/${'n'.repeat(90)}.ts` })

    expect(response.body.name).toHaveLength(80)
  })
})

describe('POST /api/github/import: a pull request link', () => {
  const mixedList: PullFile[] = [
    { filename: 'src/a.ts', status: 'modified', changes: 3 },
    { filename: 'app.py', status: 'added', changes: 2 },
    { filename: 'src/old.ts', status: 'removed', changes: 9 },
    { filename: 'src/moved.ts', status: 'renamed', changes: 0 },
    { filename: 'logo.png', status: 'added', changes: 0 },
    { filename: 'src/bin.ts', status: 'added', changes: 1 },
    { filename: 'src/b.ts', status: 'renamed', changes: 2 },
    { filename: 'src/../x.ts', status: 'added', changes: 1 }
  ]
  const mixedContent: Record<string, () => Response> = {
    'src/a.ts': () => fileResponse('const a = 1\n'),
    'app.py': () => fileResponse('print(1)'),
    'src/bin.ts': () => fileResponse(new Uint8Array([0x00, 0x01])),
    'src/b.ts': () => fileResponse('const b = 2\n')
  }

  it('joins the kept files with header comments and lists the others as skipped', async () => {
    const { app, callList } = appWith(pullHandler(mixedList, mixedContent))

    const response = await post(app, { url: `${pullUrl}/files` })

    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.content).toBe([
      '// ===== src/a.ts =====',
      'const a = 1',
      '',
      '# ===== app.py =====',
      'print(1)',
      '',
      '// ===== src/b.ts =====',
      'const b = 2',
      ''
    ].join('\n'))
    expect(response.body).toMatchObject({
      name: 'octo/repo#7',
      language: 'TypeScript',
      fileList: [
        { path: 'src/a.ts', language: 'TypeScript', size: 12 },
        { path: 'app.py', language: 'Python', size: 8 },
        { path: 'src/b.ts', language: 'TypeScript', size: 12 }
      ],
      skippedList: [
        { path: 'src/old.ts', reason: 'removed' },
        { path: 'src/moved.ts', reason: 'renamed' },
        { path: 'logo.png', reason: 'unsupported_type' },
        { path: 'src/../x.ts', reason: 'invalid_path' },
        { path: 'src/bin.ts', reason: 'binary' }
      ]
    })
    // Only kept candidates are read, each at the PR head commit, and never the unsafe path.
    expect(callList.map((call) => call.url)).toEqual([
      `${API}/repos/octo/repo/pulls/7`,
      `${API}/repos/octo/repo/pulls/7/files?per_page=100`,
      `${API}/repos/octo/repo/contents/src/a.ts?ref=${sha}`,
      `${API}/repos/octo/repo/contents/app.py?ref=${sha}`,
      `${API}/repos/octo/repo/contents/src/bin.ts?ref=${sha}`,
      `${API}/repos/octo/repo/contents/src/b.ts?ref=${sha}`
    ])
    expectOnlyGithubApi(callList)
  })

  it('returns the code of each kept file unchanged, in the fileList order, without headers (plan 034)', async () => {
    const { app, callList } = appWith(pullHandler(mixedList, mixedContent))

    const response = await post(app, { url: pullUrl })

    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.fileContentList).toEqual([
      { path: 'src/a.ts', language: 'TypeScript', content: 'const a = 1\n' },
      // No line break is added to the per-file code (the joined text adds one).
      { path: 'app.py', language: 'Python', content: 'print(1)' },
      { path: 'src/b.ts', language: 'TypeScript', content: 'const b = 2\n' }
    ])
    expect(response.body.fileContentList.map((file: { path: string }) => file.path))
      .toEqual(response.body.fileList.map((file: { path: string }) => file.path))
    // The skipped files have no code, and the joined text is unchanged.
    expect(response.body.skippedList).toHaveLength(5)
    expect(response.body.content.startsWith('// ===== src/a.ts =====\nconst a = 1\n')).toBe(true)
    // No extra GitHub call for the per-file code.
    expect(callList).toHaveLength(6)
    expectOnlyGithubApi(callList)
  })

  it('takes the most common language, the first listed winning a tie', async () => {
    const list = [
      { filename: 'a.py', status: 'added', changes: 1 },
      { filename: 'b.go', status: 'added', changes: 1 },
      { filename: 'c.go', status: 'added', changes: 1 },
      { filename: 'd.py', status: 'added', changes: 1 }
    ]
    const content = Object.fromEntries(list.map((item) => [item.filename, () => fileResponse('x\n')]))

    const response = await post(appWith(pullHandler(list, content)).app, { url: pullUrl })

    expect(response.body.language).toBe('Python')
  })

  it('refuses a PR with no file left to import, listing why', async () => {
    const list = [{ filename: 'logo.png', status: 'added', changes: 0 }, { filename: 'a.ts', status: 'removed', changes: 1 }]
    const { app, callList } = appWith(pullHandler(list, {}))

    const response = await post(app, { url: pullUrl })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.error.details.skippedList).toEqual([
      { path: 'logo.png', reason: 'unsupported_type' }, { path: 'a.ts', reason: 'removed' }
    ])
    expect(callList).toHaveLength(2)
  })

  it('returns 404 for a missing or private PR', async () => {
    const response = await post(appWith(notFound).app, { url: pullUrl })

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/github/import', 'POST')
  })
})

describe('POST /api/github/import: the file count limit (20 files)', () => {
  const listOf = (count: number) => Array.from({ length: count }, (_, index) => ({ filename: `f${index}.ts`, status: 'added', changes: 1 }))
  const contentOf = (count: number) => Object.fromEntries(listOf(count).map((item) => [item.filename, () => fileResponse('x\n')]))

  it.each([LIMIT.github.fileCount - 1, LIMIT.github.fileCount])('imports a PR of %d files', async (count) => {
    const response = await post(appWith(pullHandler(listOf(count), contentOf(count))).app, { url: pullUrl })

    expect(response.status).toBe(200)
    expect(response.body.fileList).toHaveLength(count)
  })

  it('refuses 21 changed files with 413 fileCount after one call', async () => {
    const count = LIMIT.github.fileCount + 1
    const { app, callList } = appWith(pullHandler(listOf(count), contentOf(count)))

    const response = await post(app, { url: pullUrl })

    expectError(response, 413, 'payload_too_large')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.error.details).toEqual({ limit: 'fileCount', max: 20 })
    expect(callList).toHaveLength(1)
  })

  it('refuses a file list longer than 20 even when the PR count said less', async () => {
    const { app, callList } = appWith(pullHandler(listOf(21), contentOf(21), 3))

    const response = await post(app, { url: pullUrl })

    expect(response.status).toBe(413)
    expect(response.body.error.details).toEqual({ limit: 'fileCount', max: 20 })
    expect(callList).toHaveLength(2)
  })
})

describe('POST /api/github/import: the total limit (100 000 characters)', () => {
  // Two files: each block is the 19-character header, a line break and the text, plus one
  // separator line break, so the joined text is 41 + first + second characters.
  const list = [{ filename: 'a.ts', status: 'added', changes: 1 }, { filename: 'b.ts', status: 'added', changes: 1 }, { filename: 'c.ts', status: 'added', changes: 1 }]
  const first = LIMIT.github.fileChar
  const fitting = LIMIT.github.totalChar - 41 - first

  it.each([fitting - 1, fitting])('imports a joined text whose second file has %d characters', async (second) => {
    const content = { 'a.ts': () => fileResponse(textOf(first)), 'b.ts': () => fileResponse(textOf(second)) }

    const response = await post(appWith(pullHandler(list.slice(0, 2), content)).app, { url: pullUrl })

    expect(response.status).toBe(200)
    expect(response.body.content.length).toBe(41 + first + second)
    expect(response.body.content.length).toBeLessThanOrEqual(LIMIT.content.max)
    // Plan 034: the per-file code at the limit is each file whole, each within the file limit.
    expect(response.body.fileContentList.map((file: { content: string }) => file.content.length)).toEqual([first, second])
  })

  it('refuses one character more with 413 totalChar and reads no further file', async () => {
    const content = { 'a.ts': () => fileResponse(textOf(first)), 'b.ts': () => fileResponse(textOf(fitting + 1)), 'c.ts': () => fileResponse('x\n') }
    const { app, callList } = appWith(pullHandler(list, content))

    const response = await post(app, { url: pullUrl })

    expectError(response, 413, 'payload_too_large')
    expect(response.body.error.details).toEqual({ limit: 'totalChar', max: LIMIT.github.totalChar, path: 'b.ts' })
    expect(callList.map((call) => call.url).some((url) => url.includes('/c.ts'))).toBe(false)
  })

  it('refuses a PR file over the single-file limit with 413 fileChar and stops', async () => {
    const content = { 'a.ts': () => fileResponse(textOf(first + 1)), 'b.ts': () => fileResponse('x\n') }
    const { app, callList } = appWith(pullHandler(list.slice(0, 2), content))

    const response = await post(app, { url: pullUrl })

    expect(response.status).toBe(413)
    expect(response.body.error.details).toEqual({ limit: 'fileChar', max: first, path: 'a.ts' })
    expect(callList).toHaveLength(3)
  })

  it('refuses a blob over the single-file limit by declared size', async () => {
    const response = await post(appWith(() => fileResponse('x\n', { size: LIMIT.github.fileByte + 1 })).app, { url: blobUrl })

    expectError(response, 413, 'payload_too_large')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.error.details).toEqual({ limit: 'fileChar', max: first, path: 'src/a.ts' })
  })
})

describe('POST /api/github/import: upstream failures', () => {
  it('answers 429 rate_limited with the reset time', async () => {
    const { app } = appWith(() => jsonResponse({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1798761600' }))

    const response = await post(app, { url: blobUrl })

    expectError(response, 429, 'rate_limited')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.error.details).toEqual({ resetAt: '2027-01-01T00:00:00.000Z' })
  })

  it('answers 502 upstream_error for a GitHub 5xx, with none of its text in the body or the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { app } = appWith(() => new Response('UPSTREAM-SECRET', { status: 503, headers: { 'x-secret': 'HEADER-SECRET' } }))

    const response = await post(app, { url: blobUrl })

    expectError(response, 502, 'upstream_error')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.text).not.toMatch(/SECRET/)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRET/)
    expect(JSON.stringify(warn.mock.calls)).toContain('upstream_error')
  })

  it('answers 502 for a redirect and does not follow it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { app, callList } = appWith(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }))

    const response = await post(app, { url: blobUrl })

    expectError(response, 502, 'upstream_error')
    expect(callList).toHaveLength(1)
  })

  it('answers 504 callTimeout when one call stalls', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { app } = appWith(() => new Promise<Response>(() => undefined), { callTimeoutMs: 20 })

    const response = await post(app, { url: blobUrl })

    expectError(response, 504, 'upstream_timeout')
    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.error.details).toEqual({ limit: 'callTimeout', maxMs: 20 })
  })

  it('answers 504 totalTimeout when a slow sequence passes the overall deadline, and stops calling', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const list = Array.from({ length: 10 }, (_, index) => ({ filename: `f${index}.ts`, status: 'added', changes: 1 }))
    const content = Object.fromEntries(list.map((item) => [item.filename, () => fileResponse('x\n')]))
    const handler = pullHandler(list, content)
    const { app, callList } = appWith(async (url, init, index) => handler(url, init, await delay(25, () => index)), { callTimeoutMs: 1000, totalTimeoutMs: 120 })

    const response = await post(app, { url: pullUrl })

    expectError(response, 504, 'upstream_timeout')
    expect(response.body.error.details).toEqual({ limit: 'totalTimeout', maxMs: 120 })
    expect(callList.length).toBeLessThan(12)
  })

  it('never reaches the network by default in tests (offline client: 502)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { app } = buildApp()

    expectError(await post(app, { url: blobUrl }), 502, 'upstream_error')
  })
})

describe('POST /api/github/import: request validation', () => {
  it.each([
    ['a missing url', {}],
    ['a url that is not a string', { url: 42 }],
    ['an empty url', { url: '' }],
    ['an unknown field', { url: blobUrl, ref: 'main' }],
    ['a url over 2 000 characters', { url: `${blobUrl}#${'L'.repeat(2000)}` }]
  ])('refuses %s with 422 and makes no call', async (_label, body) => {
    const { app, callList } = appWith(() => fileResponse('x\n'))

    const response = await post(app, body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/github/import', 'POST')
    expect(callList).toHaveLength(0)
  })

  it('refuses a hostile link with 422 on the url field and makes no call', async () => {
    const { app, callList } = appWith(() => fileResponse('x\n'))

    const response = await post(app, { url: 'https://github.com.evil.com/octo/repo/blob/main/a.ts' })

    expectError(response, 422, 'validation_error')
    expect(response.body.error.details.issue[0].field).toBe('url')
    expect(response.text).not.toContain('evil')
    expect(callList).toHaveLength(0)
  })

  it('answers 400 for malformed JSON', async () => {
    const { app } = appWith(() => fileResponse('x\n'))

    const response = await request(app).post('/api/github/import').set('content-type', 'application/json').send('{"url":')

    expectError(response, 400, 'bad_request')
    expectContract(response, '/api/github/import', 'POST')
  })

  it('answers 413 for a body over the body limit', async () => {
    const github = fakeGithub(() => fileResponse('x\n'))
    const { app } = buildApp({ githubClient: github.client(), bodyCharLimit: 50 })

    const response = await post(app, { url: blobUrl })

    expectError(response, 413, 'payload_too_large')
    expect(github.callList).toHaveLength(0)
  })

  it('writes no log line with the query text of the typed link', async () => {
    const spyList = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    for (const spy of spyList) spy.mockImplementation(() => undefined)

    await post(appWith(() => new Response('', { status: 500 })).app, { url: `${blobUrl}?token=QUERY-SECRET` })
    await post(appWith(() => fileResponse('x\n')).app, { url: `${blobUrl}?token=QUERY-SECRET` })

    for (const spy of spyList) expect(JSON.stringify(spy.mock.calls)).not.toContain('QUERY-SECRET')
  })

  it('does not need a GitHub connection', async () => {
    const github = fakeGithub(() => fileResponse('x\n'))
    const { app, store } = buildApp({ githubClient: github.client() })

    const response = await post(app, { url: blobUrl })

    expect(store.state.github.connection).toBeNull()
    expect(response.status).toBe(200)
  })
})

// The fake GitHub that `index.ts` uses for e2e when GITHUB_FAKE is on (contract 0.7.0).
describe('POST /api/github/import: the e2e fake GitHub', () => {
  function fakeApp() {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    return buildApp({ githubClient: createGithubClient({ fetch: createFakeGithubFetch() }) }).app
  }

  it('imports the example file link', async () => {
    const response = await post(fakeApp(), { url: 'https://github.com/example-org/demo/blob/main/src/greet.ts' })

    expectContract(response, '/api/github/import', 'POST')
    expect(response.body).toMatchObject({ name: 'greet.ts', language: 'TypeScript', content: FAKE_GITHUB_FILE['src/greet.ts'] })
  })

  it('imports the example PR link with its skipped files', async () => {
    const response = await post(fakeApp(), { url: 'https://github.com/example-org/demo/pull/1' })

    expectContract(response, '/api/github/import', 'POST')
    expect(response.body.fileList.map((file: { path: string }) => file.path)).toEqual(['src/greet.ts', 'src/util.py'])
    expect(response.body.skippedList).toEqual([
      { path: 'assets/logo.png', reason: 'unsupported_type' },
      { path: 'src/old.js', reason: 'removed' }
    ])
    // Plan 034: the fake gives the matching per-file code.
    expect(response.body.fileContentList).toEqual([
      { path: 'src/greet.ts', language: 'TypeScript', content: FAKE_GITHUB_FILE['src/greet.ts'] },
      { path: 'src/util.py', language: 'Python', content: FAKE_GITHUB_FILE['src/util.py'] }
    ])
  })

  it.each([
    ['https://github.com/example-org/demo/blob/main/src/huge.ts', 413, 'payload_too_large'],
    ['https://github.com/example-org/rate-limited/blob/main/a.ts', 429, 'rate_limited'],
    ['https://github.com/example-org/broken/pull/1', 502, 'upstream_error'],
    ['https://github.com/example-org/slow/blob/main/a.ts', 504, 'upstream_timeout'],
    ['https://github.com/example-org/demo/blob/main/missing.ts', 404, 'not_found'],
    ['https://github.com/someone/else/pull/3', 404, 'not_found']
  ])('answers %s with %d', async (url, status, code) => {
    expectError(await post(fakeApp(), { url }), status, code)
  })
})
