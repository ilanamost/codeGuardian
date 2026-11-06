import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { Analyzer } from '../src/analyzer/analyzer.js'
import { addReview, buildApp, fixedNow, waitForStatus } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

const newReview = { source_type: 'snippet', title: 'Debug helper', language: 'TypeScript', content: 'const value: any = 1\nconsole.log(value)\n' }
const saveBody = { name: 'My review', language: 'JavaScript', code: 'const edited = 1\n' }

describe('GET /api/review', () => {
  it('starts empty: a fresh store has no reviews', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/review')

    expectContract(response, '/api/review', 'GET')
    expect(response.body).toEqual([])
  })

  it('lists reviews created through the API newest first with severity counts', async () => {
    const { app } = buildApp()
    const first = await request(app).post('/api/review').send({ ...newReview, title: 'First', content: 'eval(x)\nconst a: any = 1\n' })
    const second = await request(app).post('/api/review').send(newReview)
    await waitForStatus(app, first.body.id, 'completed')
    await waitForStatus(app, second.body.id, 'completed')

    const response = await request(app).get('/api/review')

    expectContract(response, '/api/review', 'GET')
    expect(response.body.map((row: { id: string }) => row.id)).toEqual([second.body.id, first.body.id])
    expect(response.body[1]).toEqual({
      id: first.body.id, title: 'First', language: 'TypeScript', timeAgo: 'just now',
      status: 'completed', high: 1, medium: 1, low: 0
    })
  })

  it('puts a created review first', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    const created = await request(app).post('/api/review').send(newReview)

    const response = await request(app).get('/api/review')

    expect(response.body[0]).toMatchObject({ id: created.body.id, title: 'Debug helper', timeAgo: 'just now' })
  })

  it('replaces the title with the saved name', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r2' })
    await request(app).put('/api/review/r2').send(saveBody)

    const response = await request(app).get('/api/review')

    expect(response.body.find((row: { id: string }) => row.id === 'r2').title).toBe('My review')
  })
})

describe('GET /api/review/:id', () => {
  it('returns the review with savedAt null before any save', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', title: 'Authentication Service' })

    const response = await request(app).get('/api/review/r1')

    expectContract(response, '/api/review/{id}', 'GET')
    expect(response.body).toMatchObject({ title: 'Authentication Service', status: 'completed', savedAt: null })
    expect(response.body.finding[0].category).toBe('security')
    expect(response.body.generatedTest).toHaveLength(2)
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/review/nope')

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/review/{id}', 'GET')
  })

  it('returns 422 for an id with characters outside [A-Za-z0-9-]', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/review/bad_id!')

    expectError(response, 422, 'validation_error')
  })
})

describe('POST /api/review', () => {
  it('accepts the review as pending, then the stub analyzer completes it', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').send(newReview)

    expectContract(response, '/api/review', 'POST')
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({ title: 'Debug helper', status: 'pending', finding: [] })
    expect(response.body.id).toMatch(/^[A-Za-z0-9-]+$/)

    const done = await waitForStatus(app, response.body.id, 'completed')
    expectContract(done, '/api/review/{id}', 'GET')
    expect(done.body.finding.map((item: { message: string }) => item.message)).toEqual(['Untyped value (any)', 'Leftover console call'])
    expect(done.body.finding.map((item: { category: string }) => item.category)).toEqual(['maintainability', 'readability'])
    expect(done.body.finding[0].detail).toContain('Stub rule')
    expect(done.body.generatedTest).toHaveLength(1)
  })

  it('defaults the title when none is given', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').send({ ...newReview, title: undefined })

    expect(response.body.title).toBe('New review')
  })

  it('marks the review failed when the analyzer throws', async () => {
    const analyzer: Analyzer = {
      analyze: async () => { throw new Error('analyzer down') },
      regenerateTest: async (fileList) => fileList
    }
    const { app } = buildApp({ analyzer })
    const errorLog: string[] = []
    const original = console.error
    console.error = (line: string) => { errorLog.push(line) }

    try {
      const response = await request(app).post('/api/review').send(newReview)
      await waitForStatus(app, response.body.id, 'failed')
    } finally {
      console.error = original
    }

    expect(errorLog.join('\n')).toContain('review.analyze')
  })

  it.each([
    ['a missing language', { source_type: 'snippet', content: 'x' }],
    ['empty content', { ...newReview, content: '' }],
    ['blank content', { ...newReview, content: '   \n ' }],
    ['content over 100 000 characters', { ...newReview, content: 'a'.repeat(100001) }],
    ['an unknown source_type', { ...newReview, source_type: 'github_url' }],
    ['a title over 120 characters', { ...newReview, title: 't'.repeat(121) }],
    ['an unknown field', { ...newReview, extra: true }]
  ])('returns 422 for %s', async (_label, body) => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/review', 'POST')
    expect(Array.isArray(response.body.error.details.issue)).toBe(true)
  })
})

describe('PUT /api/review/:id', () => {
  it('saves the edit, and GET then shows it with savedAt', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    const response = await request(app).put('/api/review/r1').send(saveBody)

    expectContract(response, '/api/review/{id}', 'PUT')
    expect(response.body).toEqual({ ...saveBody, savedAt: '2026-10-22T10:00:00.000Z' })

    const detail = await request(app).get('/api/review/r1')
    expect(detail.body).toMatchObject({ title: 'My review', language: 'JavaScript', content: 'const edited = 1\n', savedAt: '2026-10-22T10:00:00.000Z' })
  })

  it('keeps the earlier saved name when a later save has none', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    await request(app).put('/api/review/r1').send(saveBody)

    const response = await request(app).put('/api/review/r1').send({ language: 'Go', code: 'package main\n' })

    expect(response.body.name).toBe('My review')
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp()

    const response = await request(app).put('/api/review/nope').send(saveBody)

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/review/{id}', 'PUT')
  })

  it.each([
    ['an 81-character name', { ...saveBody, name: 'n'.repeat(81) }],
    ['a blank name', { ...saveBody, name: '   ' }],
    ['empty code', { ...saveBody, code: '' }],
    ['a missing language', { name: 'x', code: 'y' }]
  ])('returns 422 for %s', async (_label, body) => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    const response = await request(app).put('/api/review/r1').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/review/{id}', 'PUT')
  })
})

describe('PATCH /api/review/:id', () => {
  it('renames a saved review and the list shows the new title', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r3' })
    await request(app).put('/api/review/r3').send(saveBody)

    const response = await request(app).patch('/api/review/r3').send({ name: 'Renamed' })

    expectContract(response, '/api/review/{id}', 'PATCH')
    expect(response.body.name).toBe('Renamed')
    const list = await request(app).get('/api/review')
    expect(list.body.find((row: { id: string }) => row.id === 'r3').title).toBe('Renamed')
  })

  it('returns 404 for a review that was never saved', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r3' })

    const response = await request(app).patch('/api/review/r3').send({ name: 'Renamed' })

    expectError(response, 404, 'not_found')
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp()

    const response = await request(app).patch('/api/review/nope').send({ name: 'Renamed' })

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/review/{id}', 'PATCH')
  })

  it.each([
    ['an empty name', { name: '' }],
    ['an 81-character name', { name: 'n'.repeat(81) }],
    ['a missing name', {}]
  ])('returns 422 for %s', async (_label, body) => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r3' })
    await request(app).put('/api/review/r3').send(saveBody)

    const response = await request(app).patch('/api/review/r3').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/review/{id}', 'PATCH')
  })
})

describe('DELETE /api/review/:id', () => {
  it('deletes the review: 204, gone from the list, GET 404, second delete 404', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r4' })

    const response = await request(app).delete('/api/review/r4')

    expectContract(response, '/api/review/{id}', 'DELETE')
    expect(response.status).toBe(204)
    const list = await request(app).get('/api/review')
    expect(list.body.map((row: { id: string }) => row.id)).not.toContain('r4')
    expectError(await request(app).get('/api/review/r4'), 404, 'not_found')
    expectError(await request(app).put('/api/review/r4').send(saveBody), 404, 'not_found')
    const second = await request(app).delete('/api/review/r4')
    expectError(second, 404, 'not_found')
    expectContract(second, '/api/review/{id}', 'DELETE')
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp()

    expectError(await request(app).delete('/api/review/nope'), 404, 'not_found')
  })
})

describe('POST /api/review/:id/generated-test', () => {
  it('returns the regenerated files and GET shows them', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })
    const before = await request(app).get('/api/review/r1')

    const response = await request(app).post('/api/review/r1/generated-test')

    expectContract(response, '/api/review/{id}/generated-test', 'POST')
    expect(response.body[0].code).toBe(before.body.generatedTest[0].altCode)
    const after = await request(app).get('/api/review/r1')
    expect(after.body.generatedTest).toEqual(response.body)
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review/nope/generated-test')

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/review/{id}/generated-test', 'POST')
  })

  it('returns 409 for a review that is not completed', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r7', status: 'pending', findingCount: [], finding: [], suggestion: [], generatedTest: [] })

    const response = await request(app).post('/api/review/r7/generated-test')

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/review/{id}/generated-test', 'POST')
  })
})

describe('POST /api/review/:id/run', () => {
  const runBody = { name: 'Run me', language: 'TypeScript', code: 'eval(x)\nconst a: any = 1\n' }
  const day = 86_400_000

  it('saves the edit and accepts the same review as pending with emptied results', async () => {
    const { app, store } = buildApp()
    const record = addReview(store, { id: 'r1', createdAt: fixedNow - 3 * day })

    const response = await request(app).post('/api/review/r1/run').send(runBody)

    expectContract(response, '/api/review/{id}/run', 'POST')
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      id: 'r1', title: 'Run me', status: 'pending', language: 'TypeScript', content: runBody.code,
      analyzedContent: runBody.code, analyzedLanguage: 'TypeScript', analyzedAgo: 'just now',
      findingCount: [], finding: [], suggestion: [], generatedTest: [],
      savedAt: '2026-10-22T10:00:00.000Z'
    })
    expect(record.createdAt).toBe(fixedNow - 3 * day)
    expect(record.analyzedAt).toBe(fixedNow)
  })

  it('completes the same id with new results for the sent code', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    await request(app).post('/api/review/r1/run').send(runBody)
    const done = await waitForStatus(app, 'r1', 'completed')

    expectContract(done, '/api/review/{id}', 'GET')
    const messageList = done.body.finding.map((item: { message: string }) => item.message)
    expect(messageList).not.toContain('Injection')
    expect(messageList).toContain('Untyped value (any)')
    expect(done.body).toMatchObject({ content: runBody.code, analyzedContent: runBody.code, analyzedLanguage: 'TypeScript' })
    const list = await request(app).get('/api/review')
    expect(list.body.map((row: { id: string }) => row.id)).toEqual(['r1'])
  })

  it('keeps the History timeAgo on the creation time and restarts analyzedAgo', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', createdAt: fixedNow - 3 * day })

    await request(app).post('/api/review/r1/run').send(runBody)

    const list = await request(app).get('/api/review')
    const detail = await request(app).get('/api/review/r1')
    expect(list.body[0].timeAgo).not.toBe('just now')
    expect(detail.body.analyzedAgo).toBe('just now')
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review/nope/run').send(runBody)

    expectError(response, 404, 'not_found')
    expectContract(response, '/api/review/{id}/run', 'POST')
  })

  it.each(['pending', 'queued', 'in_progress'] as const)('returns 409 for a %s review and changes nothing', async (status) => {
    const { app, store } = buildApp()
    const record = addReview(store, { id: 'r1', status })

    const response = await request(app).post('/api/review/r1/run').send(runBody)

    expectError(response, 409, 'conflict')
    expectContract(response, '/api/review/{id}/run', 'POST')
    expect(record.saved).toBeNull()
    expect(record.run).toBe(0)
  })

  it.each(['completed', 'failed', 'cancelled'] as const)('runs a %s review again', async (status) => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', status })

    const response = await request(app).post('/api/review/r1/run').send(runBody)

    expect(response.status).toBe(202)
    await waitForStatus(app, 'r1', 'completed')
  })

  it('returns 413 for a body over 200 kB', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1' })

    const response = await request(app).post('/api/review/r1/run').send({ ...runBody, code: 'a'.repeat(210_000) })

    expectError(response, 413, 'payload_too_large')
    expectContract(response, '/api/review/{id}/run', 'POST')
  })

  it.each([
    ['empty code', { ...runBody, code: '' }],
    ['blank code', { ...runBody, code: '   \n' }],
    ['code over 100 000 characters', { ...runBody, code: 'a'.repeat(100_001) }],
    ['a missing language', { code: 'x' }],
    ['an 81-character name', { ...runBody, name: 'n'.repeat(81) }],
    ['an unknown field', { ...runBody, extra: true }]
  ])('returns 422 for %s and changes nothing', async (_label, body) => {
    const { app, store } = buildApp()
    const record = addReview(store, { id: 'r1' })

    const response = await request(app).post('/api/review/r1/run').send(body)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/review/{id}/run', 'POST')
    expect(record.review.status).toBe('completed')
    expect(record.saved).toBeNull()
  })

  it('returns 422 for an id with characters outside [A-Za-z0-9-]', async () => {
    const { app } = buildApp()

    const response = await request(app).post('/api/review/bad_id/run').send(runBody)

    expectError(response, 422, 'validation_error')
  })

  // The 409 guard normally prevents overlapping runs. These cover a review that left the
  // unfinished states while its analysis was still in flight (defense in depth).
  it('discards the result of an older run that finishes after a newer run started', async () => {
    const releaseList: Array<() => void> = []
    let call = 0
    const analyzer: Analyzer = {
      analyze: async (input) => {
        call += 1
        const current = call
        if (current === 1) await new Promise<void>((resolve) => { releaseList.push(resolve) })
        return {
          qualityScore: current === 1 ? 10 : 90,
          findingCount: [{ severity: 'low', count: 1 }],
          finding: [{ id: 'x', severity: 'low', category: 'readability', message: `run ${current}: ${input.content}`, detail: 'd', line_start: 1 }],
          suggestion: [],
          generatedTest: []
        }
      },
      regenerateTest: async (fileList) => fileList
    }
    const { app, store } = buildApp({ analyzer })
    const record = addReview(store, { id: 'r1' })

    await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'old\n' })
    record.review.status = 'failed'
    await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'new\n' })
    const done = await waitForStatus(app, 'r1', 'completed')
    releaseList.forEach((release) => release())
    await new Promise((resolve) => setTimeout(resolve, 20))

    const after = await request(app).get('/api/review/r1')
    expect(releaseList).toHaveLength(1)
    expect(done.body.finding[0].message).toBe('run 2: new\n')
    expect(after.body).toMatchObject({ qualityScore: 90, analyzedContent: 'new\n', status: 'completed' })
    expect(after.body.finding[0].message).toBe('run 2: new\n')
  })

  it('discards a late failure of an older run', async () => {
    const failList: Array<() => void> = []
    let call = 0
    const analyzer: Analyzer = {
      analyze: async () => {
        call += 1
        if (call === 1) await new Promise<void>((_resolve, reject) => { failList.push(() => reject(new Error('late'))) })
        return { qualityScore: 80, findingCount: [], finding: [], suggestion: [], generatedTest: [] }
      },
      regenerateTest: async (fileList) => fileList
    }
    const { app, store } = buildApp({ analyzer })
    const record = addReview(store, { id: 'r1' })
    const original = console.error
    console.error = () => {}

    try {
      await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'old\n' })
      record.review.status = 'failed'
      await request(app).post('/api/review/r1/run').send({ language: 'Go', code: 'new\n' })
      await waitForStatus(app, 'r1', 'completed')
      failList.forEach((fail) => fail())
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      console.error = original
    }

    expect(failList).toHaveLength(1)
    expect(record.review.status).toBe('completed')
  })
})

describe('GET /api/review/:id analyzed fields', () => {
  it('equal content and language before any save', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', content: 'const value: any = 1\n', language: 'TypeScript' })

    const response = await request(app).get('/api/review/r1')

    expectContract(response, '/api/review/{id}', 'GET')
    expect(response.body).toMatchObject({ analyzedContent: 'const value: any = 1\n', analyzedLanguage: 'TypeScript' })
  })

  it('keep the analyzed code and language after a save without a run', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'r1', content: 'const value: any = 1\n', language: 'TypeScript' })
    await request(app).put('/api/review/r1').send(saveBody)

    const response = await request(app).get('/api/review/r1')

    expectContract(response, '/api/review/{id}', 'GET')
    expect(response.body).toMatchObject({
      content: 'const edited = 1\n', language: 'JavaScript',
      analyzedContent: 'const value: any = 1\n', analyzedLanguage: 'TypeScript'
    })
  })
})
