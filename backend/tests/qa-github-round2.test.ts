import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppError } from '../src/lib/error.js'
import { buildApp } from './helper/app.js'
import { budget, expectOnlyGithubApi, fakeGithub, fileResponse, jsonResponse, notFound, type FakeHandler } from './helper/github.js'

// QA AI-46 round 2: fresh cases for the D1, D2 and D4 fixes, and regressions. No network.

const sha = '0123456789abcdef0123456789abcdef01234567'

function appWith(handler: FakeHandler) {
  const github = fakeGithub(handler)
  const { app } = buildApp({ githubClient: github.client() })
  return { app, callList: github.callList }
}

function post(app: ReturnType<typeof buildApp>['app'], body: unknown) {
  return request(app).post('/api/github/import').send(body as object)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QA round 2: D1 malformed Unicode in the typed link', () => {
  it.each([
    ['owner', 'https://github.com/oc\uD800to/repo/blob/main/a.ts'],
    ['repo', 'https://github.com/octo/re\uDC00po/pull/1'],
    ['ref', 'https://github.com/octo/repo/blob/ma\uD83Din/a.ts'],
    ['directory', 'https://github.com/octo/repo/blob/main/\uDFFF/a.ts'],
    ['two high surrogates', 'https://github.com/octo/repo/blob/main/\uD800\uD800.ts'],
    ['reversed pair', 'https://github.com/octo/repo/blob/main/\uDE00\uD83D.ts'],
    ['query', 'https://github.com/octo/repo/blob/main/a.ts?x=\uD800'],
    ['fragment', 'https://github.com/octo/repo/pull/1#\uDC00'],
    ['tail after the trim', 'https://github.com/octo/repo/pull/1\uD800 '],
    ['encoded surrogate', 'https://github.com/octo/repo/blob/main/a%ED%A0%80.ts']
  ])('a lone surrogate in the %s is 422 on url, with no call and no error log', async (_label, url) => {
    const { app, callList } = appWith(() => fileResponse('x\n'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await post(app, { url })
    expect({ status: response.status, code: response.body.error?.code, field: response.body.error?.details?.issue?.[0]?.field })
      .toEqual({ status: 422, code: 'validation_error', field: 'url' })
    expect(callList).toHaveLength(0)
    expect(error).not.toHaveBeenCalled()
  })

  it.each([
    ['an encoded emoji in the path', 'https://github.com/octo/repo/blob/main/%F0%9F%98%80.ts', '😀.ts'],
    ['a raw emoji in the path', 'https://github.com/octo/repo/blob/main/😀.ts', '😀.ts'],
    ['an emoji in the fragment', 'https://github.com/octo/repo/blob/main/a.ts#😀', 'a.ts']
  ])('still imports %s (no regression)', async (_label, url, name) => {
    const { app, callList } = appWith(() => fileResponse('x\n'))
    const response = await post(app, { url })
    expect(response.status).toBe(200)
    expect(response.body.name).toBe(name)
    expect(callList).toHaveLength(1)
    expectOnlyGithubApi(callList)
  })
})

describe('QA round 2: D2 malformed PR file names from GitHub', () => {
  function pullApp(rawList: string, contentByPath: Record<string, string>) {
    return appWith((url) => {
      if (url.pathname === '/repos/octo/repo/pulls/7') return jsonResponse({ changed_files: 5, head: { sha } })
      if (url.pathname === '/repos/octo/repo/pulls/7/files') {
        return new Response(rawList, { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const path = decodeURIComponent(url.pathname.slice('/repos/octo/repo/contents/'.length))
      return Object.hasOwn(contentByPath, path) ? fileResponse(contentByPath[path]!) : notFound()
    })
  }

  it('skips each malformed name as invalid_path, keeps the good ones, and never requests the bad ones', async () => {
    const list = `[${[
      '{"filename":"\\udc00.ts","status":"added","changes":1}',
      '{"filename":"dir\\ud800/a.ts","status":"modified","changes":1}',
      '{"filename":"src/\\ud83d\\ude00.ts","status":"added","changes":1}',
      '{"filename":"b\\ud800\\ud800.py","status":"added","changes":1}',
      '{"filename":"ok.ts","status":"added","changes":1}'
    ].join(',')}]`
    const { app, callList } = pullApp(list, { 'src/😀.ts': 'const e = 1\n', 'ok.ts': 'const o = 1\n' })
    const response = await post(app, { url: 'https://github.com/octo/repo/pull/7' })
    expect(response.status).toBe(200)
    expect(response.body.fileList.map((file: { path: string }) => file.path)).toEqual(['src/😀.ts', 'ok.ts'])
    expect(response.body.skippedList.map((item: { reason: string }) => item.reason)).toEqual(['invalid_path', 'invalid_path', 'invalid_path'])
    expect(callList).toHaveLength(4)
    expectOnlyGithubApi(callList)
  })

  it('answers 422 with skippedList when every name is malformed, after only the two PR calls', async () => {
    const { app, callList } = pullApp('[{"filename":"a\\ud800.ts","status":"added","changes":1}]', {})
    const response = await post(app, { url: 'https://github.com/octo/repo/pull/7' })
    expect(response.status).toBe(422)
    expect(response.body.error.details.skippedList).toEqual([expect.objectContaining({ reason: 'invalid_path' })])
    expect(callList).toHaveLength(2)
  })
})

describe('QA round 2: D4 the 403 mapping', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z')

  async function answerOf(status: number, header: Record<string, string>) {
    const github = fakeGithub(() => jsonResponse({ message: 'x' }, status, header))
    const error = (await github.client({ now: () => now }).getFile('octo', 'repo', ['a.ts'], 'main', budget())
      .catch((caught: unknown) => caught)) as AppError
    return { status: error.status, code: error.code, details: error.details }
  }

  it('403 with retry-after 60 is 429 with resetAt now + 60 s', async () => {
    expect(await answerOf(403, { 'retry-after': '60' }))
      .toEqual({ status: 429, code: 'rate_limited', details: { resetAt: '2026-10-25T12:01:00.000Z' } })
  })

  it('403 with retry-after and x-ratelimit-reset: retry-after wins', async () => {
    expect((await answerOf(403, { 'retry-after': '5', 'x-ratelimit-reset': '1900000000', 'x-ratelimit-remaining': '10' })).details)
      .toEqual({ resetAt: '2026-10-25T12:00:05.000Z' })
  })

  it('403 with remaining 0 and a reset time is still 429 with that reset time', async () => {
    expect(await answerOf(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }))
      .toEqual({ status: 429, code: 'rate_limited', details: { resetAt: new Date(1_800_000_000_000).toISOString() } })
  })

  it.each([
    ['no headers', {}],
    ['remaining above 0 and a reset time', { 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '1800000000' }]
  ])('403 with %s is still 502 upstream_error', async (_label, header) => {
    expect(await answerOf(403, header)).toMatchObject({ status: 502, code: 'upstream_error' })
  })

  it.each([
    ['a non-numeric retry-after', { 'retry-after': 'soon' }],
    ['an HTTP-date retry-after', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }],
    ['an empty retry-after', { 'retry-after': '' }],
    ['a huge retry-after', { 'retry-after': '999999999999' }]
  ])('403 with %s is 429, never a 500, and any resetAt is a valid date', async (_label, header) => {
    const result = await answerOf(403, header)
    expect(result).toMatchObject({ status: 429, code: 'rate_limited' })
    if (result.details !== undefined) expect(Number.isFinite(Date.parse((result.details as { resetAt: string }).resetAt))).toBe(true)
  })

  it('a 404 with retry-after stays 404', async () => {
    expect(await answerOf(404, { 'retry-after': '60' })).toMatchObject({ status: 404, code: 'not_found' })
  })

  it('a 429 through the route carries resetAt and no upstream text', async () => {
    const { app } = appWith(() => jsonResponse({ message: 'UPSTREAM-SECRET' }, 403, { 'retry-after': '30' }))
    const response = await post(app, { url: 'https://github.com/octo/repo/blob/main/a.ts' })
    expect(response.status).toBe(429)
    expect(response.body.error.details.resetAt).toEqual(expect.any(String))
    expect(JSON.stringify(response.body)).not.toContain('UPSTREAM-SECRET')
  })
})
