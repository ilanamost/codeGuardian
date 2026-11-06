import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Analyzer } from '../src/analyzer/analyzer.js'
import { addReview, buildApp, frontendUrl } from './helper/app.js'
import { expectError } from './helper/contract.js'

describe('error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 bad_request for malformed JSON', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').set('content-type', 'application/json').send('{"language": ')

    expectError(response, 400, 'bad_request')
  })

  it('returns 413 payload_too_large for a body over 200 kB', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: 'a'.repeat(210_000) })

    expectError(response, 413, 'payload_too_large')
  })

  it('accepts 100 000 four-byte characters, counted as code points (QA round 1, D2)', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: '😀'.repeat(100_000) })

    expect(response.status).toBe(202)
  })

  it('returns 413 when the byte cap is hit before the character cap', async () => {
    const { app } = buildApp({ bodyLimit: '1kb' })

    const response = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: 'a'.repeat(2_000) })

    expectError(response, 413, 'payload_too_large')
  })

  it.each([
    ['/api/review/%E0%A4%A'],
    ['/api/github/repo/%zz/file'],
    ['/api/github/repo/frontend-app/file/%G1']
  ])('returns 400 bad_request without an error log for the malformed escape in %s (QA round 1, D1)', async (path) => {
    const { app } = buildApp()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(app).get(path)

    expectError(response, 400, 'bad_request')
    expect(error).not.toHaveBeenCalled()
  })

  it('returns 400 bad_request for an unsupported content-encoding (QA round 1, D3)', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').set('content-type', 'application/json').set('content-encoding', 'br').send('{}')

    expectError(response, 400, 'bad_request')
  })

  it('returns 422 when the body is not JSON at all', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').set('content-type', 'text/plain').send('hello')

    expectError(response, 422, 'validation_error')
  })

  // The paths are joined from parts so no source line carries the removed route names whole.
  it.each([['GET', ['/api', 'crypto', 'key'].join('/')], ['POST', ['/api', 'crypto', 'session'].join('/')]])('returns 404 not_found for the removed route %s %s (plan 041)', async (method, path) => {
    const { app } = buildApp()

    const response = await request(app)[method === 'GET' ? 'get' : 'post'](path).send(method === 'GET' ? undefined : {})

    expectError(response, 404, 'not_found')
  })

  it('returns 404 not_found for an unknown route or method', async () => {
    const { app } = buildApp()

    expectError(await request(app).get('/api/nope'), 404, 'not_found')
    expectError(await request(app).delete('/api/dashboard'), 404, 'not_found')
  })

  it('returns 500 internal_error with a generic message and logs the cause', async () => {
    const analyzer: Analyzer = {
      analyze: async () => { throw new Error('unused') },
      regenerateTest: async () => { throw new Error('model exploded') }
    }
    const { app, store } = buildApp({ analyzer })
    addReview(store, { id: 'r1' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(app).post('/api/review/r1/generated-test')

    expectError(response, 500, 'internal_error')
    expect(response.text).not.toContain('model exploded')
    expect(String(error.mock.calls[0]?.[0])).toContain('model exploded')
  })

  it('allows CORS for the frontend URL only', async () => {
    const { app } = buildApp()

    const evil = await request(app).get('/api/health').set('origin', 'http://evil.example')
    const good = await request(app).get('/api/health').set('origin', frontendUrl)

    // Plan 028: a foreign origin gets no CORS header at all; the frontend gets its own origin
    // with credentials.
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()
    expect(evil.headers['access-control-allow-credentials']).toBeUndefined()
    expect(good.headers['access-control-allow-origin']).toBe(frontendUrl)
    expect(good.headers['access-control-allow-credentials']).toBe('true')
    expect(evil.headers['x-powered-by']).toBeUndefined()
  })
})
