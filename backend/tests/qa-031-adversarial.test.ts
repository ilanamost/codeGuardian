import { spawnSync } from 'node:child_process'
import { env, execPath } from 'node:process'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp, registerAgent, registrationOf } from './helper/app.js'

// QA plan 031 (adversarial), trimmed by plan 032: the app sends no email any more, so only the
// input checks, the rate limit and the startup checks are left.

const validRequest = {
  issueType: 'review_failed',
  email: 'john@company.com',
  reviewId: 'r4',
  priority: 'high',
  description: 'The review stays failed after a retry.'
}

describe('QA 031: hostile input on POST /api/support-request', () => {
  it.each([
    ['U+0085 (NEL) in email', { email: 'john\u0085Bcc:evil@company.com' }],
    ['U+0085 (NEL) at the end of email', { email: 'john@company.com\u0085' }],
    ['BEL control in email', { email: 'jo\u0007hn@company.com' }],
    ['a NUL character in the description', { description: 'Broken\u0000 header padding' }]
  ])('%s: 422 and nothing is stored', async (_label, override) => {
    const { app, store } = buildApp()

    const response = await request(app).post('/api/support-request').send({ ...validRequest, ...override })

    expect(response.status).toBe(422)
    expect(store.state.supportRequestList).toHaveLength(0)
  })

  it.each([
    ['CRLF + Bcc', 'Broken.\r\nBcc: evil@attacker.example\r\nSubject: pwned'],
    ['bare CR + Bcc', 'Broken.\rBcc: evil@attacker.example and more'],
    ['U+2028 / U+2029', 'Broken. Bcc: evil@attacker.example Cc: x@y.z'],
    ['2000 characters of line breaks and header text', ('x\r\nBcc: e@a.b\r\n').repeat(200).slice(0, 2000)]
  ])('a description with %s is stored as is (201, never a 500)', async (_label, description) => {
    const { app, store } = buildApp()

    const response = await request(app).post('/api/support-request').send({ ...validRequest, description })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ ticket: expect.stringMatching(/^SUP-\d{4}$/) })
    expect(store.state.supportRequestList[0]?.description).toBe(description.trim())
  })
})

describe('QA 031: rate limit under pressure', () => {
  it('12 parallel requests from one account: exactly 5 are stored, 7 get 429 with Retry-After', async () => {
    const { app, store } = buildApp()

    const responseList = await Promise.all(Array.from({ length: 12 }, () => request(app).post('/api/support-request').send(validRequest)))

    const statusList = responseList.map((response) => response.status)
    expect(statusList.filter((status) => status === 201)).toHaveLength(5)
    expect(statusList.filter((status) => status === 429)).toHaveLength(7)
    for (const response of responseList.filter((item) => item.status === 429)) {
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
    }
    expect(store.state.supportRequestList).toHaveLength(5)
  })

  it('a 429 does not extend the window: repeated 429s keep the same Retry-After at a fixed clock', async () => {
    const { app } = buildApp()
    for (let index = 0; index < 5; index += 1) await request(app).post('/api/support-request').send(validRequest)

    const first = await request(app).post('/api/support-request').send(validRequest)
    const second = await request(app).post('/api/support-request').send(validRequest)

    expect(first.status).toBe(429)
    expect(second.status).toBe(429)
    expect(second.headers['retry-after']).toBe(first.headers['retry-after'])
  })

  it('another account sends 5 in parallel while the first account is limited', async () => {
    const { app, rawApp } = buildApp()
    for (let index = 0; index < 6; index += 1) await request(app).post('/api/support-request').send(validRequest)
    const other = await registerAgent(rawApp, registrationOf('qa-031-other'))

    const responseList = await Promise.all(Array.from({ length: 5 }, () => other.post('/api/support-request').send(validRequest)))

    expect(responseList.map((response) => response.status)).toEqual([201, 201, 201, 201, 201])
    expect((await other.post('/api/support-request').send(validRequest)).status).toBe(429)
  })
})

// Starts the real entry point (src/index.ts) with an explicit environment and no settings file,
// on a loopback port, and stops it after its startup lines.
function startBackend(extra: Record<string, string>) {
  const base: Record<string, string> = { PATH: env.PATH ?? '', SystemRoot: env.SystemRoot ?? '', PORT: '3199', FRONTEND_URL: 'http://localhost:5173', DATABASE_URL: '' }
  return spawnSync(execPath, ['--import', 'tsx', '--input-type=module', '-e', `setTimeout(() => process.exit(0), 2500); await import('./src/index.ts')`], {
    cwd: new URL('..', import.meta.url),
    env: { ...base, ...extra },
    encoding: 'utf8',
    timeout: 20_000
  })
}

describe('QA 031 / plan 032: startup with the real entry point', () => {
  it('starts with no mail line at all, and ignores the removed mail settings (plan 032)', () => {
    const result = startBackend({ SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'qa-placeholder', MAIL_FAKE: 'yes' })
    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toMatch(/listening/i)
    expect(output).not.toMatch(/mail|smtp/i)
  }, 30_000)

  it('an invalid setting stops the server with one structured line naming the setting, never the value', () => {
    const result = startBackend({ GITHUB_FAKE: 'qa-invalid-placeholder' })
    const output = `${result.stdout}\n${result.stderr}`
    expect(result.status).not.toBe(0)
    expect(output).toMatch(/"operation":"startup"[^\n]*GITHUB_FAKE/)
    expect(output).not.toContain('qa-invalid-placeholder')
    expect(output).not.toMatch(/listening/i)
  }, 30_000)
})
