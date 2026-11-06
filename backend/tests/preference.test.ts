import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createStubAnalyzer } from '../src/analyzer/stub-analyzer.js'
import { buildApp, waitForStatus } from './helper/app.js'

// Plan 028, Scope 19 (Open Question 5, answer A): the saved AI preferences are read when an
// analysis starts and the stub analyzer applies them. The defaults give today's output.

// Lines that hit every stub rule: eval (critical security), a secret (high security), any
// (medium maintainability), console.log (low readability) and a TODO (low maintainability).
const content = [
  'eval(input)',
  'const password = "hunter2"',
  'const value: any = 1',
  'console.log(value)',
  '// TODO tidy up'
].join('\n')

const defaultPreference = { reviewFocus: 'all', strictness: 'balanced', explanation: 'detailed', generatedTest: true } as const

async function analyzeWith(change: Record<string, unknown>) {
  const { app } = buildApp()
  const settings = (await request(app).get('/api/settings')).body
  expect((await request(app).put('/api/settings').send({ ...settings, ...change })).status).toBe(204)
  const created = await request(app).post('/api/review').send({ source_type: 'snippet', title: 'Prefs', language: 'TypeScript', content })
  return (await waitForStatus(app, created.body.id, 'completed')).body
}

describe('AI preferences applied by the stub analyzer', () => {
  it('the defaults give the same output as an analysis without preferences', async () => {
    const analyzer = createStubAnalyzer()
    const input = { reviewId: 'r1', title: 'Prefs', language: 'TypeScript', content }

    expect(await analyzer.analyze({ ...input, preference: defaultPreference })).toEqual(await analyzer.analyze(input))
    const review = await analyzeWith({})
    expect(review.finding.map((finding: { category: string }) => finding.category)).toEqual(['security', 'security', 'maintainability', 'readability', 'maintainability'])
    expect(review.finding[0].detail).toBe('Line 1 - Stub rule no-eval')
    expect(review.generatedTest).toHaveLength(1)
  })

  it.each([
    ['security', ['security', 'security']],
    ['readability', ['maintainability', 'readability', 'maintainability']],
    ['bugs', []],
    ['performance', []]
  ])('review focus %s keeps only those categories, and their suggestions', async (reviewFocus, categoryList) => {
    const review = await analyzeWith({ reviewFocus })

    expect(review.finding.map((finding: { category: string }) => finding.category)).toEqual(categoryList)
    expect(review.suggestion).toHaveLength(new Set(review.finding.map((finding: { message: string }) => finding.message)).size)
    expect(review.finding.map((finding: { id: string }) => finding.id)).toEqual(categoryList.map((_item, index) => `f${index + 1}`))
  })

  it('"Only high-confidence" keeps critical and high only; balanced and comprehensive keep everything', async () => {
    const high = await analyzeWith({ strictness: 'high_confidence' })
    const comprehensive = await analyzeWith({ strictness: 'comprehensive' })

    expect(high.finding.map((finding: { severity: string }) => finding.severity)).toEqual(['critical', 'high'])
    expect(high.findingCount).toEqual([
      { severity: 'critical', count: 1 }, { severity: 'high', count: 1 }, { severity: 'medium', count: 0 }, { severity: 'low', count: 0 }
    ])
    expect(comprehensive.finding).toHaveLength(5)
  })

  it('"Concise" shortens each detail to Line N', async () => {
    const review = await analyzeWith({ explanation: 'concise' })

    expect(review.finding.map((finding: { detail: string }) => finding.detail)).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'])
  })

  it('generated tests off produces no generated tests', async () => {
    const review = await analyzeWith({ generatedTest: false })

    expect(review.generatedTest).toEqual([])
    expect(review.finding).toHaveLength(5)
  })

  it('a run reads the settings again when it starts', async () => {
    const { app } = buildApp()
    const settings = (await request(app).get('/api/settings')).body
    const created = await request(app).post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content })
    await waitForStatus(app, created.body.id, 'completed')
    await request(app).put('/api/settings').send({ ...settings, reviewFocus: 'security' })

    await request(app).post(`/api/review/${created.body.id}/run`).send({ language: 'TypeScript', code: content })
    const review = (await waitForStatus(app, created.body.id, 'completed')).body

    expect(review.finding.map((finding: { category: string }) => finding.category)).toEqual(['security', 'security'])
  })
})
