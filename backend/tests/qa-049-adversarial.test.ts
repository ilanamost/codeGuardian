import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import { loadConfig } from '../src/config.js'
import { createGithubClient } from '../src/lib/github-fetch.js'
import { createConfiguredGithubClient } from '../src/lib/github-client-of.js'
import { budget, jsonResponse } from './helper/github.js'

// QA plan 049: try to break the token, the 401 retry, the redirect rule, TRUST_PROXY and the contract.

const canary = 'ghp_QA049_CANARY_zzz'
const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }

function clientWith(status: number, headers: Record<string, string> = {}) {
  const urlList: string[] = []
  const authList: Array<string | null> = []
  const warnList: string[] = []
  const fetch = async (url: string, init: RequestInit) => {
    urlList.push(url)
    authList.push(new Headers(init.headers).get('authorization'))
    return new Response('{"message":"x"}', { status, headers: { 'content-type': 'application/json', ...headers } })
  }
  const client = createGithubClient({ fetch: fetch as never, authorization: `Bearer ${canary}`, warn: (line) => warnList.push(line) })
  return { client, urlList, authList, warnList }
}

describe('qa-049: the 401 retry happens only for 401', () => {
  it.each([400, 403, 404, 422, 429, 500, 502, 503])('status %i is one call, no retry, no warning', async (status) => {
    const run = clientWith(status)
    await run.client.getUser('octo', budget()).catch(() => undefined)
    expect(run.authList).toEqual([`Bearer ${canary}`])
    expect(run.warnList).toEqual([])
  })

  it('a 401 is exactly two calls, the second without the token, and the warning has no token', async () => {
    const run = clientWith(401)
    await run.client.getUser('octo', budget()).catch(() => undefined)
    expect(run.authList).toEqual([`Bearer ${canary}`, null])
    expect(run.warnList).toHaveLength(1)
    expect(run.warnList[0]).not.toContain(canary)
    expect(run.warnList[0]).toContain('GITHUB_API_TOKEN')
  })

  it.each([301, 302, 307, 308])('a %i is a 502 after one call (never followed, token not re-sent)', async (status) => {
    const run = clientWith(status, { location: 'https://evil.example/steal' })
    const error = await run.client.getUser('octo', budget()).catch((e: unknown) => e) as { status?: number, message?: string }
    expect(error.status).toBe(502)
    expect(run.urlList).toHaveLength(1)
    expect(new URL(run.urlList[0] ?? '').origin).toBe('https://api.github.com')
    expect(JSON.stringify(error)).not.toContain(canary)
    expect(String(error.message)).not.toContain(canary)
  })

  it('a 401 then a 3xx on the retry is still a 502 and never reaches the redirect target', async () => {
    const urlList: string[] = []
    let n = 0
    const fetch = async (url: string) => {
      urlList.push(url)
      n += 1
      return n === 1 ? new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
    }
    const client = createGithubClient({ fetch: fetch as never, authorization: `Bearer ${canary}`, warn: () => undefined })
    const error = await client.getUser('octo', budget()).catch((e: unknown) => e) as { status?: number }
    expect(error.status).toBe(502)
    expect(urlList.every((url) => new URL(url).origin === 'https://api.github.com')).toBe(true)
  })
})

describe('qa-049: a malformed token never leaks', () => {
  it('a token with a line break makes fetch throw; the error does not carry the token', async () => {
    const bad = `${canary}\nX-Evil: 1`
    const client = createGithubClient({ fetch: (async (_u: string, init: RequestInit) => { new Headers(init.headers); return jsonResponse({ login: 'octo' }) }) as never, authorization: `Bearer ${bad}`, warn: () => undefined })
    const error = await client.getUser('octo', budget()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).not.toContain(canary)
    expect(JSON.stringify(error)).not.toContain(canary)
  })

  it('an interior-whitespace token is kept as is by config (trim only the ends)', () => {
    expect(loadConfig({ ...required, GITHUB_API_TOKEN: ` a b ` }).githubApiToken).toBe('a b')
  })
})

describe('qa-049: GITHUB_FAKE never gets the token', () => {
  it('the fake fetch is built without the token and no Authorization is passed to it', async () => {
    const seen: Array<string | null> = []
    const client = createConfiguredGithubClient({ githubFake: true, githubApiToken: canary }, { fakeFetch: (async (_u: string, init: RequestInit) => { seen.push(new Headers(init.headers).get('authorization')); return jsonResponse({ login: 'octo', name: null }) }) as never, fetch: vi.fn() as never })
    await client.getUser('octo', budget())
    expect(seen).toEqual([null])
  })
})

describe('qa-049: TRUST_PROXY rejects bad values, naming only the setting', () => {
  it.each(['-1', 'abc', '1.5', 'true', '+1', '1e1', '0x1', '1 2', '100', '001', '١', '1;2', '${canary}', 'NaN', 'Infinity', '1\n2'])('rejects %j', (value) => {
    let text = ''
    try { loadConfig({ ...required, TRUST_PROXY: value, GITHUB_API_TOKEN: canary }) } catch (error) { text = String(error) }
    expect(text).toContain('TRUST_PROXY')
    expect(text).not.toContain(canary)
    if (value.trim() !== '') expect(text).not.toContain(value)
  })

  it.each([['', 0], ['  ', 0], ['0', 0], ['00', 0], ['1', 1], [' 2 ', 2], ['01', 1]])('accepts %j as %i', (value, hops) => {
    expect(loadConfig({ ...required, TRUST_PROXY: value }).trustProxy).toBe(hops)
  })

  it('both unset: no token, trust proxy 0 (as before)', () => {
    const config = loadConfig(required)
    expect(config.githubApiToken).toBeUndefined()
    expect(config.trustProxy).toBe(0)
  })
})

describe('qa-049: contract 0.20.0', () => {
  const doc = YAML.parse(readFileSync(new URL('../../.orchestrate/api-contract.yaml', import.meta.url), 'utf8')) as { info: { version: string }, paths: Record<string, Record<string, { responses?: unknown }>> }
  it('parses, is 0.20.0, every operation has responses', () => {
    expect(doc.info.version).toBe('0.20.0')
    for (const [path, ops] of Object.entries(doc.paths)) for (const [method, op] of Object.entries(ops)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) expect(op.responses, `${method} ${path}`).toBeTruthy()
    }
  })
  it('does not contain a token-like value or the canary', () => {
    const text = readFileSync(new URL('../../.orchestrate/api-contract.yaml', import.meta.url), 'utf8')
    expect(text).not.toMatch(/ghp_|github_pat_/)
  })
})
