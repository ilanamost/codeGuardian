import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp, validSettings } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

describe('GET /api/settings', () => {
  it('returns the frontend defaults', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/settings')

    expectContract(response, '/api/settings', 'GET')
    expect(response.body).toEqual({
      notification: { reviewCompleted: true, reviewFailed: true, criticalFinding: true, email: false },
      theme: 'light',
      editorFontSize: 'medium',
      historyDensity: 'comfortable',
      reviewFocus: 'all',
      strictness: 'balanced',
      explanation: 'detailed',
      generatedTest: true,
      language: 'auto'
    })
  })
})

describe('PUT /api/settings', () => {
  it('saves with 204, and GET then returns the saved values', async () => {
    const { app } = buildApp()

    const response = await request(app).put('/api/settings').send(validSettings)

    expectContract(response, '/api/settings', 'PUT')
    expect(response.status).toBe(204)
    expect((await request(app).get('/api/settings')).body).toEqual(validSettings)
  })

  it.each([
    ['an invalid enum', { ...validSettings, theme: 'neon' }],
    ['a missing field', { ...validSettings, strictness: undefined }],
    ['a non-boolean notification', { ...validSettings, notification: { ...validSettings.notification, email: 'yes' } }],
    ['an unknown field', { ...validSettings, extra: 1 }],
    ['a non-object body', [1, 2]]
  ])('returns 422 for %s and keeps the old settings', async (_label, body) => {
    const { app } = buildApp()

    const response = await request(app).put('/api/settings').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/settings', 'PUT')
    expect((await request(app).get('/api/settings')).body.theme).toBe('light')
  })
})
