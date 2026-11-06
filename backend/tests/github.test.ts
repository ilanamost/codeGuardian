import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { encodeFileId } from '../src/lib/github-id.js'
import { LIMIT } from '../src/utils/limits.js'
import { buildApp, registerAgent, registrationOf } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'
import { API, expectOnlyGithubApi, fakeGithub, fakeGithubClient, fakeUser, fileResponse, jsonResponse, notFound, stall, type FakeHandler } from './helper/github.js'

// Plan 030: the GitHub Integration wizard over the real GitHub API, tested against fakes only
// (the e2e fake of `src/lib/github-fake.ts`, or a recording fake per test). No network.

const connected = { login: fakeUser, name: 'Example User' }
const greetId = encodeFileId('src/greet.ts')
const idOf = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

// The e2e fake GitHub, signed in as the demo account.
function fakeApp() {
  return buildApp({ githubClient: fakeGithubClient() })
}

// A signed-in app over the e2e fake, already connected to `example-user`.
async function connectedApp() {
  const built = fakeApp()
  expect((await request(built.app).post('/api/github/connect').send({ username: fakeUser })).status).toBe(200)
  return built
}

// A recording fake whose store already holds a connection to `login`.
function recordingApp(handler: FakeHandler, login = fakeUser) {
  const github = fakeGithub(handler)
  const built = buildApp({ githubClient: github.client({ callTimeoutMs: 50 }), githubImport: { totalTimeoutMs: 200 } })
  built.store.state.github.connection = { login, name: null }
  return { ...built, github }
}

// Sends the path exactly as written: Supertest would resolve `.` and `%2e%2e` segments first.
async function rawGet(app: ReturnType<typeof buildApp>['app'], path: string): Promise<{ status: number, code: string }> {
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        let text = ''
        res.on('data', (chunk) => { text += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, code: (JSON.parse(text) as { error: { code: string } }).error.code }))
      })
      req.on('error', reject)
      req.end()
    })
  } finally {
    server.close()
  }
}

function repoEntry(name: string, extra: Record<string, unknown> = {}) {
  return { name, description: null, private: false, html_url: 'http://169.254.169.254/', clone_url: 'http://localhost/', ...extra }
}

describe('POST /api/github/connect', () => {
  it('connects an existing GitHub user, stores the login and name, and returns only the contract fields', async () => {
    const { app, store } = fakeApp()

    const response = await request(app).post('/api/github/connect').send({ username: fakeUser })

    expectContract(response, '/api/github/connect', 'POST')
    expect(response.body).toEqual(connected)
    expect(store.state.github.connection).toEqual(connected)
  })

  it('makes exactly one call, to /users/{username} on api.github.com, without credentials', async () => {
    const github = fakeGithub(() => jsonResponse({ login: 'Octocat', name: 'The Octocat', avatar_url: 'http://169.254.169.254/', email: 'x@y.z' }))
    const { app, store } = buildApp({ githubClient: github.client() })

    const response = await request(app).post('/api/github/connect').send({ username: 'octocat' })

    expect(response.body).toEqual({ login: 'Octocat', name: 'The Octocat' })
    expect(store.state.github.connection).toEqual({ login: 'Octocat', name: 'The Octocat' })
    expect(github.callList.map((call) => call.url)).toEqual([`${API}/users/octocat`])
    expectOnlyGithubApi(github.callList)
  })

  it('stores a null name when GitHub has none, and cleans a display name with control characters', async () => {
    const answerList = [{ login: 'a', name: null }, { login: 'b', name: ' Line\u0000one\n ' }, { login: 'c', name: '   ' }]
    const github = fakeGithub((_url, _init, index) => jsonResponse(answerList[index]))
    const { app } = buildApp({ githubClient: github.client() })

    const bodyList = []
    for (const username of ['a', 'b', 'c']) bodyList.push((await request(app).post('/api/github/connect').send({ username })).body)

    expect(bodyList).toEqual([{ login: 'a', name: null }, { login: 'b', name: 'Line one' }, { login: 'c', name: null }])
  })

  it('answers 404 for a user GitHub does not have, and stores nothing', async () => {
    const { app, store } = fakeApp()

    const response = await request(app).post('/api/github/connect').send({ username: 'nobody-here' })

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/github/connect', 'POST')
    expect(store.state.github.connection).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['40 characters', 'x'.repeat(40)],
    ['a leading hyphen', '-octocat'],
    ['a trailing hyphen', 'octocat-'],
    ['a double hyphen', 'octo--cat'],
    ['a space', 'octo cat'],
    ['a slash', 'octo/cat'],
    ['dot dot', '..'],
    ['unicode', 'öctocat'],
    ['a NUL', 'octo\u0000cat']
  ])('refuses a user name with %s with 422 on username, and makes no GitHub call', async (_label, username) => {
    const github = fakeGithub(() => jsonResponse({ login: 'x' }))
    const { app, store } = buildApp({ githubClient: github.client() })

    const response = await request(app).post('/api/github/connect').send({ username })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/github/connect', 'POST')
    expect(response.body.error.details.issue[0].field).toBe('username')
    expect(github.callList).toEqual([])
    expect(store.state.github.connection).toBeNull()
  })

  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['a number', { username: 42 }],
    ['an unknown field', { username: fakeUser, token: 'x' }],
    ['an array', [fakeUser]]
  ])('refuses %s with 422 and makes no GitHub call', async (_label, body) => {
    const github = fakeGithub(() => jsonResponse({ login: 'x' }))
    const { app } = buildApp({ githubClient: github.client() })

    expectError(await request(app).post('/api/github/connect').send(body as object), 422, 'validation_error')
    expect(github.callList).toEqual([])
  })

  it('answers 502 when GitHub sends a login that breaks the pattern, and stores nothing', async () => {
    const github = fakeGithub(() => jsonResponse({ login: '../evil' }))
    const { app, store } = buildApp({ githubClient: github.client() })

    const response = await request(app).post('/api/github/connect').send({ username: 'octocat' })

    expectError(response, 502, 'upstream_error')
    expect(store.state.github.connection).toBeNull()
  })

  it.each([
    ['rate-limited', 429, 'rate_limited'],
    ['broken', 502, 'upstream_error'],
    ['slow', 504, 'upstream_timeout']
  ])('the fake user %s gives %i %s, and stores nothing', async (username, status, code) => {
    const { app, store } = fakeApp()

    const response = await request(app).post('/api/github/connect').send({ username })

    expectError(response, status, code)
    expectContract(response, '/api/github/connect', 'POST')
    expect(store.state.github.connection).toBeNull()
    if (status === 429) expect(response.body.error.details).toEqual({ resetAt: '2027-01-01T00:00:00.000Z' })
  })

  it('replaces an earlier connection', async () => {
    const { app, store } = await connectedApp()

    await request(app).post('/api/github/connect').send({ username: 'empty-user' })

    expect(store.state.github.connection).toEqual({ login: 'empty-user', name: null })
  })

  it('is per account: connecting one account leaves another not connected', async () => {
    const { rawApp } = fakeApp()
    const alice = await registerAgent(rawApp, registrationOf('alice'))
    const bob = await registerAgent(rawApp, registrationOf('bob'))

    await alice.post('/api/github/connect').send({ username: fakeUser })

    expect((await alice.get('/api/github/repo')).status).toBe(200)
    expectError(await bob.get('/api/github/repo'), 409, 'conflict')
  })
})

describe('POST /api/github/disconnect', () => {
  it('forgets the connection with 204, the repository routes then answer 409, and a second disconnect is 204', async () => {
    const { app, store } = await connectedApp()

    const response = await request(app).post('/api/github/disconnect')

    expectContract(response, '/api/github/disconnect', 'POST')
    expect(response.status).toBe(204)
    expect(store.state.github.connection).toBeNull()
    expectError(await request(app).get('/api/github/repo'), 409, 'conflict')
    expect((await request(app).post('/api/github/disconnect')).status).toBe(204)
  })
})

describe('GET /api/github/repo', () => {
  it('answers 409 conflict without a connection, and makes no GitHub call', async () => {
    const github = fakeGithub(() => jsonResponse([]))
    const { app } = buildApp({ githubClient: github.client() })

    const response = await request(app).get('/api/github/repo')

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/github/repo', 'GET')
    expect(github.callList).toEqual([])
  })

  it("lists the connected user's repositories in GitHub's order with only the contract fields", async () => {
    const { app } = await connectedApp()

    const response = await request(app).get('/api/github/repo')

    expectContract(response, '/api/github/repo', 'GET')
    expect(response.body.truncated).toBe(false)
    expect(response.body.items.map((repo: { id: string }) => repo.id)).toEqual(['demo', 'many-file', 'empty', 'rate-limited', 'broken', 'slow'])
    expect(response.body.items[0]).toEqual({ id: 'demo', name: 'demo', description: 'A small demo repository' })
    expect(response.body.items[2]).toEqual({ id: 'empty', name: 'empty', description: '' })
    expect(response.text).not.toMatch(/169\.254|html_url|clone_url|full_name/)
  })

  it('asks GitHub for one page of owned repositories, most recently updated first', async () => {
    const { app, github } = recordingApp(() => jsonResponse([repoEntry('a')]))

    await request(app).get('/api/github/repo')

    const url = new URL(github.callList[0]?.url ?? '')
    expect(`${url.origin}${url.pathname}`).toBe(`${API}/users/${fakeUser}/repos`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'owner', sort: 'updated', direction: 'desc', per_page: '100' })
    expectOnlyGithubApi(github.callList)
  })

  it.each([
    ['DEMO', ['demo']],
    ['e', ['demo', 'many-file', 'empty', 'rate-limited', 'broken']],
    [' Many ', ['many-file']],
    ['zzz', []]
  ])('filters by a case-insensitive part of the name (%j)', async (query, idList) => {
    const { app } = await connectedApp()

    const response = await request(app).get('/api/github/repo').query({ query })

    expect(response.body.items.map((repo: { id: string }) => repo.id)).toEqual(idList)
  })

  it('answers an empty list for a user without repositories', async () => {
    const { app } = fakeApp()
    await request(app).post('/api/github/connect').send({ username: 'empty-user' })

    const response = await request(app).get('/api/github/repo')

    expectContract(response, '/api/github/repo', 'GET')
    expect(response.body).toEqual({ items: [], truncated: false })
  })

  it('marks the list truncated when GitHub has a next page', async () => {
    const { app } = fakeApp()
    await request(app).post('/api/github/connect').send({ username: 'busy-user' })

    const response = await request(app).get('/api/github/repo')

    expectContract(response, '/api/github/repo', 'GET')
    expect(response.body.items).toHaveLength(100)
    expect(response.body.truncated).toBe(true)
  })

  it('keeps at most 100 repositories and marks the list truncated when GitHub sends more', async () => {
    const { app } = recordingApp(() => jsonResponse(Array.from({ length: 101 }, (_, index) => repoEntry(`r${index}`))))

    const response = await request(app).get('/api/github/repo')

    expect(response.body.items).toHaveLength(LIMIT.github.repoListMax)
    expect(response.body.truncated).toBe(true)
  })

  it('leaves out private repositories and names GitHub itself would refuse', async () => {
    const { app } = recordingApp(() => jsonResponse([repoEntry('ok'), repoEntry('secret', { private: true }), repoEntry('..'), repoEntry('a/b'), repoEntry('x'.repeat(101))]))

    const response = await request(app).get('/api/github/repo')

    expect(response.body.items.map((repo: { id: string }) => repo.id)).toEqual(['ok'])
  })

  it('answers 502 for an unexpected answer shape', async () => {
    const { app } = recordingApp(() => jsonResponse({ not: 'a list' }))

    expectError(await request(app).get('/api/github/repo'), 502, 'upstream_error')
  })

  it('answers 404 when the connected user no longer exists', async () => {
    const { app } = recordingApp(() => notFound())

    const response = await request(app).get('/api/github/repo')

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/github/repo', 'GET')
  })

  it('returns 422 for a repeated query or one over 100 characters, before any GitHub call', async () => {
    const { app, github } = recordingApp(() => jsonResponse([]))

    expectError(await request(app).get('/api/github/repo?query=a&query=b'), 422, 'validation_error')
    expectError(await request(app).get(`/api/github/repo?query=${'q'.repeat(101)}`), 422, 'validation_error')
    expect(github.callList).toEqual([])
  })
})

describe('GET /api/github/repo/:repoId/file', () => {
  it('lists only blobs with a supported extension within the single-file limit, with base64url ids', async () => {
    const { app } = await connectedApp()

    const response = await request(app).get('/api/github/repo/demo/file')

    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
    expect(response.body).toEqual({
      items: [
        { id: greetId, path: 'src/greet.ts', language: 'TypeScript' },
        { id: encodeFileId('src/util.py'), path: 'src/util.py', language: 'Python' }
      ],
      truncated: false
    })
  })

  it('reads the recursive tree of the default branch, in one call', async () => {
    const { app, github } = recordingApp(() => jsonResponse({ tree: [], truncated: false }))

    await request(app).get('/api/github/repo/my.repo_1/file')

    expect(github.callList.map((call) => call.url)).toEqual([`${API}/repos/${fakeUser}/my.repo_1/git/trees/HEAD?recursive=1`])
    expectOnlyGithubApi(github.callList)
  })

  it('keeps at most 500 files and marks the list truncated', async () => {
    const { app } = await connectedApp()

    const response = await request(app).get('/api/github/repo/many-file/file')

    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
    expect(response.body.items).toHaveLength(LIMIT.github.fileListMax)
    expect(response.body.truncated).toBe(true)
  })

  it('passes on GitHub cutting the tree as truncated', async () => {
    const { app } = recordingApp(() => jsonResponse({ tree: [{ path: 'a.ts', type: 'blob', size: 1 }], truncated: true }))

    expect((await request(app).get('/api/github/repo/demo/file')).body).toEqual({ items: [{ id: idOf('a.ts'), path: 'a.ts', language: 'TypeScript' }], truncated: true })
  })

  it('answers an empty list for a repository without any commit (GitHub 409)', async () => {
    const { app } = await connectedApp()

    const response = await request(app).get('/api/github/repo/empty/file')

    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
    expect(response.body).toEqual({ items: [], truncated: false })
  })

  it('leaves out hostile, oversized and unsized entries', async () => {
    const tree = [
      { path: '../escape.ts', type: 'blob', size: 1 },
      { path: 'a\\b.ts', type: 'blob', size: 1 },
      { path: 'a//b.ts', type: 'blob', size: 1 },
      { path: 'nul\u0000.ts', type: 'blob', size: 1 },
      { path: 'big.ts', type: 'blob', size: LIMIT.github.listedFileByte + 1 },
      { path: 'edge.ts', type: 'blob', size: LIMIT.github.listedFileByte },
      { path: 'nosize.ts', type: 'blob' },
      { path: 'link.ts', type: 'commit', size: 1 }
    ]
    const { app } = recordingApp(() => jsonResponse({ tree }))

    const response = await request(app).get('/api/github/repo/demo/file')

    expect(response.body.items.map((file: { path: string }) => file.path)).toEqual(['edge.ts'])
  })

  it('answers 404 for a repository the user does not have', async () => {
    const { app } = await connectedApp()

    const response = await request(app).get('/api/github/repo/nope/file')

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
  })

  it.each([
    ['a%20b'],
    ['a%5Cb'],
    ['a%00'],
    ['x'.repeat(101)],
    ['r%C3%A9po']
  ])('answers 422 for the repoId %s, before any GitHub call', async (repoId) => {
    const { app, github } = recordingApp(() => jsonResponse({ tree: [] }))

    const response = await request(app).get(`/api/github/repo/${repoId}/file`)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
    expect(github.callList).toEqual([])
  })

  it.each([['%2e%2e'], ['.'], ['..'], ['%2E']])('answers 422 for the dot repoId %s sent raw, before any GitHub call', async (repoId) => {
    const { app, github } = recordingApp(() => jsonResponse({ tree: [] }))

    expect(await rawGet(app, `/api/github/repo/${repoId}/file`)).toEqual({ status: 422, code: 'validation_error' })
    expect(await rawGet(app, `/api/github/repo/${repoId}/file/${greetId}`)).toEqual({ status: 422, code: 'validation_error' })
    expect(github.callList).toEqual([])
  })

  it.each([
    ['rate-limited', 429, 'rate_limited'],
    ['broken', 502, 'upstream_error'],
    ['slow', 504, 'upstream_timeout']
  ])('the fake repository %s gives %i %s', async (repo, status, code) => {
    const { app } = await connectedApp()

    const response = await request(app).get(`/api/github/repo/${repo}/file`)

    expectError(response, status, code)
    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
  })

  it('answers 409 without a connection', async () => {
    const { app } = fakeApp()

    const response = await request(app).get('/api/github/repo/demo/file')

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/github/repo/{repoId}/file', 'GET')
  })
})

describe('GET /api/github/repo/:repoId/file/:fileId', () => {
  it('returns a listed file with its text, at the default branch', async () => {
    const { app } = await connectedApp()
    const listed = (await request(app).get('/api/github/repo/demo/file')).body.items[0]

    const response = await request(app).get(`/api/github/repo/demo/file/${listed.id}`)

    expectContract(response, '/api/github/repo/{repoId}/file/{fileId}', 'GET')
    expect(response.body).toEqual({ id: greetId, path: 'src/greet.ts', language: 'TypeScript', content: expect.stringContaining('export function greet') })
    expect(response.text).not.toMatch(/169\.254|download_url/)
  })

  it('calls only the contents API without a ref, with each segment encoded', async () => {
    const { app, github } = recordingApp(() => fileResponse('let a = 1\n'))

    await request(app).get(`/api/github/repo/demo/file/${idOf('dir/a b#?.ts')}`)

    expect(github.callList.map((call) => call.url)).toEqual([`${API}/repos/${fakeUser}/demo/contents/dir/a%20b%23%3F.ts`])
    expectOnlyGithubApi(github.callList)
  })

  it('answers 413 fileChar for a file over the limit by its declared size', async () => {
    const { app } = await connectedApp()

    const response = await request(app).get(`/api/github/repo/demo/file/${encodeFileId('src/huge.ts')}`)

    expectError(response, 413, 'payload_too_large')
    expectContract(response, '/api/github/repo/{repoId}/file/{fileId}', 'GET')
    expect(response.body.error.details).toEqual({ limit: 'fileChar', max: LIMIT.github.fileChar, path: 'src/huge.ts' })
  })

  it('answers 413 fileChar for a file whose size lies, by the text actually received', async () => {
    const { app } = recordingApp(() => fileResponse('x'.repeat(LIMIT.github.fileChar + 1), { size: 10 }))

    const response = await request(app).get(`/api/github/repo/demo/file/${idOf('a.ts')}`)

    expectError(response, 413, 'payload_too_large')
    expect(response.body.error.details).toMatchObject({ limit: 'fileChar', max: LIMIT.github.fileChar })
  })

  it.each([
    ['a .. segment', idOf('src/../secret.ts')],
    ['a backslash', idOf('src\\a.ts')],
    ['a NUL', idOf('a\u0000.ts')],
    ['an empty segment', idOf('src//a.ts')],
    ['invalid UTF-8', Buffer.from([0xff, 0x2e, 0x74, 0x73]).toString('base64url')],
    ['a character outside base64url', 'a.b'],
    ['a non-canonical id', 'YS50cx'],
    ['an unsupported extension', idOf('README.md')]
  ])('answers 422 for a file id with %s, before any GitHub call', async (_label, fileId) => {
    const { app, github } = recordingApp(() => fileResponse('x'))

    const response = await request(app).get(`/api/github/repo/demo/file/${fileId}`)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/github/repo/{repoId}/file/{fileId}', 'GET')
    expect(github.callList).toEqual([])
  })

  it.each([
    ['binary', () => fileResponse(new Uint8Array([0x00, 0x01, 0x02]))],
    ['empty', () => fileResponse('')],
    ['a folder', () => jsonResponse([])],
    ['a symlink', () => jsonResponse({ type: 'symlink', size: 1 })]
  ])('answers 422 for a file that is %s', async (_label, answer) => {
    const { app } = recordingApp(answer)

    expectError(await request(app).get(`/api/github/repo/demo/file/${idOf('a.ts')}`), 422, 'validation_error')
  })

  it('answers 404 for a file that is not in the repository', async () => {
    const { app } = await connectedApp()

    const response = await request(app).get(`/api/github/repo/demo/file/${idOf('src/missing.ts')}`)

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/github/repo/{repoId}/file/{fileId}', 'GET')
  })

  it.each([301, 302, 307])('refuses a %i redirect to the metadata address, and does not follow it', async (status) => {
    const { app, github } = recordingApp(() => new Response(null, { status, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))

    const response = await request(app).get(`/api/github/repo/demo/file/${idOf('a.ts')}`)

    expectError(response, 502, 'upstream_error')
    expect(github.callList).toHaveLength(1)
    expectOnlyGithubApi(github.callList)
  })

  it('answers 502 for a GitHub 5xx and 504 for a stalled call', async () => {
    const broken = recordingApp(() => new Response('oops', { status: 503 }))
    const stalled = recordingApp(() => stall())

    expectError(await request(broken.app).get(`/api/github/repo/demo/file/${idOf('a.ts')}`), 502, 'upstream_error')
    const timeout = await request(stalled.app).get(`/api/github/repo/demo/file/${idOf('a.ts')}`)
    expectError(timeout, 504, 'upstream_timeout')
    expectContract(timeout, '/api/github/repo/{repoId}/file/{fileId}', 'GET')
  })

  it('answers 409 without a connection', async () => {
    const { app } = fakeApp()

    const response = await request(app).get(`/api/github/repo/demo/file/${greetId}`)

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/github/repo/{repoId}/file/{fileId}', 'GET')
  })
})

describe('GitHub wizard routes without a session', () => {
  it.each([
    ['POST', '/api/github/connect'],
    ['POST', '/api/github/disconnect'],
    ['GET', '/api/github/repo'],
    ['GET', '/api/github/repo/demo/file'],
    ['GET', `/api/github/repo/demo/file/${greetId}`]
  ])('%s %s answers 401 and makes no GitHub call', async (method, url) => {
    const github = fakeGithub(() => jsonResponse({}))
    const { rawApp } = buildApp({ githubClient: github.client() })

    const call = method === 'GET' ? request(rawApp).get(url) : request(rawApp).post(url).set('X-CSRF-Protection', '1').send({ username: fakeUser })
    const response = await call

    expectError(response, 401, 'unauthorized')
    expect(github.callList).toEqual([])
  })
})
