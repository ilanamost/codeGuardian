import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { hashSessionId } from '../src/lib/session.js'
import { buildApp, demoPassword, demoUsername, fixedNow, frontendUrl, newAgent, registerAgent, registrationOf, sessionCookieOf } from './helper/app.js'

// QA (plan 028): adversarial checks beyond the implementing agent's suites. Each test tries to
// break one guarantee of the session, CSRF, CORS, rate-limit, registration, photo and logging
// rules.

const png = (size: number) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, Buffer.alloc(Math.max(0, size - signature.length), 0x41)])
}

function cookieValueOf(response: { headers: Record<string, unknown> }): string {
  return (sessionCookieOf(response) ?? '').split(';')[0] ?? ''
}

describe('QA: rate limits cannot be dodged', () => {
  it('X-Forwarded-For spoofing does not reset the per-IP sign-in limit (no trust proxy)', async () => {
    const { rawApp } = buildApp()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1')
        .set('X-Forwarded-For', `10.0.0.${attempt}`).send({ username: `nobody${attempt}`, password: 'wrong' })
      expect(response.status).toBe(401)
    }
    const blocked = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1')
      .set('X-Forwarded-For', '10.9.9.9').send({ username: demoUsername, password: demoPassword })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('X-Forwarded-For spoofing does not reset the sign-up limit', async () => {
    const { rawApp } = buildApp()
    for (let index = 0; index < 5; index += 1) {
      const response = await request(rawApp).post('/api/account').set('X-CSRF-Protection', '1')
        .set('X-Forwarded-For', `10.0.1.${index}`).send(registrationOf(`spoof${index}`))
      expect(response.status).toBe(201)
    }
    const blocked = await request(rawApp).post('/api/account').set('X-CSRF-Protection', '1')
      .set('X-Forwarded-For', '10.0.1.99').send(registrationOf('spoof99'))
    expect(blocked.status).toBe(429)
  })

  it('case and surrounding spaces share one user-name failure counter', async () => {
    const { rawApp } = buildApp()
    const variantList = ['JOHN.DOE', ' john.doe', 'John.Doe ', 'jOhN.dOe', 'john.doe']
    for (const username of variantList) {
      const response = await newAgent(rawApp).post('/api/session').send({ username, password: 'wrong-1' })
      expect(response.status).toBe(401)
    }
    const blocked = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword })
    expect(blocked.status).toBe(429)
  })

  it('the 429 body is identical for a known and an unknown user name', async () => {
    const { rawApp } = buildApp()
    for (const username of [demoUsername, 'ghost.user']) {
      for (let attempt = 0; attempt < 5; attempt += 1) await newAgent(rawApp).post('/api/session').send({ username, password: 'wrong-1' })
    }
    const known = await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: 'wrong-1' })
    const unknown = await newAgent(rawApp).post('/api/session').send({ username: 'ghost.user', password: 'wrong-1' })
    expect(known.status).toBe(429)
    expect(unknown.status).toBe(429)
    expect(known.body.error).toEqual(unknown.body.error)
  })
})

describe('QA: user enumeration', () => {
  it('unknown user and wrong password take about the same time (dummy scrypt hash)', async () => {
    const { rawApp } = buildApp()
    // Warm up: the dummy hash is computed on the first unknown user name.
    await newAgent(rawApp).post('/api/session').send({ username: 'warm.up', password: 'x' })
    const time = async (username: string) => {
      const start = performance.now()
      const response = await newAgent(rawApp).post('/api/session').send({ username, password: 'wrong-1' })
      expect(response.status).toBe(401)
      return performance.now() - start
    }
    let unknown = 0
    let known = 0
    for (let attempt = 0; attempt < 4; attempt += 1) {
      unknown += await time(`ghost${attempt}`)
      known += await time(demoUsername)
    }
    const ratio = Math.max(unknown, known) / Math.min(unknown, known)
    expect(ratio).toBeLessThan(2.5)
  })

  it('a duplicate sign-up with a different-case email gives the same 409 body as a duplicate user name', async () => {
    const { rawApp } = buildApp()
    const byName = await newAgent(rawApp).post('/api/account').send({ username: 'JOHN.DOE', email: 'fresh@example.com', password: 'fresh-pass-42' })
    const byEmail = await newAgent(rawApp).post('/api/account').send({ username: 'fresh.user', email: ' JOHN@Company.COM ', password: 'fresh-pass-42' })
    expect(byName.status).toBe(409)
    expect(byEmail.status).toBe(409)
    expect(byName.body.error).toEqual(byEmail.body.error)
    expect(sessionCookieOf(byName)).toBeUndefined()
  })
})

describe('QA: registration input', () => {
  it.each([
    ['prototype key', { ...registrationOf('proto'), __proto__: { admin: true } }],
    ['org id smuggled in', { ...registrationOf('smuggle'), orgId: 'default' }],
    ['SQL characters in the user name', { username: "a'; DROP TABLE account;--", email: 'sql@example.com', password: 'fresh-pass-42' }],
    ['Cyrillic lookalike user name', { username: 'jоhn.doe', email: 'cyr@example.com', password: 'fresh-pass-42' }],
    ['huge user name', { username: 'a'.repeat(100_000), email: 'huge@example.com', password: 'fresh-pass-42' }],
    ['huge password', { username: 'huge.pass', email: 'hugepass@example.com', password: 'a1'.repeat(150) }],
    ['NUL in password', { username: 'nul.pass', email: 'nul@example.com', password: 'fresh\u0000pass-42' }],
    ['password equals user name in other case', { username: 'Secret123', email: 'same@example.com', password: 'sECRET123' }],
    ['password equals email', { username: 'mail.pass', email: 'pw1@example.com', password: 'PW1@example.com' }],
    ['common password', { username: 'common.pass', email: 'common@example.com', password: 'password1' }],
    ['demo password (no digit)', { username: 'demo.pass', email: 'demo@example.com', password: 'mock-password' }],
    ['array as user name', { username: ['admin'], email: 'arr@example.com', password: 'fresh-pass-42' }]
  ])('%s gives 422 (or 413), creates nothing and echoes no password', async (_label, body) => {
    const { rawApp, store } = buildApp()
    const before = store.orgMap.size
    // An object literal's `__proto__` is not an own key, so that case is sent as raw JSON text.
    const payload = _label === 'prototype key' ? '{"username":"proto","email":"proto@example.com","password":"proto-Secret-42","__proto__":{"admin":true}}' : JSON.stringify(body)
    const response = await request(rawApp).post('/api/account').set('X-CSRF-Protection', '1').set('content-type', 'application/json').send(payload)
    expect([413, 422]).toContain(response.status)
    expect(store.orgMap.size).toBe(before)
    const text = JSON.stringify(response.body)
    if (typeof (body as { password?: unknown }).password === 'string') expect(text).not.toContain((body as { password: string }).password)
  })
})

describe('QA: CSRF and CORS edge cases', () => {
  it.each([
    ['form POST, no header', 'application/x-www-form-urlencoded', undefined, undefined],
    ['text/plain, no header', 'text/plain', undefined, undefined],
    ['header value 0', 'application/json', '0', undefined],
    ['header value true', 'application/json', 'true', undefined],
    ['null Origin', 'application/json', '1', 'null'],
    ['Origin with a trailing slash', 'application/json', '1', `${frontendUrl}/`],
    ['look-alike Origin suffix', 'application/json', '1', `${frontendUrl}.evil.example`],
    ['other port', 'application/json', '1', 'http://localhost:5999']
  ])('%s on sign-in is 403 and sets no cookie', async (_label, contentType, csrf, origin) => {
    const { rawApp } = buildApp()
    let pending = request(rawApp).post('/api/session').set('content-type', contentType)
    if (csrf !== undefined) pending = pending.set('X-CSRF-Protection', csrf)
    if (origin !== undefined) pending = pending.set('Origin', origin)
    const response = await pending.send(contentType === 'application/json' ? JSON.stringify({ username: demoUsername, password: demoPassword }) : `username=${demoUsername}&password=${demoPassword}`)
    expect(response.status).toBe(403)
    expect(sessionCookieOf(response)).toBeUndefined()
  })

  it.each(['null', 'https://evil.example', `${frontendUrl}.evil.example`, frontendUrl.replace('localhost', '127.0.0.1')])('Origin %s is never reflected', async (origin) => {
    const { rawApp } = buildApp()
    const preflight = await request(rawApp).options('/api/session').set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-csrf-protection')
    const get = await request(rawApp).get('/api/health').set('Origin', origin)
    for (const response of [preflight, get]) {
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    }
  })
})

describe('QA: route boundary tricks', () => {
  it.each([
    ['GET', '/API/ACCOUNT'],
    ['GET', '/api/account/'],
    ['GET', '/api//account'],
    ['HEAD', '/api/account/avatar'],
    ['GET', '/api/session/../account'],
    ['GET', '/api/session%2F..%2Faccount'],
    ['GET', '/api/review?orgId=default'],
    ['POST', '/api/test/reset']
  ])('%s %s without a session never answers 2xx', async (method, url) => {
    const { rawApp } = buildApp()
    const pending = method === 'HEAD' ? request(rawApp).head(url) : method === 'POST' ? request(rawApp).post(url).set('X-CSRF-Protection', '1') : request(rawApp).get(url)
    const response = await pending
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('the test reset route is unreachable when not enabled, even signed in', async () => {
    const { app, store } = buildApp()
    const extra = await registerAgent(app, registrationOf('keeper'))
    const response = await request(app).post('/api/test/reset')
    expect(response.status).toBe(404)
    expect(store.orgMap.size).toBe(2)
    expect((await extra.get('/api/account')).status).toBe(200)
  })
})

describe('QA: sessions', () => {
  it('a valid session of account A sent with B\'s sign-in is discarded, and B gets a new id', async () => {
    const { rawApp, store } = buildApp()
    const alice = await newAgent(rawApp).post('/api/account').send(registrationOf('alice'))
    const aliceCookie = cookieValueOf(alice)
    const signIn = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').set('cookie', aliceCookie)
      .send({ username: demoUsername, password: demoPassword })
    const demoCookie = cookieValueOf(signIn)
    expect(demoCookie).not.toBe(aliceCookie)
    expect((await request(rawApp).get('/api/account').set('cookie', aliceCookie)).status).toBe(401)
    expect(store.sessionMap.has(hashSessionId(aliceCookie.split('=')[1] ?? ''))).toBe(false)
  })

  it('GET /api/session never sets a cookie for an anonymous visitor', async () => {
    const { rawApp } = buildApp()
    const response = await request(rawApp).get('/api/session').set('cookie', 'cr_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(response.status).toBe(401)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('a session past its idle expiry is deleted from the store on read', async () => {
    let now = fixedNow
    const store = createMemoryStore()
    const rawApp = createApp({ frontendUrl, enableTestRoute: false }, { store, now: () => now, securityLogger: { info: () => undefined, warn: () => undefined } })
    const signIn = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').send({ username: demoUsername, password: demoPassword })
    const cookie = cookieValueOf(signIn)
    now += 8 * 60 * 60 * 1000 - 1000
    expect((await request(rawApp).get('/api/account').set('cookie', cookie)).status).toBe(200)
    now += 8 * 60 * 60 * 1000 - 1000
    // Rolled: still valid after 16 hours of activity.
    expect((await request(rawApp).get('/api/account').set('cookie', cookie)).status).toBe(200)
    now += 8 * 60 * 60 * 1000 + 1
    expect((await request(rawApp).get('/api/account').set('cookie', cookie)).status).toBe(401)
    expect(store.sessionMap.size).toBe(0)
  })

  it('the absolute expiry ends a session that is used every hour', async () => {
    let now = fixedNow
    const rawApp = createApp({ frontendUrl, enableTestRoute: false }, { now: () => now, securityLogger: { info: () => undefined, warn: () => undefined } })
    const cookie = cookieValueOf(await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').send({ username: demoUsername, password: demoPassword }))
    for (let hour = 1; hour < 7 * 24; hour += 1) {
      now = fixedNow + hour * 60 * 60 * 1000
      const response = await request(rawApp).get('/api/session').set('cookie', cookie)
      expect(response.status).toBe(200)
      expect(Date.parse(response.body.expiresAt)).toBeLessThanOrEqual(fixedNow + 7 * 24 * 60 * 60 * 1000)
    }
    now = fixedNow + 7 * 24 * 60 * 60 * 1000
    expect((await request(rawApp).get('/api/session').set('cookie', cookie)).status).toBe(401)
  })

  it('production: __Host- name, Secure, no Domain; the development cookie name is ignored', async () => {
    const rawApp = createApp({ frontendUrl, enableTestRoute: false, production: true }, { securityLogger: { info: () => undefined, warn: () => undefined } })
    const signIn = await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1').send({ username: demoUsername, password: demoPassword })
    const header = (signIn.headers['set-cookie'] as unknown as string[])[0] ?? ''
    expect(header).toMatch(/^__Host-cr_session=/)
    expect(header).toMatch(/; Secure/)
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Lax/)
    expect(header).toMatch(/Path=\//)
    expect(header).not.toMatch(/Domain=/i)
    const id = header.split(';')[0]?.split('=')[1] ?? ''
    expect((await request(rawApp).get('/api/account').set('cookie', `cr_session=${id}`)).status).toBe(401)
    expect((await request(rawApp).get('/api/account').set('cookie', `__Host-cr_session=${id}`)).status).toBe(200)
  })

  it('a wrong current password locks the user name for sign-in too (documented lockout)', async () => {
    const { rawApp } = buildApp()
    const agent = newAgent(rawApp)
    await agent.post('/api/session').send({ username: demoUsername, password: demoPassword })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await agent.put('/api/account/password').send({ currentPassword: 'wrong-1', newPassword: 'brand-new-42' })).status).toBe(422)
    }
    expect((await agent.put('/api/account/password').send({ currentPassword: demoPassword, newPassword: 'brand-new-42' })).status).toBe(429)
    expect((await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword })).status).toBe(429)
  })

  it('the demo password signs in but cannot be set again as a new password', async () => {
    const { rawApp } = buildApp()
    const agent = newAgent(rawApp)
    expect((await agent.post('/api/session').send({ username: demoUsername, password: demoPassword })).status).toBe(200)
    expect((await agent.put('/api/account/password').send({ currentPassword: demoPassword, newPassword: 'brand-new-42' })).status).toBe(204)
    const back = await agent.put('/api/account/password').send({ currentPassword: 'brand-new-42', newPassword: demoPassword })
    expect(back.status).toBe(422)
    expect(back.body.error.details.issue[0].field).toBe('newPassword')
  })
})

describe('QA: profile photo', () => {
  it.each([
    ['SVG declared as PNG', 'image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['SVG as image/svg+xml', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['HTML renamed', 'image/png', Buffer.from('<!doctype html><script>alert(1)</script>')],
    // A declared type that differs from the bytes.
    ['PNG declared as JPEG', 'image/jpeg', png(100)],
    ['PNG declared as text/html', 'text/html', png(100)],
    ['PNG as octet-stream', 'application/octet-stream', png(100)],
    ['RIFF without WEBP', 'image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(20)])],
    ['truncated PNG signature', 'image/png', Buffer.from([0x89, 0x50, 0x4e])]
  ])('%s is refused with 422 and nothing is stored', async (_label, contentType, body) => {
    const { app, store } = buildApp()
    const response = await request(app).put('/api/account/avatar').set('content-type', contentType).send(body)
    expect(response.status).toBe(422)
    expect(store.orgMap.get('default')?.avatar).toBeFalsy()
  })

  it('a PNG polyglot (PNG magic + HTML) is served only as image/png with nosniff and a sandbox CSP', async () => {
    const { app } = buildApp()
    const polyglot = Buffer.concat([png(8), Buffer.from('<html><script>alert(document.cookie)</script></html>')])
    expect((await request(app).put('/api/account/avatar').set('content-type', 'image/png; charset=utf-8').send(polyglot)).status).toBe(200)
    const served = await request(app).get('/api/account/avatar')
    expect(served.headers['content-type']).toBe('image/png')
    expect(served.headers['x-content-type-options']).toBe('nosniff')
    expect(served.headers['content-security-policy']).toContain('sandbox')
    expect(served.headers['cache-control']).toContain('private')
  })

  it("account B never gets A's photo; B without a photo gets 404", async () => {
    const { rawApp } = buildApp()
    const alice = await registerAgent(rawApp, registrationOf('alice'))
    const bob = await registerAgent(rawApp, registrationOf('bob'))
    await alice.put('/api/account/avatar').set('content-type', 'image/png').send(png(64))
    expect((await bob.get('/api/account/avatar')).status).toBe(404)
    const bobAccount = await bob.get('/api/account')
    expect(bobAccount.body.avatarUrl).toBeNull()
  })
})

describe('QA: logs never hold secrets', () => {
  it('sign-in, registration, password change, photo, sign-out and refusals log no password, id, hash, cookie or image bytes', async () => {
    const lineList: string[] = []
    const logger = { info: (line: string) => { lineList.push(line) }, warn: (line: string) => { lineList.push(line) } }
    const store = createMemoryStore()
    const rawApp = createApp({ frontendUrl, enableTestRoute: false }, { store, securityLogger: logger })
    const secretList: string[] = [demoPassword, 'wrong-guess-77', 'Logger-Secret-42', 'Logger-Next-42', 'PHOTO_BYTES_MARKER']

    await newAgent(rawApp).post('/api/session').send({ username: demoUsername, password: 'wrong-guess-77' })
    await newAgent(rawApp).post('/api/session').send({ username: 'ghost', password: 'wrong-guess-77' })
    const agent = newAgent(rawApp)
    const created = await agent.post('/api/account').send({ username: 'logger', email: 'logger@example.com', password: 'Logger-Secret-42' })
    const firstCookie = cookieValueOf(created)
    await agent.put('/api/account/password').send({ currentPassword: 'nope-nope-1', newPassword: 'Logger-Next-42' })
    const changed = await agent.put('/api/account/password').send({ currentPassword: 'Logger-Secret-42', newPassword: 'Logger-Next-42' })
    const secondCookie = cookieValueOf(changed)
    await agent.put('/api/account/avatar').set('content-type', 'image/png').send(Buffer.concat([png(8), Buffer.from('PHOTO_BYTES_MARKER')]))
    await agent.delete('/api/session')
    await request(rawApp).post('/api/session').send({ username: demoUsername, password: demoPassword })
    await request(rawApp).get('/api/account').set('cookie', secondCookie)

    for (const cookie of [firstCookie, secondCookie]) {
      const id = cookie.split('=')[1] ?? ''
      expect(id.length).toBeGreaterThan(20)
      secretList.push(id, hashSessionId(id))
    }
    const text = lineList.join('\n')
    expect(lineList.length).toBeGreaterThan(5)
    for (const secret of secretList) expect(text).not.toContain(secret)
    expect(text).not.toMatch(/scrypt\$/)
    expect(text).not.toMatch(/cr_session/)
    expect(text).not.toMatch(/logger@example\.com/)
    expect(text).not.toMatch(/"username"/)
    for (const line of lineList) {
      const entry = JSON.parse(line) as Record<string, unknown>
      expect(entry.requestId).toEqual(expect.any(String))
      expect(entry.reason).toEqual(expect.any(String))
    }
  })
})
