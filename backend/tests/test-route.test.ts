import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp, waitForStatus } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'
import { fakeGithubClient, fakeUser } from './helper/github.js'

// The seeded demo password, the same as the frontend's mock password. Not a secret.
const seededPassword = 'mock-password'
const supportRequest = {
  issueType: 'review_failed',
  email: 'john@company.com',
  reviewId: 'r4',
  priority: 'high',
  description: 'The review stays failed after a retry.'
}
const newReview = { source_type: 'snippet', title: 'Reset me', language: 'TypeScript', content: 'const value = 1\n' }

describe('POST /api/test/reset with the test route on', () => {
  it('returns 204 with no body and matches the contract', async () => {
    const { app } = buildApp({}, true)

    const response = await request(app).post('/api/test/reset')

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expectContract(response, '/api/test/reset', 'POST')
  })

  it('restores the seed (no reviews) after writes to every part of the store', async () => {
    const { app, store } = buildApp({ githubClient: fakeGithubClient() }, true)
    const seedSettings = (await request(app).get('/api/settings')).body
    const firstTicket = (await request(app).post('/api/support-request').send(supportRequest)).body.ticket
    const created = await request(app).post('/api/review').send(newReview)
    await waitForStatus(app, created.body.id, 'completed')
    await request(app).put('/api/settings').send({ ...seedSettings, theme: 'dark' })
    expect((await request(app).post('/api/github/connect').send({ username: fakeUser })).status).toBe(200)
    expect((await request(app).put('/api/account/password')
      .send({ currentPassword: seededPassword, newPassword: 'another-pass-1' })).status).toBe(204)

    expect((await request(app).post('/api/test/reset')).status).toBe(204)

    expect(store.state.github.connection).toBeNull()

    expectError(await request(app).get(`/api/review/${created.body.id}`), 404, 'not_found')
    expect((await request(app).get('/api/review')).body).toEqual([])
    expect((await request(app).get('/api/dashboard')).body.statList[0].value).toBe(0)
    expect((await request(app).get('/api/settings')).body).toEqual(seedSettings)
    expect((await request(app).put('/api/account/password')
      .send({ currentPassword: seededPassword, newPassword: 'another-pass-2' })).status).toBe(204)
    expect((await request(app).post('/api/support-request').send(supportRequest)).body.ticket).toBe(firstTicket)
  })

  it('serves only POST: another method gets the normal 404', async () => {
    const { app } = buildApp({}, true)

    expectError(await request(app).get('/api/test/reset'), 404, 'not_found')
  })
})

describe('POST /api/test/reset with the test route off (the default)', () => {
  it('does not exist: the request gets the normal 404 not_found and the store is untouched', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/api/review').send(newReview)

    const response = await request(app).post('/api/test/reset')

    expectError(response, 404, 'not_found')
    expect(response.body.error.message).toBe('No route for POST /api/test/reset.')
    expect((await request(app).get(`/api/review/${created.body.id}`)).status).toBe(200)
  })
})
