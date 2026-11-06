import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/error.js'
import { LIMIT } from '../src/utils/limits.js'
import { API, budget, expectOnlyGithubApi, fakeGithub, fileResponse, jsonResponse, notFound, stall, textOf } from './helper/github.js'

// The GitHub client against a fake `fetch` (plan 023, Validation: SSRF, limits, timeouts).
// No test here uses the network.

const sha = '0123456789abcdef0123456789abcdef01234567'

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('The call did not fail.')
}

describe('github client: the request it builds', () => {
  it('calls only the contents API at the constant host, without credentials or redirects', async () => {
    const github = fakeGithub(() => fileResponse('const a = 1\n'))

    const result = await github.client().getFile('octo', 'repo', ['src', 'a.ts'], 'main', budget())

    expect(result).toEqual({ kind: 'text', text: 'const a = 1\n' })
    expect(github.callList.map((call) => call.url)).toEqual([`${API}/repos/octo/repo/contents/src/a.ts?ref=main`])
    expectOnlyGithubApi(github.callList)
    expect(new Headers(github.callList[0]?.init.headers).get('accept')).toBe('application/vnd.github+json')
  })

  it('percent-encodes every part, so a part can never change the host or the path shape', async () => {
    const github = fakeGithub(() => fileResponse('x\n'))

    await github.client().getFile('octo', 'repo', ['my file?.ts'], 'v1#2', budget())

    expect(github.callList[0]?.url).toBe(`${API}/repos/octo/repo/contents/my%20file%3F.ts?ref=v1%232`)
  })

  it('builds the PR and PR file list URLs', async () => {
    const github = fakeGithub((url) => url.pathname.endsWith('/files')
      ? jsonResponse([{ filename: 'a.ts', status: 'added', changes: 1 }])
      : jsonResponse({ changed_files: 1, head: { sha } }))

    expect(await github.client().getPull('octo', 'repo', 7, budget())).toEqual({ headSha: sha, changedFileCount: 1 })
    expect(await github.client().listPullFile('octo', 'repo', 7, budget())).toEqual([{ path: 'a.ts', status: 'added', changeCount: 1 }])
    expect(github.callList.map((call) => call.url)).toEqual([`${API}/repos/octo/repo/pulls/7`, `${API}/repos/octo/repo/pulls/7/files?per_page=100`])
    expectOnlyGithubApi(github.callList)
  })
})

describe('github client: SSRF', () => {
  it.each([
    [301, 'http://169.254.169.254/latest/meta-data/'],
    [302, 'http://localhost:3001/api/test/reset'],
    [307, 'https://evil.example.com/a.ts'],
    [308, 'https://api.github.com/repos/other/repo/contents/a.ts']
  ])('refuses a %d redirect to %s and does not follow it', async (status, location) => {
    const github = fakeGithub(() => new Response(null, { status, headers: { location } }))

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(502)
    expect(error.code).toBe('upstream_error')
    expect(error.message).not.toContain(location)
    expect(github.callList).toHaveLength(1)
    expectOnlyGithubApi(github.callList)
  })

  it('never fetches a URL named in a response field', async () => {
    const github = fakeGithub(() => fileResponse('x\n', {
      extra: {
        download_url: 'http://169.254.169.254/latest/meta-data/',
        html_url: 'http://localhost/',
        git_url: 'https://evil.example.com/',
        _links: { self: 'http://127.0.0.1/' }
      }
    }))

    await github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget())

    expect(github.callList).toHaveLength(1)
    expectOnlyGithubApi(github.callList)
  })

  it('never fetches the head repository of a fork PR (its clone_url)', async () => {
    const github = fakeGithub(() => jsonResponse({
      changed_files: 1,
      head: { sha, repo: { clone_url: 'http://10.0.0.1/fork.git', full_name: 'evil/fork' } }
    }))

    expect(await github.client().getPull('octo', 'repo', 1, budget())).toEqual({ headSha: sha, changedFileCount: 1 })
    expect(github.callList).toHaveLength(1)
  })
})

describe('github client: GitHub answers', () => {
  it('maps 404 (missing or private) to not_found without saying which', async () => {
    const error = await failure(fakeGithub(notFound).client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(404)
    expect(error.code).toBe('not_found')
    expect(error.message).toMatch(/not found, or it is private/)
  })

  it.each([500, 502, 503])('maps %d to upstream_error with none of GitHub\'s text', async (status) => {
    const github = fakeGithub(() => new Response('UPSTREAM-SECRET-TEXT', { status, headers: { 'x-upstream-secret': 'HEADER-SECRET' } }))

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(502)
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toMatch(/SECRET/)
  })

  it('maps a 403 with the rate limit used up to rate_limited with the reset time', async () => {
    const github = fakeGithub(() => jsonResponse({ message: 'API rate limit exceeded' }, 403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1798761600'
    }))

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(429)
    expect(error.code).toBe('rate_limited')
    expect(error.details).toEqual({ resetAt: '2027-01-01T00:00:00.000Z' })
  })

  it('maps a 429 with retry-after to rate_limited, reset counted from now', async () => {
    const github = fakeGithub(() => jsonResponse({}, 429, { 'retry-after': '60' }))
    const now = Date.parse('2026-10-25T10:00:00.000Z')

    const error = await failure(github.client({ now: () => now }).getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(429)
    expect(error.details).toEqual({ resetAt: '2026-10-25T10:01:00.000Z' })
  })

  it('maps a 403 secondary rate limit (retry-after) to rate_limited, retry-after winning (QA AI-46 D4)', async () => {
    const github = fakeGithub(() => jsonResponse({ message: 'secondary rate limit' }, 403, {
      'retry-after': '30',
      'x-ratelimit-remaining': '17',
      'x-ratelimit-reset': '1798761600'
    }))
    const now = Date.parse('2026-10-25T10:00:00.000Z')

    const error = await failure(github.client({ now: () => now }).getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(429)
    expect(error.code).toBe('rate_limited')
    expect(error.details).toEqual({ resetAt: '2026-10-25T10:00:30.000Z' })
  })

  it('gives rate_limited without details when GitHub names no reset time', async () => {
    const error = await failure(fakeGithub(() => jsonResponse({}, 429, { 'x-ratelimit-reset': 'soon' })).client()
      .getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(429)
    expect(error.details).toBeUndefined()
  })

  it('maps another 403 to upstream_error', async () => {
    const error = await failure(fakeGithub(() => jsonResponse({}, 403, { 'x-ratelimit-remaining': '42' })).client()
      .getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(502)
  })

  it.each([
    ['an HTML page', () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })],
    ['no content type', () => new Response('{}', { headers: {} })],
    ['malformed JSON', () => new Response('{"type":', { headers: { 'content-type': 'application/json' } })],
    ['an unexpected shape', () => jsonResponse({ type: 'file', size: 'big' })],
    ['an unknown entry type', () => jsonResponse({ type: 'weird', size: 1, encoding: 'base64', content: 'eA==' })],
    ['a non-base64 content', () => jsonResponse({ type: 'file', size: 1, encoding: 'base64', content: '<script>' })],
    ['another encoding', () => jsonResponse({ type: 'file', size: 1, encoding: 'utf-8', content: 'x' })],
    ['a 204', () => new Response(null, { status: 204 })]
  ])('maps %s to upstream_error', async (_label, answer) => {
    const error = await failure(fakeGithub(answer).client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(502)
    expect(error.code).toBe('upstream_error')
  })

  it('maps a PR answer with a malformed head SHA to upstream_error', async () => {
    const error = await failure(fakeGithub(() => jsonResponse({ changed_files: 1, head: { sha: '../../x' } })).client()
      .getPull('octo', 'repo', 1, budget()))

    expect(error.status).toBe(502)
  })

  it('maps a network failure to upstream_error without its message', async () => {
    const github = fakeGithub(() => Promise.reject(new TypeError('getaddrinfo ENOTFOUND internal.corp')))

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(502)
    expect(error.message).not.toContain('internal.corp')
  })
})

describe('github client: entries that are not a text file', () => {
  it.each([
    ['a folder', () => jsonResponse([{ type: 'file', name: 'a.ts' }]), 'folder'],
    ['a symlink', () => jsonResponse({ type: 'symlink', size: 5, target: '/etc/passwd' }), 'symlink'],
    ['a submodule', () => jsonResponse({ type: 'submodule', size: 0, submodule_git_url: 'http://10.0.0.1/x.git' }), 'submodule'],
    ['a NUL byte', () => fileResponse(new Uint8Array([0x61, 0x00, 0x62])), 'binary'],
    ['invalid UTF-8', () => fileResponse(new Uint8Array([0xff, 0xfe, 0x41])), 'binary']
  ])('skips %s', async (_label, answer, reason) => {
    const github = fakeGithub(answer)

    expect(await github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget())).toEqual({ kind: 'skip', reason })
    expect(github.callList).toHaveLength(1)
  })

  it('returns multi-byte UTF-8 text unchanged', async () => {
    const text = 'const greeting = "héllo 👋"\n'
    expect(await fakeGithub(() => fileResponse(text)).client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))
      .toEqual({ kind: 'text', text })
  })
})

describe('github client: the single-file limit (50 000 characters)', () => {
  const max = LIMIT.github.fileChar

  it.each([max - 1, max])('accepts %d characters', async (length) => {
    const result = await fakeGithub(() => fileResponse(textOf(length))).client().getFile('octo', 'repo', ['a.ts'], 'main', budget())

    expect(result.kind === 'text' && result.text.length).toBe(length)
  })

  it('refuses one character more with 413 fileChar', async () => {
    const error = await failure(fakeGithub(() => fileResponse(textOf(max + 1))).client().getFile('octo', 'repo', ['src', 'a.ts'], 'main', budget()))

    expect(error.status).toBe(413)
    expect(error.code).toBe('payload_too_large')
    expect(error.details).toEqual({ limit: 'fileChar', max, path: 'src/a.ts' })
  })

  it('counts UTF-16 units: 50 000 two-unit emoji are 100 000 characters', async () => {
    const error = await failure(fakeGithub(() => fileResponse('👋'.repeat(max / 2 + 1))).client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(413)
  })

  it.each([
    [LIMIT.github.fileByte, false],
    [LIMIT.github.fileByte + 1, true]
  ])('declared size %d bytes: refused before decoding = %s', async (size, refused) => {
    const github = fakeGithub(() => fileResponse('x\n', { size }))

    const promise = github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget())

    if (refused) expect((await failure(promise)).details).toMatchObject({ limit: 'fileChar' })
    else expect(await promise).toEqual({ kind: 'text', text: 'x\n' })
  })

  it('refuses a body declared over the cap by Content-Length without reading it', async () => {
    let pulled = false
    const body = new ReadableStream<Uint8Array>({ pull: () => { pulled = true } }, { highWaterMark: 0 })
    const github = fakeGithub(() => new Response(body, {
      headers: { 'content-type': 'application/json', 'content-length': String(LIMIT.github.fileResponseByte + 1) }
    }))

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(413)
    expect(pulled).toBe(false)
  })

  it('refuses a file whose size field lies, by the bytes actually received', async () => {
    const error = await failure(fakeGithub(() => fileResponse(textOf(max + 1), { size: 10 })).client()
      .getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(413)
    expect(error.details).toMatchObject({ limit: 'fileChar' })
  })

  it('stops reading a streamed body at the byte cap, whatever it declares', async () => {
    let sent = 0
    const chunk = new Uint8Array(64 * 1024).fill(0x61)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength
        controller.enqueue(chunk)
      }
    })
    const github = fakeGithub(() => new Response(body, { headers: { 'content-type': 'application/json', 'content-length': '10' } }))

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(413)
    expect(sent).toBeLessThan(LIMIT.github.fileResponseByte + 3 * chunk.byteLength)
  })
})

describe('github client: timeouts', () => {
  it('ends a call that never answers at the per-call timeout (504 callTimeout)', async () => {
    const github = fakeGithub(stall)

    const error = await failure(github.client({ callTimeoutMs: 20 }).getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.status).toBe(504)
    expect(error.code).toBe('upstream_timeout')
    expect(error.details).toEqual({ limit: 'callTimeout', maxMs: 20 })
  })

  it('ends a body that stalls after the headers at the per-call timeout', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":')) } })
    const github = fakeGithub(() => new Response(body, { headers: { 'content-type': 'application/json' } }))

    const error = await failure(github.client({ callTimeoutMs: 20 }).getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(error.details).toEqual({ limit: 'callTimeout', maxMs: 20 })
  })

  it('passes the abort signal to fetch, so a real request is cancelled', async () => {
    let signal: AbortSignal | undefined
    const github = fakeGithub((_url, init) => {
      signal = init.signal ?? undefined
      return stall()
    })

    await failure(github.client({ callTimeoutMs: 20 }).getFile('octo', 'repo', ['a.ts'], 'main', budget()))

    expect(signal?.aborted).toBe(true)
  })

  it('reports the overall deadline when it ends first (504 totalTimeout)', async () => {
    const error = await failure(fakeGithub(stall).client({ callTimeoutMs: 5000 }).getFile('octo', 'repo', ['a.ts'], 'main', budget(20)))

    expect(error.details).toEqual({ limit: 'totalTimeout', maxMs: 20 })
  })

  it('makes no call once the overall deadline has passed', async () => {
    const github = fakeGithub(() => fileResponse('x\n'))
    const expired = { signal: AbortSignal.abort(), totalTimeoutMs: 1 }

    const error = await failure(github.client().getFile('octo', 'repo', ['a.ts'], 'main', expired))

    expect(error.status).toBe(504)
    expect(github.callList).toHaveLength(0)
  })
})

// Plan 030: the wizard's user, repository list and tree calls on the same client.
describe('github client: the wizard calls', () => {
  it('builds the user, repository list and tree URLs at the constant host, with every part encoded', async () => {
    const github = fakeGithub((url) => {
      if (url.pathname.endsWith('/repos')) return jsonResponse([])
      if (url.pathname.includes('/git/trees/')) return jsonResponse({ tree: [] })
      return jsonResponse({ login: 'octo', name: 'Octo' })
    })
    const client = github.client()

    expect(await client.getUser('octo', budget())).toEqual({ login: 'octo', name: 'Octo' })
    expect(await client.listUserRepo('octo', budget())).toEqual({ repoList: [], hasMore: false })
    expect(await client.getTree('octo', 'a b', budget())).toEqual({ entryList: [], truncated: false })
    expect(github.callList.map((call) => call.url)).toEqual([
      `${API}/users/octo`,
      `${API}/users/octo/repos?type=owner&sort=updated&direction=desc&per_page=100`,
      `${API}/repos/octo/a%20b/git/trees/HEAD?recursive=1`
    ])
    expectOnlyGithubApi(github.callList)
  })

  it('reads a file at the default branch when no ref is given', async () => {
    const github = fakeGithub(() => fileResponse('x\n'))

    await github.client().getFile('octo', 'repo', ['a.ts'], undefined, budget())

    expect(github.callList[0]?.url).toBe(`${API}/repos/octo/repo/contents/a.ts`)
  })

  it('sends no Authorization header today, and the given value once OAuth passes one', async () => {
    const github = fakeGithub(() => jsonResponse({ login: 'octo' }))

    await github.client().getUser('octo', budget())
    await github.client({ authorization: 'Bearer test-only' }).getUser('octo', budget())

    expect(new Headers(github.callList[0]?.init.headers).has('authorization')).toBe(false)
    expect(new Headers(github.callList[1]?.init.headers).get('authorization')).toBe('Bearer test-only')
  })

  it('keeps only the contract fields and never fetches a URL from the answer', async () => {
    const hostile = { avatar_url: 'http://169.254.169.254/', html_url: 'http://localhost/', url: 'https://evil.example.com/' }
    const github = fakeGithub((url) => url.pathname.endsWith('/repos')
      ? jsonResponse([{ name: 'r', description: 'd', clone_url: 'http://127.0.0.1/', ...hostile }])
      : jsonResponse({ login: 'octo', name: null, ...hostile }))

    expect(await github.client().getUser('octo', budget())).toEqual({ login: 'octo', name: null })
    expect(await github.client().listUserRepo('octo', budget())).toEqual({ repoList: [{ name: 'r', description: 'd' }], hasMore: false })
    expect(github.callList).toHaveLength(2)
    expectOnlyGithubApi(github.callList)
  })

  it.each([
    ['<https://api.github.com/user/1/repos?page=2>; rel="next", <https://api.github.com/user/1/repos?page=4>; rel="last"', true],
    ['<https://api.github.com/user/1/repos?page=1>; rel="prev"', false]
  ])('reads more pages from the Link header %s', async (link, hasMore) => {
    const github = fakeGithub(() => jsonResponse([{ name: 'r' }], 200, { link }))

    expect((await github.client().listUserRepo('octo', budget())).hasMore).toBe(hasMore)
    expect(github.callList).toHaveLength(1)
  })

  it.each([
    ['a login that breaks the pattern', { login: 'a--b' }],
    ['no login', { name: 'x' }],
    ['a login that is not text', { login: 7 }]
  ])('answers 502 for a user with %s', async (_label, body) => {
    const github = fakeGithub(() => jsonResponse(body))

    expect((await failure(github.client().getUser('octo', budget()))).code).toBe('upstream_error')
  })

  it('answers 404 not_found with the user message for an unknown user', async () => {
    const github = fakeGithub(() => notFound())

    const error = await failure(github.client().getUser('octo', budget()))

    expect(error.status).toBe(404)
    expect(error.message).toBe('GitHub has no user with this name.')
  })

  it('reads a GitHub 409 tree (an empty repository) as an empty tree, and any other 4xx as an error', async () => {
    const empty = fakeGithub(() => jsonResponse({ message: 'Git Repository is empty.' }, 409))
    const gone = fakeGithub(() => jsonResponse({}, 410))

    expect(await empty.client().getTree('octo', 'repo', budget())).toEqual({ entryList: [], truncated: false })
    expect((await failure(gone.client().getTree('octo', 'repo', budget()))).code).toBe('upstream_error')
  })

  it.each([
    ['the user', LIMIT.github.userResponseByte, (client: ReturnType<ReturnType<typeof fakeGithub>['client']>) => client.getUser('octo', budget())],
    ['the repository list', LIMIT.github.repoListResponseByte, (client: ReturnType<ReturnType<typeof fakeGithub>['client']>) => client.listUserRepo('octo', budget())],
    ['the tree', LIMIT.github.treeResponseByte, (client: ReturnType<ReturnType<typeof fakeGithub>['client']>) => client.getTree('octo', 'repo', budget())]
  ])('answers 502 for %s over its declared byte cap, without reading the body', async (_label, max, call) => {
    let pulled = 0
    const body = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(10)) } })
    const github = fakeGithub(() => new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(max + 1) } }))

    expect((await failure(call(github.client()))).code).toBe('upstream_error')
    expect(pulled).toBeLessThanOrEqual(1)
  })

  it('stops reading a tree whose streamed bytes pass the cap, whatever Content-Length said', async () => {
    const chunk = new Uint8Array(1_000_000).fill(0x20)
    let sent = 0
    const body = new ReadableStream({ pull(controller) { sent += chunk.byteLength; controller.enqueue(chunk) } })
    const github = fakeGithub(() => new Response(body, { headers: { 'content-type': 'application/json' } }))

    expect((await failure(github.client().getTree('octo', 'repo', budget()))).code).toBe('upstream_error')
    expect(sent).toBeLessThan(LIMIT.github.treeResponseByte + 3 * chunk.byteLength)
  })

  it('times out a stalled repository list call with 504 callTimeout', async () => {
    const github = fakeGithub(() => stall())

    const error = await failure(github.client({ callTimeoutMs: 30 }).listUserRepo('octo', budget()))

    expect(error.status).toBe(504)
    expect(error.details).toEqual({ limit: 'callTimeout', maxMs: 30 })
  })

  it.each([301, 302, 307])('refuses a %d redirect of the user call to the metadata address', async (status) => {
    const github = fakeGithub(() => new Response(null, { status, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))

    expect((await failure(github.client().getUser('octo', budget()))).code).toBe('upstream_error')
    expect(github.callList).toHaveLength(1)
    expectOnlyGithubApi(github.callList)
  })
})
