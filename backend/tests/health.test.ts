import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { buildApp, frontendUrl } from './helper/app.js'
import { expectContract } from './helper/contract.js'

describe('app', () => {
  it('reports health', async () => {
    const response = await request(createApp({ frontendUrl, enableTestRoute: false })).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', analyzer: 'stub', githubOAuth: false })
    expectContract(response, '/api/health', 'GET')
  })

  it('needs no session (plan 028)', async () => {
    const response = await request(createApp({ frontendUrl, enableTestRoute: false })).get('/api/health').set('cookie', 'cr_session=tampered')

    expect(response.status).toBe(200)
  })

  it('returns the stable error shape for an unknown route: 401 without a session, 404 with one', async () => {
    const signedOut = await request(createApp({ frontendUrl, enableTestRoute: false })).get('/api/nope')
    const signedIn = await request(buildApp().app).get('/api/nope')

    expect(signedOut.status).toBe(401)
    expect(signedOut.body.error.code).toBe('unauthorized')
    expect(signedIn.status).toBe(404)
    expect(signedIn.body.error.code).toBe('not_found')
    expect(typeof signedIn.body.requestId).toBe('string')
  })
})
