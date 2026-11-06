import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../src/lib/error.js'
import { parseGithubUrl } from '../src/lib/github-url.js'
import { LIMIT } from '../src/utils/limits.js'
import { buildApp } from './helper/app.js'
import { API, budget, expectOnlyGithubApi, fakeGithub, fileResponse, jsonResponse, notFound, type FakeHandler } from './helper/github.js'

// QA adversarial pass for plan 023 (AI-46). No network: every GitHub answer is a fake.

const sha = '0123456789abcdef0123456789abcdef01234567'

function appWith(handler: FakeHandler) {
  const github = fakeGithub(handler)
  const { app } = buildApp({ githubClient: github.client() })
  return { app, callList: github.callList }
}

function post(app: ReturnType<typeof buildApp>['app'], body: unknown) {
  return request(app).post('/api/github/import').send(body as object)
}

function refused(input: string): AppError {
  try {
    parseGithubUrl(input)
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error(`Accepted ${JSON.stringify(input)}`)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QA: hostile hosts and authority tricks', () => {
  it.each([
    ['Cyrillic i look-alike host', 'https://gіthub.com/octo/repo/blob/main/a.ts'],
    ['fullwidth look-alike host', 'https://ｇｉｔｈｕｂ.com/octo/repo/blob/main/a.ts'],
    ['punycode host', 'https://xn--gthub-n4a.com/octo/repo/blob/main/a.ts'],
    ['trailing-dot host', 'https://github.com./octo/repo/blob/main/a.ts'],
    ['userinfo with password', 'https://a:b@github.com/octo/repo/blob/main/a.ts'],
    ['@ right after the host', 'https://github.com/@evil.com/repo/blob/main/a.ts'],
    ['encoded @ in owner', 'https://github.com/octo%40evil.com/repo/blob/main/a.ts'],
    ['backslash authority', 'https:\\\\github.com\\octo/repo/blob/main/a.ts'],
    ['single slash scheme', 'https:/github.com/octo/repo/blob/main/a.ts'],
    ['port 80', 'https://github.com:80/octo/repo/blob/main/a.ts'],
    ['empty port', 'https://github.com:/octo/repo/blob/main/a.ts'],
    ['encoded slash after host', 'https://github.com%2f@evil.com/octo/repo/blob/main/a.ts'],
    ['IPv4 host', 'https://140.82.112.3/octo/repo/blob/main/a.ts'],
    ['tab inside', 'https://github.com/octo/re\tpo/blob/main/a.ts'],
    ['no-break space inside', 'https://github.com/octo/repo/blob/main/a b.ts'],
    ['encoded .. in repo', 'https://github.com/octo/%2e%2e/blob/main/a.ts'],
    ['encoded . segment', 'https://github.com/octo/repo/blob/main/src/%2e/a.ts'],
    ['mixed-case encoded ..', 'https://github.com/octo/repo/blob/main/%2E%2e/a.ts'],
    ['half-encoded ..', 'https://github.com/octo/repo/blob/main/.%2e/a.ts'],
    ['encoded backslash in ref', 'https://github.com/octo/repo/blob/ma%5cin/a.ts'],
    ['encoded .. in ref', 'https://github.com/octo/repo/blob/%2e%2e/a.ts'],
    ['encoded NUL in owner', 'https://github.com/oc%00to/repo/blob/main/a.ts']
  ])('refuses %s with 422', (_label, input) => {
    const error = refused(input)
    expect(error.status).toBe(422)
    expect(error.code).toBe('validation_error')
  })

  it('accepts a mixed-case scheme and host', () => {
    expect(parseGithubUrl('hTTps://GitHub.Com/octo/repo/blob/main/a.ts')).toMatchObject({ owner: 'octo', ref: 'main' })
  })

  it('refuses a 2 001-character link at the schema and makes no call', async () => {
    const { app, callList } = appWith(() => fileResponse('x\n'))
    const base = 'https://github.com/octo/repo/blob/main/a.ts#'
    const response = await post(app, { url: `${base}${'L'.repeat(2001 - base.length)}` })
    expect(response.status).toBe(422)
    expect(callList).toHaveLength(0)
  })

  it('keeps a double-encoded slash literal (%252f is the file name "%2f"), and it stays one API path segment', async () => {
    const { app, callList } = appWith(() => fileResponse('x\n'))
    await post(app, { url: 'https://github.com/octo/repo/blob/main/a%252f..%252fb.ts' })
    expect(callList).toHaveLength(1)
    expect(callList[0]!.url).toBe(`${API}/repos/octo/repo/contents/a%252f..%252fb.ts?ref=main`)
    expectOnlyGithubApi(callList)
  })
})

describe('QA: malformed Unicode in the link', () => {
  // QA defect D1, fixed in AI-46.
  it('answers a raw lone surrogate in the path with 422, not 500', async () => {
    const { app, callList } = appWith(() => fileResponse('x\n'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a\uD800.ts' })

    // QA defect D1: observed 400 bad_request (URIError from encodeURIComponent in github-fetch.ts).
    expect({ status: response.status, code: response.body.error?.code, field: response.body.error?.details?.issue?.[0]?.field })
      .toEqual({ status: 422, code: 'validation_error', field: 'url' })
    expect(callList).toHaveLength(0)
    expect(error).not.toHaveBeenCalled()
  })

  // QA defect D2, fixed in AI-46.
  it('answers a PR file name with a lone surrogate (from GitHub) without a 400', async () => {
    const { app } = appWith((url) => {
      if (url.pathname === '/repos/octo/repo/pulls/7') return jsonResponse({ changed_files: 2, head: { sha } })
      if (url.pathname === '/repos/octo/repo/pulls/7/files') {
        return new Response('[{"filename":"src/a\\ud800.ts","status":"added","changes":1},{"filename":"b.ts","status":"added","changes":1}]',
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname === '/repos/octo/repo/contents/b.ts') return fileResponse('const b = 1\n')
      return notFound()
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post(app, { url: 'https://github.com/octo/repo/pull/7' })

    // A hostile file name from GitHub should be skipped (invalid_path), the other file kept.
    expect({ status: response.status, body: response.body.error ?? response.body.skippedList })
      .toEqual({ status: 200, body: [{ path: 'src/a\ud800.ts', reason: 'invalid_path' }] })
  })
})

describe('QA: single-file limit with multi-byte content', () => {
  const max = LIMIT.github.fileChar

  it.each([
    ['3-byte chars at the limit (150 000 bytes)', '€'.repeat(max), 200],
    ['3-byte chars one under', '€'.repeat(max - 1), 200],
    ['3-byte chars one over', '€'.repeat(max + 1), 413],
    ['4-byte emoji at the limit (25 000 x 2 units)', '😀'.repeat(max / 2), 200],
    ['4-byte emoji one over (25 001 x 2 units)', '😀'.repeat(max / 2 + 1), 413]
  ])('%s', async (_label, text, status) => {
    const { app } = appWith(() => fileResponse(text))
    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })
    expect(response.status).toBe(status)
    if (status === 413) expect(response.body.error.details).toMatchObject({ limit: 'fileChar', max })
    else expect(response.body.content).toBe(text)
  })

  it('refuses a GitHub answer for a >1 MB file (encoding none, size 2 MB) with 413, not 502', async () => {
    const { app } = appWith(() => jsonResponse({ type: 'file', size: 2_000_000, encoding: 'none', content: '' }))
    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })
    expect(response.status).toBe(413)
  })
})

describe('QA: total limit with multi-byte content in a PR', () => {
  it('counts UTF-16 units across files; one over the total is 413 totalChar', async () => {
    // Two files of 49 990 units each (emoji) plus headers: just under; a third tiny file pushes it over.
    const body = '😀'.repeat(24_980)
    const list = [
      { filename: 'a.ts', status: 'added', changes: 1 },
      { filename: 'b.ts', status: 'added', changes: 1 },
      { filename: 'c.ts', status: 'added', changes: 1 }
    ]
    const { app, callList } = appWith((url) => {
      if (url.pathname === '/repos/octo/repo/pulls/7') return jsonResponse({ changed_files: 3, head: { sha } })
      if (url.pathname === '/repos/octo/repo/pulls/7/files') return jsonResponse(list)
      if (url.pathname === '/repos/octo/repo/contents/c.ts') return fileResponse('x'.repeat(100))
      if (url.pathname.startsWith('/repos/octo/repo/contents/')) return fileResponse(body)
      return notFound()
    })
    const response = await post(app, { url: 'https://github.com/octo/repo/pull/7' })
    expect(response.status).toBe(413)
    expect(response.body.error.details).toMatchObject({ limit: 'totalChar', max: LIMIT.github.totalChar, path: 'c.ts' })
    expect(callList).toHaveLength(5)
  })
})

describe('QA: SSRF and upstream answers', () => {
  it.each([303, 308])('refuses a %d redirect to the metadata address and makes one call only', async (status) => {
    const { app, callList } = appWith(() => new Response(null, { status, headers: { location: 'http://169.254.169.254/' } }))
    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })
    expect(response.status).toBe(502)
    expect(JSON.stringify(response.body)).not.toContain('169.254')
    expect(callList).toHaveLength(1)
  })

  it('refuses an HTML answer (wrong Content-Type) with 502', async () => {
    const { app } = appWith(() => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })
    expect(response.status).toBe(502)
    expect(JSON.stringify(response.body)).not.toContain('login')
  })

  // QA defect D4, fixed in AI-46: GitHub's secondary rate limit is a 403 with retry-after.
  it('maps a 403 secondary rate limit (retry-after, remaining not 0) to 429 rate_limited', async () => {
    const { app } = appWith(() => jsonResponse({ message: 'secondary rate limit' }, 403, { 'retry-after': '60' }))
    const before = Date.now()
    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })
    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('rate_limited')
    const resetAt = Date.parse(response.body.error.details.resetAt)
    expect(resetAt).toBeGreaterThanOrEqual(before + 60_000 - 1000)
    expect(resetAt).toBeLessThanOrEqual(Date.now() + 60_000 + 1000)
  })

  it('does not put the typed link, the GitHub body or headers into a 404, 429 or 502 body or log', async () => {
    const secretQuery = 'token=ghp_SECRET123'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    for (const answer of [
      () => jsonResponse({ message: 'UPSTREAM-BODY' }, 404, { 'x-upstream': 'UPSTREAM-HEADER' }),
      () => jsonResponse({ message: 'UPSTREAM-BODY' }, 503, { 'x-upstream': 'UPSTREAM-HEADER' }),
      () => jsonResponse({ message: 'UPSTREAM-BODY' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' })
    ]) {
      const { app } = appWith(answer)
      const response = await post(app, { url: `https://github.com/octo/secret-repo/blob/main/a.ts?${secretQuery}` })
      const text = JSON.stringify(response.body)
      for (const needle of ['ghp_SECRET123', 'secret-repo', 'UPSTREAM-BODY', 'UPSTREAM-HEADER']) expect(text).not.toContain(needle)
    }
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls, ...log.mock.calls])
    for (const needle of ['ghp_SECRET123', 'secret-repo', 'UPSTREAM-BODY', 'UPSTREAM-HEADER']) expect(logged).not.toContain(needle)
  })
})

describe('QA: request body', () => {
  it.each([
    ['a number url', { url: 42 }],
    ['an array url', { url: ['https://github.com/octo/repo/pull/1'] }],
    ['an empty url', { url: '' }],
    ['no url', {}],
    ['an extra field', { url: 'https://github.com/octo/repo/pull/1', ref: 'x' }]
  ])('refuses %s with 422', async (_label, body) => {
    const { app, callList } = appWith(() => notFound())
    const response = await post(app, body)
    expect(response.status).toBe(422)
    expect(callList).toHaveLength(0)
  })

  it('refuses a __proto__ field (strict body) with 422', async () => {
    const { app, callList } = appWith(() => notFound())
    const response = await request(app).post('/api/github/import').set('content-type', 'application/json')
      .send('{"url":"https://github.com/octo/repo/pull/1","__proto__":{"polluted":true}}')
    expect(response.status).toBe(422)
    expect(callList).toHaveLength(0)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('handles 10 rapid parallel imports independently', async () => {
    const { app, callList } = appWith(() => fileResponse('const a = 1\n'))
    const responseList = await Promise.all(Array.from({ length: 10 }, () => post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })))
    expect(responseList.every((response) => response.status === 200)).toBe(true)
    expect(callList).toHaveLength(10)
  })
})

describe('QA: per-call timeout and deadline accounting', () => {
  it('a stalled body read after the overall deadline answers 504 totalTimeout', async () => {
    const github = fakeGithub(() => new Response(new ReadableStream({ start() { /* never enqueues */ } }),
      { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = github.client({ callTimeoutMs: 1_000 })
    const result = await client.getFile('octo', 'repo', ['a.ts'], 'main', budget(50)).catch((error: AppError) => error)
    expect(result).toBeInstanceOf(AppError)
    expect((result as AppError).status).toBe(504)
    expect((result as AppError).details).toMatchObject({ limit: 'totalTimeout' })
  })
})
