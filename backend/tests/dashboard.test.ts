import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { addReview, buildApp, fixedNow, waitForStatus } from './helper/app.js'
import { expectContract } from './helper/contract.js'

// The fixed clock is 2026-10-22T10:00Z, so "today" is the UTC day labelled 'Oct 22'.
const day = 24 * 60 * 60 * 1000
const snippet = (content: string) => ({ source_type: 'snippet', language: 'TypeScript', content })
// Known stub findings (src/analyzer/stub-analyzer.ts):
// - evalAndAny: critical/security (eval) and medium/maintainability (any), score 100 - 25 - 8 = 67.
// - secretConsoleTodo: high/security, low/readability and low/maintainability, score 100 - 15 - 3 - 3 = 79.
// - clean: no finding, score 100.
const evalAndAny = snippet('const result = eval(input)\nconst value: any = 1\n')
const secretConsoleTodo = snippet("const password = 'hunter2'\nconsole.log(password)\n// TODO: tidy\n")
const clean = snippet('export const sum = (a: number, b: number) => a + b\n')

type Stat = { id: string, value: number, trend: number }
const statOf = (body: { statList: Stat[] }) => Object.fromEntries(body.statList.map((stat) => [stat.id, { value: stat.value, trend: stat.trend }]))
const nonZero = (list: { date: string, count: number }[]) => list.filter((entry) => entry.count > 0)

describe('GET /api/dashboard', () => {
  it('an empty store gives zeros and empty lists, with full zero activity ranges', async () => {
    const { app } = buildApp()

    const response = await request(app).get('/api/dashboard')

    expectContract(response, '/api/dashboard', 'GET')
    expect(response.body.statList).toEqual([
      { id: 'total', label: 'Total Reviews', value: 0, trend: 0 },
      { id: 'completed', label: 'Completed', value: 0, trend: 0 },
      { id: 'failed', label: 'Failed', value: 0, trend: 0 },
      { id: 'quality', label: 'Avg. Quality Score', value: 0, suffix: ' / 100', trend: 0 }
    ])
    expect(response.body.severityCountList).toEqual([
      { severity: 'critical', label: 'Critical', count: 0 },
      { severity: 'high', label: 'High', count: 0 },
      { severity: 'medium', label: 'Medium', count: 0 },
      { severity: 'low', label: 'Low', count: 0 }
    ])
    expect(response.body.categoryCountList).toEqual([])
    for (const [range, length, first] of [['7d', 7, 'Oct 16'], ['14d', 14, 'Oct 9'], ['30d', 30, 'Sep 23']] as const) {
      const activity = response.body.activityByRange[range]
      expect(activity).toHaveLength(length)
      expect(activity[0].date).toBe(first)
      expect(activity.at(-1).date).toBe('Oct 22')
      expect(nonZero(activity)).toEqual([])
    }
  })

  it('reviews created through the API give the exact counts, average, categories and activity', async () => {
    let clock = fixedNow
    const { app, store } = buildApp({ now: () => clock })
    clock = fixedNow - 2 * day
    const olderId = (await request(app).post('/api/review').send(clean)).body.id
    clock = fixedNow
    const firstId = (await request(app).post('/api/review').send(evalAndAny)).body.id
    const secondId = (await request(app).post('/api/review').send(secretConsoleTodo)).body.id
    for (const id of [olderId, firstId, secondId]) await waitForStatus(app, id, 'completed')
    addReview(store, { id: 'failed-1', status: 'failed', findingCount: [], finding: [] })

    const response = await request(app).get('/api/dashboard')

    expectContract(response, '/api/dashboard', 'GET')
    expect(statOf(response.body)).toEqual({
      total: { value: 4, trend: 0 },
      completed: { value: 3, trend: 0 },
      failed: { value: 1, trend: 0 },
      // (67 + 79 + 100) / 3 = 82
      quality: { value: 82, trend: 0 }
    })
    expect(response.body.severityCountList.map((item: { count: number }) => item.count)).toEqual([1, 1, 1, 2])
    expect(response.body.categoryCountList).toEqual([
      { id: 'security', label: 'Security', count: 2 },
      { id: 'maintainability', label: 'Maintainability', count: 2 },
      { id: 'readability', label: 'Readability', count: 1 }
    ])
    expect(nonZero(response.body.activityByRange['7d'])).toEqual([{ date: 'Oct 20', count: 1 }, { date: 'Oct 22', count: 3 }])
    expect(nonZero(response.body.activityByRange['30d'])).toEqual([{ date: 'Oct 20', count: 1 }, { date: 'Oct 22', count: 3 }])
  })

  it('excludes deleted reviews from every number', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/api/review').send(evalAndAny)
    await waitForStatus(app, created.body.id, 'completed')
    expect((await request(app).delete(`/api/review/${created.body.id}`)).status).toBe(204)

    const response = await request(app).get('/api/dashboard')

    expect(response.body.statList.map((stat: Stat) => stat.value)).toEqual([0, 0, 0, 0])
    expect(response.body.severityCountList.map((item: { count: number }) => item.count)).toEqual([0, 0, 0, 0])
    expect(response.body.categoryCountList).toEqual([])
    expect(nonZero(response.body.activityByRange['30d'])).toEqual([])
  })

  it('trends compare the last 30 days with the 30 days before, rounded to an integer percent', async () => {
    const { app, store } = buildApp()
    // Previous window: days 30 to 59 ago. Current window: today to 29 days ago.
    addReview(store, { id: 'p1', createdAt: fixedNow - 30 * day, qualityScore: 60 })
    addReview(store, { id: 'p2', createdAt: fixedNow - 59 * day, qualityScore: 80 })
    addReview(store, { id: 'p3', createdAt: fixedNow - 40 * day, status: 'failed' })
    addReview(store, { id: 'p4', createdAt: fixedNow - 45 * day, status: 'failed' })
    addReview(store, { id: 'c1', createdAt: fixedNow - 29 * day, qualityScore: 70 })
    addReview(store, { id: 'c2', createdAt: fixedNow - 10 * day, qualityScore: 77 })
    addReview(store, { id: 'c3', createdAt: fixedNow, qualityScore: 84 })
    // Older than both windows: counted in the values, never in a trend.
    addReview(store, { id: 'o1', createdAt: fixedNow - 60 * day, status: 'failed' })

    const response = await request(app).get('/api/dashboard')

    expect(statOf(response.body)).toEqual({
      // all-time 8; window 3 against 4: -25 %
      total: { value: 8, trend: -25 },
      // all-time 5; window 3 against 2: +50 %
      completed: { value: 5, trend: 50 },
      // all-time 3; window 0 against 2: -100 %
      failed: { value: 3, trend: -100 },
      // all-time (60 + 80 + 70 + 77 + 84) / 5 = 74.2 -> 74; window 77 against 70: +10 %
      quality: { value: 74, trend: 10 }
    })
    const month = response.body.activityByRange['30d']
    expect(month[0]).toEqual({ date: 'Sep 23', count: 1 })
    expect(nonZero(month).reduce((sum: number, entry: { count: number }) => sum + entry.count, 0)).toBe(3)
  })

  it('a trend is 0 when the previous window has nothing of that kind', async () => {
    const { app, store } = buildApp()
    addReview(store, { id: 'p1', createdAt: fixedNow - 35 * day, status: 'failed' })
    addReview(store, { id: 'c1', createdAt: fixedNow - 5 * day, qualityScore: 90 })
    addReview(store, { id: 'c2', createdAt: fixedNow - 4 * day, status: 'failed' })

    const response = await request(app).get('/api/dashboard')

    expect(statOf(response.body)).toEqual({
      total: { value: 3, trend: 100 },
      // no completed review in the previous window
      completed: { value: 1, trend: 0 },
      failed: { value: 2, trend: 0 },
      // no completed review in the previous window, so no previous average
      quality: { value: 90, trend: 0 }
    })
  })

  it('rounds a fractional trend to the nearest integer percent', async () => {
    const { app, store } = buildApp()
    for (const [index, ago] of [31, 32, 33].entries()) addReview(store, { id: `p${index}`, createdAt: fixedNow - ago * day })
    for (const [index, ago] of [1, 2].entries()) addReview(store, { id: `c${index}`, createdAt: fixedNow - ago * day })

    const response = await request(app).get('/api/dashboard')

    // (2 - 3) / 3 = -33.3 %
    expect(statOf(response.body).total).toEqual({ value: 5, trend: -33 })
  })
})
