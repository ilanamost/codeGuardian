import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/store/memory-store.js'
import { addReview, buildApp } from './helper/app.js'

describe('memory store', () => {
  it('reset() brings back the seed after writes: no reviews, default settings', async () => {
    const store = createMemoryStore()
    const { app } = buildApp({ store })
    await request(app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: 'x' })
    await request(app).put('/api/settings').send({ ...store.state.settings, theme: 'dark' })

    store.reset()

    expect((await request(app).get('/api/review')).body).toEqual([])
    expect((await request(app).get('/api/settings')).body.theme).toBe('light')
  })

  it('gives two apps independent stores', async () => {
    const first = buildApp()
    const second = buildApp()

    await request(first.app).post('/api/review').send({ source_type: 'snippet', language: 'Go', content: 'x' })

    expect((await request(first.app).get('/api/review')).body).toHaveLength(1)
    expect((await request(second.app).get('/api/review')).body).toEqual([])
  })

  it('starts with no reviews, no GitHub connection, the account and the default settings', async () => {
    const store = createMemoryStore()
    const { app } = buildApp({ store })

    expect(store.state.reviewList).toEqual([])
    // Plan 030: only the connected login and name are stored; none at the start.
    expect(store.state.github).toEqual({ connection: null })
    expect((await request(app).get('/api/github/repo')).status).toBe(409)
    expect(store.state.account.email).toBe('john@company.com')
    expect(store.state.settings.theme).toBe('light')
  })

  it('reset() keeps no review that was put in through the store', () => {
    const store = createMemoryStore()
    addReview(store, { id: 'r1' })

    store.reset()

    expect(store.state.reviewList).toEqual([])
  })
})
