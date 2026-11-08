import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { createFakeGithubFetch } from '../src/lib/github-fake.js'
import { createGithubClient, type FetchLike } from '../src/lib/github-fetch.js'
import { encodeFileId } from '../src/lib/github-id.js'
import { buildApp, csrfHeader, fixedNow, frontendUrl } from './helper/app.js'

// Plan 049: a canary token searched for across a full wizard and link-import flow, and the
// per-address limit buckets with and without TRUST_PROXY.

const canary = 'ghp_FLOW_CANARY_TOKEN_049_zzz'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GITHUB_API_TOKEN: the token is in no response, log or health answer', () => {
  it('a full wizard and link-import flow, with one refused call, never shows the canary outside the Authorization header', async () => {
    const consoleList: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...argList: unknown[]) => { consoleList.push(argList.map(String).join(' ')) })
    }
    const securityList: string[] = []
    const securityLogger = {
      info: (...argList: unknown[]) => { securityList.push(JSON.stringify(argList)) },
      warn: (...argList: unknown[]) => { securityList.push(JSON.stringify(argList)) }
    }

    // The fake GitHub, recording each call; the very first call answers 401 (a refused token).
    const fake = createFakeGithubFetch()
    const seen: Array<{ url: string, authorization: string | null }> = []
    const fetch: FetchLike = async (url, init) => {
      const authorization = new Headers(init.headers).get('authorization')
      seen.push({ url, authorization })
      if (seen.length === 1) return new Response('{"message":"Bad credentials"}', { status: 401, headers: { 'content-type': 'application/json' } })
      return fake(url, init)
    }
    const { app } = buildApp({ githubClient: createGithubClient({ fetch, authorization: `Bearer ${canary}` }), securityLogger })

    const responseList = [
      await request(app).post('/api/github/connect').send({ username: 'example-user' }),
      await request(app).get('/api/github/repo'),
      await request(app).get('/api/github/repo/demo/file'),
      await request(app).get(`/api/github/repo/demo/file/${encodeFileId('src/greet.ts')}`),
      await request(app).post('/api/github/import').send({ url: 'https://github.com/example-org/demo/blob/main/src/greet.ts' }),
      await request(app).post('/api/github/import').send({ url: 'https://github.com/example-org/demo/pull/1' }),
      await request(app).post('/api/github/import').send({ url: 'https://github.com/example-org/rate-limited/blob/main/src/greet.ts' }),
      await request(app).get('/api/health')
    ]

    // The flow really worked (the first call was retried), and every call went to GitHub's API.
    expect(responseList.slice(0, 5).map((response) => response.status)).toEqual([200, 200, 200, 200, 200])
    expect(responseList[6]?.status).toBe(429)
    expect(seen.length).toBeGreaterThan(6)
    for (const call of seen) expect(new URL(call.url).origin).toBe('https://api.github.com')
    // The token went out on calls, and the one retry went out without it.
    expect(seen.some((call) => call.authorization === `Bearer ${canary}`)).toBe(true)
    expect(seen[1]?.authorization).toBeNull()

    // Nothing the server printed or answered contains it, and the refused token left one warning.
    const everything = JSON.stringify(responseList.map((response) => ({ body: response.body, text: response.text, header: response.headers })))
    expect(everything).not.toContain(canary)
    expect(consoleList.join('\n')).not.toContain(canary)
    expect(securityList.join('\n')).not.toContain(canary)
    expect(consoleList.filter((line) => line.includes('GITHUB_API_TOKEN'))).toHaveLength(1)
    expect(responseList[7]?.body).toEqual({ status: 'ok', analyzer: 'stub', githubOAuth: false })
  })
})

describe('TRUST_PROXY: per-address limit buckets (plan 049)', () => {
  // 20 sign-in attempts per address in 15 minutes (LIMIT.rateLimit.signInIp); user names differ,
  // so only the address limit can answer 429.
  async function attempt(app: ReturnType<typeof createApp>, index: number, forwardedFor: string) {
    return request(app).post('/api/session').set(csrfHeader, '1').set('X-Forwarded-For', forwardedFor)
      .send({ username: `nobody${index}`, password: 'wrong-pass-1' })
  }

  async function fill(app: ReturnType<typeof createApp>, forwardedFor: string): Promise<void> {
    for (let index = 0; index < 20; index += 1) expect((await attempt(app, index, forwardedFor)).status).toBe(401)
  }

  const build = (trustProxy?: number) => createApp({ frontendUrl, enableTestRoute: false, trustProxy }, { now: () => fixedNow, securityLogger: { info: () => undefined, warn: () => undefined } })

  it('TRUST_PROXY=1: different X-Forwarded-For values are separate buckets', async () => {
    const app = build(1)
    await fill(app, '203.0.113.1')

    expect((await attempt(app, 100, '203.0.113.1')).status).toBe(429)
    expect((await attempt(app, 101, '203.0.113.2')).status).toBe(401)
  })

  it.each([undefined, 0])('trust proxy off (%s): X-Forwarded-For is ignored, so there is one bucket and no spoofing', async (trustProxy) => {
    const app = build(trustProxy)
    await fill(app, '203.0.113.1')

    expect((await attempt(app, 100, '203.0.113.2')).status).toBe(429)
    expect((await attempt(app, 101, '203.0.113.3')).status).toBe(429)
  })

  it('TRUST_PROXY=1 trusts only the last hop: extra spoofed addresses on the left do not make a new bucket', async () => {
    const app = build(1)
    await fill(app, '198.51.100.9, 203.0.113.1')

    expect((await attempt(app, 100, '198.51.100.77, 203.0.113.1')).status).toBe(429)
  })
})
