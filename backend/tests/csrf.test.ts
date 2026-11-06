import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { addReview, buildApp, frontendUrl, signInCookie, validSettings } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 028, Scope 6 and 7: the CSRF header and Origin checks, and CORS with credentials.

const newReview = { source_type: 'snippet', language: 'Go', content: 'x' }

describe('CSRF protection', () => {
  it.each([
    ['POST', '/api/review', '/api/review', newReview],
    ['PUT', '/api/settings', '/api/settings', validSettings],
    ['PATCH', '/api/review/r1', '/api/review/{id}', { name: 'renamed' }],
    ['DELETE', '/api/review/r1', '/api/review/{id}', undefined],
    ['POST', '/api/github/connect', '/api/github/connect', { username: 'example-user' }]
  ])('%s %s without X-CSRF-Protection gets 403 and changes nothing', async (method, url, path, body) => {
    const { rawApp, store } = buildApp()
    addReview(store, { id: 'r1' })
    const cookie = await signInCookie(rawApp)
    const before = JSON.stringify(store.state)

    const call = (request(rawApp) as unknown as Record<string, (url: string) => request.Test>)[method.toLowerCase()]?.(url)
    const response = await call!.set('cookie', cookie).send(body)

    expectError(response, 403, 'forbidden')
    expectContract(response, path, method)
    expect(JSON.stringify(store.state)).toBe(before)
  })

  it.each(['0', 'true', ''])('refuses the header with the value %j', async (value) => {
    const { app } = buildApp()

    expectError(await request(app).post('/api/review').set('X-CSRF-Protection', value).send(newReview), 403, 'forbidden')
  })

  it('refuses a foreign Origin even with the header, and accepts the frontend Origin and no Origin', async () => {
    const { app, store } = buildApp()

    const foreign = await request(app).post('/api/review').set('origin', 'http://evil.example').send(newReview)
    const nullOrigin = await request(app).post('/api/review').set('origin', 'null').send(newReview)
    const lookalike = await request(app).post('/api/review').set('origin', `${frontendUrl}.evil.example`).send(newReview)

    for (const response of [foreign, nullOrigin, lookalike]) expectError(response, 403, 'forbidden')
    expect(store.state.reviewList).toEqual([])
    expect((await request(app).post('/api/review').set('origin', frontendUrl).send(newReview)).status).toBe(202)
    expect((await request(app).post('/api/review').send(newReview)).status).toBe(202)
  })

  it('GET needs no header', async () => {
    const { rawApp } = buildApp()
    const cookie = await signInCookie(rawApp)

    expect((await request(rawApp).get('/api/review').set('cookie', cookie)).status).toBe(200)
  })

  it('is checked before the session: a refused request is 403 even without a cookie', async () => {
    const { rawApp } = buildApp()

    expectError(await request(rawApp).post('/api/review').send(newReview), 403, 'forbidden')
  })
})

describe('CORS with credentials', () => {
  it('the preflight from FRONTEND_URL allows credentials and the CSRF header', async () => {
    const { rawApp } = buildApp()

    const response = await request(rawApp).options('/api/session').set('origin', frontendUrl)
      .set('access-control-request-method', 'POST').set('access-control-request-headers', 'content-type,x-csrf-protection')

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(frontendUrl)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-headers']).toBe('Content-Type,X-CSRF-Protection')
  })

  it('a foreign origin gets no Access-Control-Allow-Origin for itself and no credentials', async () => {
    const { rawApp } = buildApp()

    const preflight = await request(rawApp).options('/api/session').set('origin', 'http://evil.example').set('access-control-request-method', 'POST')
    const simple = await request(rawApp).get('/api/health').set('origin', 'http://evil.example')

    for (const response of [preflight, simple]) {
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    }
  })

  it('exposes Retry-After to the frontend, so the login page can show the wait time', async () => {
    const { rawApp } = buildApp()

    const response = await request(rawApp).get('/api/health').set('origin', frontendUrl)

    expect(response.headers['access-control-expose-headers']).toBe('Retry-After')
  })
})

