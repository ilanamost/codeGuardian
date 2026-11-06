import { describe, expect, it } from 'vitest'
import {
  AppError,
  AppSettings,
  codeForStatus,
  Dashboard,
  isAppErrorJson,
  normalizeReviewName,
  Review,
  ReviewSummary
} from '../../src/models'
import { activityByRange, categoryCountList, dashboardStatList, recentReviewList, severityCountList } from '../utils/sampleData'
import { sampleReview } from '../utils/sampleData'
import { buildUserMessage, ERROR_CODE, ERROR_MESSAGE, MESSAGE_BY_CODE } from '../../src/utils/error-messages'

describe('Review model', () => {
  it('builds from a valid DTO and round-trips to the same plain data', () => {
    const review = Review.fromDto(sampleReview)

    expect(review.toDto()).toEqual(sampleReview)
    expect(review.finding[0].lineStart).toBe(2)
  })

  it('derives finding counts and the critical flag', () => {
    const review = Review.fromDto(sampleReview)

    expect(review.findingTotal).toBe(7)
    expect(review.countOf('medium')).toBe(3)
    expect(review.hasCriticalFinding).toBe(true)
    expect(review.isFinished).toBe(true)
  })

  it('has no critical finding when none is counted or listed', () => {
    const review = Review.fromDto({
      ...sampleReview,
      findingCount: [{ severity: 'low', count: 1 }],
      finding: sampleReview.finding.filter((item) => item.severity !== 'critical')
    })

    expect(review.hasCriticalFinding).toBe(false)
  })

  it('folds critical into high in its summary', () => {
    const summary = Review.fromDto(sampleReview).toSummary('r1', 'now')

    expect(summary.toDto()).toEqual({
      id: 'r1',
      title: 'New review',
      language: 'TypeScript',
      timeAgo: 'now',
      status: 'completed',
      high: 3,
      medium: 3,
      low: 1
    })
  })

  it('rejects a malformed payload with a parse AppError', () => {
    const attempt = () => Review.fromDto({ ...sampleReview, status: 'exploded' })

    expect(attempt).toThrow(AppError)
    try {
      attempt()
    } catch (error) {
      expect((error as AppError).code).toBe(ERROR_CODE.parse)
      expect((error as AppError).kind).toBe('parse')
    }
  })

  it('rejects a payload with a malformed finding', () => {
    expect(() => Review.fromDto({ ...sampleReview, finding: [{ id: 'x' }] })).toThrow(AppError)
    expect(() => Review.fromDto(null)).toThrow(AppError)
  })

  it('normalizes review names', () => {
    expect(normalizeReviewName('  Hi  ')).toBe('Hi')
    expect(normalizeReviewName('   ')).toBeUndefined()
    expect(normalizeReviewName('a'.repeat(81))).toBeUndefined()
    expect(normalizeReviewName('a'.repeat(80))).toHaveLength(80)
  })
})

describe('ReviewSummary model', () => {
  it('counts findings and applies a saved name', () => {
    const summary = ReviewSummary.fromDto(recentReviewList[0])

    expect(summary.findingTotal).toBe(6)
    expect(summary.withName('Mine').title).toBe('Mine')
    expect(summary.withName(undefined)).toBe(summary)
  })

  it('rejects a row without an id', () => {
    expect(() => ReviewSummary.fromDto({ ...recentReviewList[0], id: 1 })).toThrow(AppError)
  })
})

describe('Dashboard model', () => {
  const dto = { statList: dashboardStatList, severityCountList, categoryCountList, activityByRange }

  it('builds from the dashboard DTO and derives totals', () => {
    const dashboard = Dashboard.fromDto(dto)

    expect(dashboard.findingTotal).toBe(48)
    expect(dashboard.stat('quality')?.value).toBe(78)
    expect(dashboard.activityFor('30d')).toHaveLength(30)
  })

  it('has an empty value for the loading state', () => {
    const dashboard = Dashboard.empty()

    expect(dashboard.findingTotal).toBe(0)
    expect(dashboard.activityFor('7d')).toEqual([])
  })

  it('rejects a payload missing a range', () => {
    expect(() => Dashboard.fromDto({ ...dto, activityByRange: { '7d': [] } })).toThrow(AppError)
  })
})

describe('AppSettings model', () => {
  it('has the documented defaults', () => {
    expect(AppSettings.defaults().toDto()).toMatchObject({
      theme: 'light',
      editorFontSize: 'medium',
      notification: { reviewCompleted: true, reviewFailed: true, criticalFinding: true, email: false }
    })
  })

  it('merges valid fields over the defaults and keeps the other notification flags', () => {
    const settings = AppSettings.merge(AppSettings.defaultDto(), { theme: 'dark', notification: { reviewFailed: false } })

    expect(settings.value.theme).toBe('dark')
    expect(settings.isEnabled('reviewFailed')).toBe(false)
    expect(settings.isEnabled('reviewCompleted')).toBe(true)
  })

  it('drops invalid values and unknown keys', () => {
    const settings = AppSettings.merge(AppSettings.defaultDto(), { theme: 'neon', extra: 1, notification: { email: 'yes' } })

    expect(settings.toDto()).toEqual(AppSettings.defaultDto())
  })

  it('falls back to the base for a non-object patch', () => {
    expect(AppSettings.merge(AppSettings.defaultDto(), 'garbage').toDto()).toEqual(AppSettings.defaultDto())
  })
})

describe('AppError', () => {
  it('has code, kind, status and a constant user message', () => {
    const error = new AppError({ code: ERROR_CODE.notFound, kind: 'http', status: 404, requestId: 'req-1' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AppError')
    expect(error.status).toBe(404)
    expect(error.requestId).toBe('req-1')
    expect(error.userMessage).toBe(ERROR_MESSAGE.notFound)
  })

  it('wraps unknown errors and passes AppErrors through', () => {
    const wrapped = AppError.from(new Error('boom'), ERROR_CODE.reportPdf)
    const same = new AppError({ code: ERROR_CODE.storage, kind: 'storage' })

    expect(wrapped.code).toBe(ERROR_CODE.reportPdf)
    expect(wrapped.kind).toBe('unknown')
    expect(wrapped.message).toBe('boom')
    expect(AppError.from(same)).toBe(same)
    expect(AppError.from('text').code).toBe(ERROR_CODE.unknown)
  })

  it('puts an action in front of the cause with a matching hint', () => {
    const error = new AppError({ code: ERROR_CODE.storage, kind: 'storage' }).forAction(ERROR_CODE.reviewSave)

    expect(error.code).toBe(ERROR_CODE.reviewSave)
    expect(error.kind).toBe('storage')
    expect(error.causeCode).toBe(ERROR_CODE.storage)
    expect(error.userMessage).toBe(
      'Could not save the review. Browser storage is unavailable, check your browser settings and try again.'
    )
  })

  it('keeps a cancelled request as abort', () => {
    const error = new AppError({ code: ERROR_CODE.abort, kind: 'abort' })

    expect(error.forAction(ERROR_CODE.reviewLoad)).toBe(error)
  })

  it('serializes to plain JSON and back', () => {
    const error = new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500, requestId: 'r' }).forAction(ERROR_CODE.dashboardLoad)
    const json = JSON.parse(JSON.stringify(error.toJSON()))

    expect(isAppErrorJson(json)).toBe(true)
    expect(json).not.toHaveProperty('stack')
    expect(AppError.fromJson(json)).toMatchObject({ code: 'dashboard_load', kind: 'http', status: 500, requestId: 'r' })
  })

  it('rejects objects that are not AppError JSON', () => {
    expect(isAppErrorJson({ name: 'AppError', code: 'nope', kind: 'http', userMessage: '' })).toBe(false)
    expect(isAppErrorJson(null)).toBe(false)
  })

  it.each([
    [400, ERROR_CODE.validation],
    [401, ERROR_CODE.unauthorized],
    [403, ERROR_CODE.forbidden],
    [404, ERROR_CODE.notFound],
    [409, ERROR_CODE.conflict],
    [422, ERROR_CODE.validation],
    [429, ERROR_CODE.rateLimited],
    [500, ERROR_CODE.server],
    [503, ERROR_CODE.server],
    [418, ERROR_CODE.unknown]
  ])('maps HTTP %i to %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code)
  })
})

describe('error messages', () => {
  it('has a message for every code', () => {
    for (const code of Object.values(ERROR_CODE)) expect(MESSAGE_BY_CODE[code]).toBeTruthy()
  })

  it('adds a hint for the cause to action messages only', () => {
    expect(buildUserMessage(ERROR_CODE.reportPdf)).toBe('Could not create the PDF report. Please try again.')
    expect(buildUserMessage(ERROR_CODE.supportSubmit, ERROR_CODE.network)).toBe(
      'Could not submit your request. Check your internet connection and try again.'
    )
    expect(buildUserMessage(ERROR_CODE.reviewLoad, ERROR_CODE.timeout)).toContain('timed out')
    expect(buildUserMessage(ERROR_CODE.reviewLoad, ERROR_CODE.unauthorized)).toContain('Sign in again.')
    expect(buildUserMessage(ERROR_CODE.network)).toBe(ERROR_MESSAGE.network)
  })

  it.each([
    [403, 'You do not have permission to do this.'],
    [409, 'It was changed elsewhere, refresh and try again.'],
    [429, 'Too many requests, wait a moment and try again.'],
    [500, 'The server had a problem, please try again shortly.'],
    [408, 'The request timed out, please try again.']
  ])('keeps a distinct hint for HTTP %i', (status, hint) => {
    const error = new AppError({ code: codeForStatus(status), kind: 'http', status }).forAction(ERROR_CODE.reviewSave)

    expect(error.userMessage).toBe(`Could not save the review. ${hint}`)
  })
})
