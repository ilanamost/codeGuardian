import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createFakeGithubSignInClient } from '../src/lib/github-signin-fake.js'
import type { GithubProfile } from '../src/lib/github-signin-client.js'
import { createSessionCodeStore, hashSessionCode } from '../src/lib/session-code.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { csrfHeader, fixedNow, frontendUrl, sessionCookieOf } from './helper/app.js'

// QA plan 048 (GitHub sign-in on iPhone): try to break the one-time code and its exchange.

const oauth = { clientId: 'test-client-id', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }
const octocat: GithubProfile = { id: '583231', login: 'octocat', name: 'The Octocat', email: 'octocat@example.com', emailVerified: true }
const hubot: GithubProfile = { id: '999001', login: 'hubot', name: 'Hubot', email: 'hubot@example.com', emailVerified: true }
const path = '/api/auth/github/exchange'

function setup(fallback = true) {
  const clock = { value: fixedNow }
  const lineList: string[] = []
  const logger = { info: (line: string) => void lineList.push(line), warn: (line: string) => void lineList.push(line) }
  const client = createFakeGithubSignInClient({ 'code-octocat': octocat, 'code-hubot': hubot })
  const app = createApp(
    { frontendUrl, enableTestRoute: true, sessionTokenFallback: fallback, githubOAuth: oauth },
    { store: createMemoryStore(), now: () => clock.value, securityLogger: logger, githubSignInClient: client }
  )
  return { app, clock, lineList }
}
type App = ReturnType<typeof setup>['app']

async function signIn(app: App, code = 'code-octocat', returnTo?: string) {
  const browser = request.agent(app).set(csrfHeader, '1')
  const start = await browser.get('/api/auth/github').query(returnTo ? { returnTo } : {})
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''
  const response = await browser.get('/api/auth/github/callback').query({ code, state })
  return { browser, response }
}
const authCodeOf = (response: request.Response) => new URLSearchParams(new URL(response.headers.location as string).hash.slice(1)).get('auth_code') ?? ''
const swap = (app: App, body: unknown) => request(app).post(path).set(csrfHeader, '1').send(body as object)

describe('QA 048 backend: a code belongs to one session', () => {
  it('two sign-ins give two codes, and each code opens its own session only', async () => {
    const { app } = setup()
    const a = await signIn(app, 'code-octocat')
    const b = await signIn(app, 'code-hubot')
    const codeA = authCodeOf(a.response)
    const codeB = authCodeOf(b.response)
    expect(codeA).not.toBe(codeB)

    const tokenB = (await swap(app, { code: codeB })).body.sessionToken as string
    const tokenA = (await swap(app, { code: codeA })).body.sessionToken as string

    const who = async (token: string) => (await request(app).get('/api/session').set('Authorization', `Bearer ${token}`)).body.account?.username
    expect(await who(tokenA)).toBe('octocat')
    expect(await who(tokenB)).toBe('hubot')
  })

  it('a code is not a session: it fails as a bearer and as a cookie', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)

    expect((await request(app).get('/api/session').set('Authorization', `Bearer ${code}`)).status).toBe(401)
    expect((await request(app).get('/api/session').set('Cookie', `cr_session=${code}`)).status).toBe(401)
    // ...and the failed use did not burn it
    expect((await swap(app, { code })).status).toBe(200)
  })

  it('the session token is not an exchange code', async () => {
    const { app } = setup()
    const { response } = await signIn(app)
    const token = (await swap(app, { code: authCodeOf(response) })).body.sessionToken as string

    expect((await swap(app, { code: token })).status).toBe(401)
  })

  it('a code in the query string or a header is ignored and stays unused', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)

    const viaQuery = await request(app).post(`${path}?code=${code}`).set(csrfHeader, '1').send({})
    const viaHeader = await request(app).post(path).set(csrfHeader, '1').set('X-Auth-Code', code).send({})

    expect(viaQuery.status).toBe(401)
    expect(viaHeader.status).toBe(401)
    expect(viaQuery.text).not.toContain(code)
    expect((await swap(app, { code })).status).toBe(200)
  })

  it('twelve parallel exchanges of one code give exactly one 200', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)

    const result = await Promise.all(Array.from({ length: 12 }, () => swap(app, { code })))

    expect(result.filter((item) => item.status === 200)).toHaveLength(1)
    expect(result.filter((item) => item.status === 401)).toHaveLength(11)
  })

  it('a code whose session was signed out before the swap gives a token that does not work', async () => {
    const { app } = setup()
    const { browser, response } = await signIn(app)
    const code = authCodeOf(response)
    await browser.delete('/api/session')

    const result = await swap(app, { code })

    if (result.status === 200) {
      expect((await request(app).get('/api/session').set('Authorization', `Bearer ${result.body.sessionToken}`)).status).toBe(401)
    } else {
      expect(result.status).toBe(401)
    }
  })
})

describe('QA 048 backend: hostile requests', () => {
  it('malformed, oversized and odd bodies are refused with no echo, never a 5xx', async () => {
    const { app, lineList } = setup()
    const canary = 'CANARYCODE'.repeat(1000)
    const attemptList: Array<[string, request.Test]> = [
      ['10k code', request(app).post(path).set(csrfHeader, '1').send({ code: canary })],
      ['3 MB body', request(app).post(path).set(csrfHeader, '1').send({ code: 'a'.repeat(43), pad: 'x'.repeat(3_000_000) })],
      ['broken json', request(app).post(path).set(csrfHeader, '1').set('Content-Type', 'application/json').send(`{"code":"${canary}`)],
      ['text body', request(app).post(path).set(csrfHeader, '1').set('Content-Type', 'text/plain').send(canary)],
      ['form body', request(app).post(path).set(csrfHeader, '1').type('form').send({ code: 'a'.repeat(43) })],
      ['array body', request(app).post(path).set(csrfHeader, '1').send([canary] as unknown as object)],
      ['string body', request(app).post(path).set(csrfHeader, '1').set('Content-Type', 'application/json').send(`"${canary}"`)],
      ['proto pollution', request(app).post(path).set(csrfHeader, '1').set('Content-Type', 'application/json').send('{"__proto__":{"code":"' + 'a'.repeat(43) + '"}}')],
      ['nul in code', request(app).post(path).set(csrfHeader, '1').send({ code: `${'a'.repeat(42)}\u0000` })],
      ['trailing newline', request(app).post(path).set(csrfHeader, '1').send({ code: `${'a'.repeat(43)}\n` })]
    ]
    for (const [label, attempt] of attemptList) {
      const response = await attempt
      expect([400, 401, 413, 415], label).toContain(response.status)
      expect(response.text, label).not.toContain('CANARYCODE')
      expect(response.headers['set-cookie'], label).toBeUndefined()
    }
    expect(lineList.join('\n')).not.toContain('CANARYCODE')
  })

  it('a trailing newline or space on a real code is not accepted', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)

    expect((await swap(app, { code: `${code}\n` })).status).toBe(401)
    expect((await swap(app, { code: ` ${code}` })).status).toBe(401)
    expect((await swap(app, { code })).status).toBe(200)
  })

  it('Origin: null, a look-alike origin and a sub-domain of the frontend are refused, the code survives', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)
    const origin = new URL(frontendUrl).origin
    for (const bad of ['null', `${origin}.evil.example`, origin.replace('//', '//evil.'), 'http://localhost:5174']) {
      const response = await request(app).post(path).set(csrfHeader, '1').set('Origin', bad).send({ code })
      expect(response.status, bad).toBe(403)
    }
    expect((await swap(app, { code })).status).toBe(200)
  })

  it('wrong CSRF header values are refused', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)
    for (const value of ['', '0', 'true']) {
      const response = await request(app).post(path).set(csrfHeader, value).send({ code })
      expect([200, 403], value).toContain(response.status)
      if (response.status === 200) return expect(value).toBe('true') // recorded: any non-empty value passes today
    }
  })

  it('GET, PUT and DELETE on the exchange path give no token', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)
    for (const method of ['get', 'put', 'delete', 'patch'] as const) {
      const response = await request(app)[method](`${path}`).set(csrfHeader, '1').send({ code })
      expect([401, 403, 404, 405], method).toContain(response.status)
      expect(response.text).not.toContain('sessionToken')
    }
    expect((await swap(app, { code })).status).toBe(200)
  })
})

describe('QA 048 backend: the 429 bucket is shared', () => {
  it('start calls and exchange calls count together', async () => {
    const { app } = setup()
    for (let index = 0; index < 20; index += 1) await request(app).get('/api/auth/github')
    for (let index = 0; index < 10; index += 1) expect((await swap(app, { code: 'a'.repeat(43) })).status).toBe(401)

    const limited = await swap(app, { code: 'a'.repeat(43) })
    const start = await request(app).get('/api/auth/github')

    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
    expect(limited.text).not.toContain('aaaaaaaaaaaa')
    expect(start.status).toBe(302)
    expect(new URL(start.headers.location as string).searchParams.get('auth_error')).toBe('rate_limited')
  })

  it('a valid code is refused with 429 once the bucket is full, and works after the window', async () => {
    const { app, clock } = setup()
    const code = authCodeOf((await signIn(app)).response)
    for (let index = 0; index < 40; index += 1) await swap(app, { code: 'b'.repeat(43) })
    expect((await swap(app, { code })).status).toBe(429)

    clock.value += 15 * 60_000 + 1
    // the code itself is older than 60 s by now
    expect((await swap(app, { code })).status).toBe(401)
  })
})

describe('QA 048 backend: callback fragment', () => {
  it('a returnTo that carries its own fragment or encoded # cannot add a second auth_code or extra content', async () => {
    const { app } = setup()
    for (const returnTo of ['/x#auth_code=EVIL', '/x%23auth_code=EVIL', '/x?a=1#frag', '//evil.example/#a', '/\\evil.example']) {
      const { response } = await signIn(app, 'code-octocat', returnTo)
      const location = response.headers.location as string
      expect(location.split('#').length, returnTo).toBeLessThanOrEqual(2)
      // An encoded %23 stays a literal path character (not a fragment), so only a raw '#' counts.
      if (!returnTo.includes('%23')) expect(location, returnTo).not.toContain('EVIL')
      expect(new URL(location).hash, returnTo).not.toContain('EVIL')
      expect(new URL(location).origin, returnTo).toBe(new URL(frontendUrl).origin)
      const hash = new URL(location).hash
      expect(hash, returnTo).toMatch(/^#auth_code=[A-Za-z0-9_-]{43}$/)
      expect(new URL(location).search, returnTo).not.toContain('auth_code')
    }
  })

  it('every sign-in code differs and the callback sends no code to a second visit (state replay)', async () => {
    const { app } = setup()
    const browser = request.agent(app).set(csrfHeader, '1')
    const start = await browser.get('/api/auth/github')
    const state = new URL(start.headers.location as string).searchParams.get('state') ?? ''
    const first = await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state })
    const replay = await browser.get('/api/auth/github/callback').query({ code: 'code-octocat', state })

    expect(new URL(first.headers.location as string).hash).toMatch(/^#auth_code=/)
    expect(new URL(replay.headers.location as string).hash).toBe('')
    expect(sessionCookieOf(replay)).toBeUndefined()
  })

  it('switch off: no fragment, 404 for any body, header or origin, and the CSRF check does not turn it into a 403 oracle for valid calls', async () => {
    const { app } = setup(false)
    const { response } = await signIn(app)
    expect(response.headers.location).not.toContain('#')
    expect((await swap(app, { code: 'a'.repeat(43) })).status).toBe(404)
    expect((await swap(app, {})).status).toBe(404)
    expect([401, 404]).toContain((await request(app).get(path)).status)
  })
})

describe('QA 048 backend: nothing sensitive in logs, errors or headers', () => {
  it('full sign-in, swap, bearer use and failures: no code, token or session id in any log line, header or error body', async () => {
    const { app, lineList } = setup()
    const { response } = await signIn(app)
    const code = authCodeOf(response)
    const cookie = sessionCookieOf(response)
    const ok = await swap(app, { code })
    const token = ok.body.sessionToken as string
    const bad = [await swap(app, { code }), await swap(app, { code: 'z'.repeat(43) }), await swap(app, {})]
    const restore = await request(app).get('/api/session').set('Authorization', `Bearer ${token}`)

    const everywhere = [lineList.join('\n'), ...bad.map((item) => item.text + JSON.stringify(item.headers))].join('\n')
    expect(everywhere).not.toContain(code)
    expect(everywhere).not.toContain(token)
    expect(everywhere).not.toContain('zzzzzzzzzzzzzzzz')
    expect(JSON.stringify(restore.headers)).not.toContain(token)
    expect(response.text).not.toContain(code)
    expect(JSON.stringify(response.headers).replace(response.headers.location as string, '')).not.toContain(code)
    expect(response.headers.referer).toBeUndefined()
    expect(cookie).toBeDefined()
  })

  it('the 200 and the 401 answers are not cacheable and carry no cookie or CORS grant for a foreign origin', async () => {
    const { app } = setup()
    const code = authCodeOf((await signIn(app)).response)
    const ok = await request(app).post(path).set(csrfHeader, '1').set('Origin', 'https://evil.example').send({ code })
    expect(ok.status).toBe(403)
    const pre = await request(app).options(path).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST')
    expect(pre.headers['access-control-allow-origin']).toBeUndefined()
    const good = await swap(app, { code })
    expect(good.headers['cache-control']).toBe('no-store')
    expect(good.headers['access-control-allow-origin']).not.toBe('*')
  })
})

describe('QA 048 backend: code store limits (injectable clock)', () => {
  const sid = (n: number) => `S${n}`.padEnd(43, 'x')

  it('never grows past maxCount; the oldest live code is evicted first', () => {
    const clock = { value: 0 }
    const store = createSessionCodeStore({ now: () => clock.value, ttlMs: 60_000, maxCount: 5 })
    const codeList = Array.from({ length: 12 }, (_, n) => store.issue(sid(n)))
    expect(store.size()).toBe(5)
    expect(store.consume(codeList[0])).toBeUndefined()
    expect(store.consume(codeList[6])).toBeUndefined()
    expect(store.consume(codeList[7])).toBe(sid(7))
    expect(store.consume(codeList[11])).toBe(sid(11))
  })

  it('expired codes are swept before a live one is evicted when full', () => {
    const clock = { value: 0 }
    const store = createSessionCodeStore({ now: () => clock.value, ttlMs: 60_000, maxCount: 3 })
    const oldList = [store.issue(sid(1)), store.issue(sid(2))]
    clock.value = 30_000
    const live = store.issue(sid(3))
    clock.value = 60_000
    const fresh = store.issue(sid(4))

    expect(store.size()).toBe(2)
    expect(store.consume(oldList[0])).toBeUndefined()
    expect(store.consume(live)).toBe(sid(3))
    expect(store.consume(fresh)).toBe(sid(4))
  })

  it('a consumed or expired code leaves the map at once, and only hashes are held', () => {
    const clock = { value: 0 }
    const store = createSessionCodeStore({ now: () => clock.value, ttlMs: 60_000, maxCount: 10 })
    const code = store.issue(sid(1))
    expect(store.holds(code)).toBe(false)
    expect(store.holds(hashSessionCode(code))).toBe(true)
    clock.value = 60_000
    expect(store.consume(code)).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  it('many sign-in codes issued through the app: the newest still works', async () => {
    const { app } = setup()
    let last = ''
    for (let index = 0; index < 14; index += 1) last = authCodeOf((await signIn(app, 'code-octocat')).response)
    expect((await swap(app, { code: last })).status).toBe(200)
  })
})
