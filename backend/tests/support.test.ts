import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp, fixedNow, plantSession, registerAgent, registrationOf, type TestApp } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

const validRequest = {
  issueType: 'review_failed',
  email: ' john@company.com ',
  reviewId: 'r4',
  priority: 'high',
  description: 'The review stays failed after a retry.'
}

describe('POST /api/support-request', () => {
  it('creates a ticket with 201 and keeps the trimmed request in the store', async () => {
    const { app, store } = buildApp()

    const response = await request(app).post('/api/support-request').send(validRequest)

    expectContract(response, '/api/support-request', 'POST')
    expect(response.status).toBe(201)
    // Contract 0.11.0 (plan 032): exactly { ticket }, no `emailed`.
    expect(response.body).toEqual({ ticket: expect.stringMatching(/^SUP-\d{4}$/) })
    expect(store.state.supportRequestList).toHaveLength(1)
    expect(store.state.supportRequestList[0]).toMatchObject({ ticket: response.body.ticket, email: 'john@company.com' })
  })

  it('gives each request its own ticket', async () => {
    const { app } = buildApp()

    const first = await request(app).post('/api/support-request').send(validRequest)
    const second = await request(app).post('/api/support-request').send(validRequest)

    expect(first.body.ticket).not.toBe(second.body.ticket)
  })

  it('accepts an empty reviewId', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/support-request').send({ ...validRequest, reviewId: '' })

    expect(response.status).toBe(201)
  })

  it('keeps header-looking text and markup of the description as plain stored text', async () => {
    const { app, store } = buildApp()
    const description = 'Broken.\r\nBcc: x@y.z\r\n<b>bold</b>'

    const response = await request(app).post('/api/support-request').send({ ...validRequest, description })

    expect(response.status).toBe(201)
    expect(store.state.supportRequestList[0]?.description).toBe(description)
  })

  it.each([
    ['a description under 10 characters', { ...validRequest, description: 'too short' }],
    ['a description that is only padded to 10', { ...validRequest, description: '   short    ' }],
    ['a description over 2000 characters', { ...validRequest, description: 'd'.repeat(2001) }],
    ['a bad email', { ...validRequest, email: 'john@company' }],
    ['a bad reviewId', { ...validRequest, reviewId: 'r4; drop' }],
    ['an empty issueType', { ...validRequest, issueType: '' }],
    ['an unknown priority', { ...validRequest, priority: 'urgent' }]
  ])('returns 422 for %s', async (_label, body) => {
    const { app, store } = buildApp()

    const response = await request(app).post('/api/support-request').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/support-request', 'POST')
    expect(store.state.supportRequestList).toHaveLength(0)
  })
})

// Plan 031 (kept by plan 032): the email and reviewId refuse line breaks, and the email also
// refuses every other control or line-separator character (QA 031 F1).
describe('POST /api/support-request input checks (plan 031)', () => {
  it.each([
    ['email', { email: 'john@company.com\r\nBcc: x@y.z' }],
    ['email', { email: 'john@company.com\nBcc: x@y.z' }],
    ['reviewId', { reviewId: 'r4\r\nBcc: x@y.z' }]
  ])('refuses CR/LF in %s with 422 and stores nothing', async (_field, override) => {
    const { app, store } = buildApp()

    const response = await request(app).post('/api/support-request').send({ ...validRequest, ...override })

    expectError(response, 422, 'validation_error')
    expect(store.state.supportRequestList).toHaveLength(0)
  })

  // QA 031 F1: a stored address never holds a control or line-separator character. Built with
  // fromCharCode so the characters stay visible in the source.
  const char = (code: number) => String.fromCharCode(code)
  it.each([
    ['NUL U+0000', char(0x00)],
    ['BEL U+0007', char(0x07)],
    ['backspace U+0008', char(0x08)],
    ['ESC U+001B', char(0x1b)],
    ['DEL U+007F', char(0x7f)],
    ['NEL U+0085', char(0x85)],
    ['line separator U+2028', char(0x2028)],
    ['paragraph separator U+2029', char(0x2029)],
    ['CR', '\r'],
    ['LF', '\n'],
    ['tab', '\t']
  ])('refuses %s inside the email with 422 and the email issue message; nothing is stored', async (_label, unsafe) => {
    const { app, store } = buildApp()

    const response = await request(app).post('/api/support-request').send({ ...validRequest, email: `jo${unsafe}hn@company.com` })

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/support-request', 'POST')
    const issueList = response.body.error.details.issue as { field: string, message: string }[]
    expect(issueList.every((issue) => issue.field === 'email')).toBe(true)
    // NUL keeps its own message (storableText); every other character gets the email message once.
    if (unsafe !== char(0x00)) expect(issueList).toEqual([{ field: 'email', message: 'must be a valid email address' }])
    expect(store.state.supportRequestList).toHaveLength(0)
  })

  it.each([
    ['NEL U+0085 at the end', char(0x85)],
    ['BEL U+0007 at the end', char(0x07)]
  ])('refuses %s of the email too (trim does not remove it)', async (_label, unsafe) => {
    const { app } = buildApp()

    const response = await request(app).post('/api/support-request').send({ ...validRequest, email: `john@company.com${unsafe}` })

    expectError(response, 422, 'validation_error')
  })

  it('stores the trimmed address of a valid email with plus, dot and hyphen', async () => {
    const { app, store } = buildApp()

    await request(app).post('/api/support-request').send({ ...validRequest, email: ' john.o-brien+tag@company.co.uk ' })

    expect(store.state.supportRequestList[0]?.email).toBe('john.o-brien+tag@company.co.uk')
  })
})

describe('POST /api/support-request auth (plan 031)', () => {
  it('answers 401 without a session and stores nothing', async () => {
    const { rawApp, store } = buildApp()

    const response = await request(rawApp).post('/api/support-request').set('X-CSRF-Protection', '1').send(validRequest)

    expectError(response, 401, 'unauthorized')
    expect(store.state.supportRequestList).toHaveLength(0)
  })

  it('answers 403 without the CSRF header and stores nothing', async () => {
    const { rawApp, store } = buildApp()

    const response = await request(rawApp).post('/api/support-request').set('Cookie', `cr_session=${plantSession(store)}`).send(validRequest)

    expectError(response, 403, 'forbidden')
    expect(store.state.supportRequestList).toHaveLength(0)
  })

  it('answers 422 for an unknown field, including the removed `emailed` (plan 032)', async () => {
    const { app } = buildApp()

    const bcc = await request(app).post('/api/support-request').send({ ...validRequest, bcc: 'x@y.z' })
    const emailed = await request(app).post('/api/support-request').send({ ...validRequest, emailed: true })

    expectError(bcc, 422, 'validation_error')
    expectError(emailed, 422, 'validation_error')
  })
})

describe('POST /api/support-request rate limit, 5 per account per hour (plan 031, kept by plan 032)', () => {
  async function sendFive(app: TestApp) {
    for (let index = 0; index < 5; index += 1) {
      const response = await request(app).post('/api/support-request').send(validRequest)
      expect(response.status).toBe(201)
    }
  }

  it('answers the sixth request with 429, Retry-After and details.retryAfterSecond; nothing is stored', async () => {
    const { app, store } = buildApp()
    await sendFive(app)

    const response = await request(app).post('/api/support-request').send(validRequest)

    expectError(response, 429, 'rate_limited')
    expectContract(response, '/api/support-request', 'POST')
    expect(response.headers['retry-after']).toBe('3600')
    expect(response.body.error.details).toEqual({ retryAfterSecond: 3600 })
    expect(store.state.supportRequestList).toHaveLength(5)
  })

  it('does not limit another account', async () => {
    const { app, rawApp } = buildApp()
    await sendFive(app)

    const other = await registerAgent(rawApp, registrationOf('support-other'))
    const response = await other.post('/api/support-request').send(validRequest)

    expect(response.status).toBe(201)
  })

  it('does not count a 422', async () => {
    const { app } = buildApp()
    for (let index = 0; index < 6; index += 1) await request(app).post('/api/support-request').send({ ...validRequest, priority: 'urgent' })

    await sendFive(app)
  })

  it('accepts requests again once the hour has passed', async () => {
    let time = fixedNow
    const { app } = buildApp({ now: () => time })
    await sendFive(app)
    expect((await request(app).post('/api/support-request').send(validRequest)).status).toBe(429)

    time += 60 * 60 * 1000 + 1

    expect((await request(app).post('/api/support-request').send(validRequest)).status).toBe(201)
  })

  it('starts again after the test reset', async () => {
    const { app } = buildApp({}, true)
    await sendFive(app)

    expect((await request(app).post('/api/test/reset')).status).toBe(204)

    expect((await request(app).post('/api/support-request').send(validRequest)).status).toBe(201)
  })
})
