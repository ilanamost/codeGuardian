import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { AI_NOTICE_TEXT, FAILURE_TEXT, REVIEW_TEXT } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import { failureReasonList, failureReasonOf, Review } from '../../src/models/review.model'
import { createApiService } from '../../src/services/api.service'
import { createReviewService } from '../../src/services/review.service'
import { ANALYSIS_HINT, ERROR_CODE, ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices, detailOf } from '../utils/fakeServices'
import { renderWithStoreSettled } from '../utils/renderWithStore'
import { sampleReview } from '../utils/sampleData'

// Plan 039 (AI-88): failure reasons, the analysis quota and regenerate errors, and the notices
// that depend on which analyzer the backend uses.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <textarea data-testid="monaco" value={value} readOnly />
}))

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

const failedReview = (failureReason?: string | null) => ({
  ...structuredClone(sampleReview),
  status: 'failed' as const,
  finding: [],
  findingCount: [],
  suggestion: [],
  generatedTest: [],
  ...(failureReason === undefined ? {} : { failureReason: failureReason as never })
})

describe('failure reason', () => {
  it('has a message for every reason, and none is the generic one', () => {
    for (const reason of failureReasonList) {
      expect(FAILURE_TEXT[reason].length).toBeGreaterThan(20)
      expect(FAILURE_TEXT[reason]).not.toContain('Something went wrong')
    }
    expect(Object.keys(FAILURE_TEXT).sort()).toEqual([...failureReasonList].sort())
  })

  it('reads a missing or unknown reason of a failed review as internal, and null otherwise', () => {
    expect(failureReasonOf({ status: 'failed' })).toBe('internal')
    expect(failureReasonOf({ status: 'failed', failureReason: 'ai_future' as never })).toBe('internal')
    expect(failureReasonOf({ status: 'failed', failureReason: 'ai_timeout' })).toBe('ai_timeout')
    expect(failureReasonOf({ status: 'completed', failureReason: 'ai_timeout' })).toBeNull()
    expect(failureReasonOf(null)).toBeNull()
  })

  it('keeps the reason through the Review model and accepts an unknown string', () => {
    const review = Review.fromDto(failedReview('ai_refused'))
    expect(review.failureReason).toBe('ai_refused')
    expect(review.toDto().failureReason).toBe('ai_refused')
    expect(Review.fromDto(failedReview('brand_new')).failureReason).toBe('internal')
    expect(Review.fromDto(structuredClone(sampleReview)).toDto()).not.toHaveProperty('failureReason')
  })

  it.each(failureReasonList)('shows the %s message on a failed review', async (reason) => {
    const { services } = createFakeServices()
    services.review.get.mockResolvedValue(detailOf('r1', failedReview(reason)))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })
    expect(await screen.findByTestId('failure-reason')).toHaveTextContent(FAILURE_TEXT[reason])
  })

  it('shows the internal message for a failed review without a reason, and nothing for a completed one', async () => {
    const first = createFakeServices()
    first.services.review.get.mockResolvedValue(detailOf('r1', failedReview()))
    const { unmount } = await renderWithStoreSettled(<App />, { route: '/review/r1', services: first.services })
    expect(await screen.findByTestId('failure-reason')).toHaveTextContent(FAILURE_TEXT.internal)
    unmount()

    const second = createFakeServices()
    await renderWithStoreSettled(<App />, { route: '/review/r1', services: second.services })
    await screen.findByTestId('review-name')
    expect(screen.queryByTestId('failure-reason')).not.toBeInTheDocument()
  })
})

describe('analysis quota and regenerate errors', () => {
  const resetAt = '2026-11-02T14:35:00.000Z'
  const quotaBody = { error: { code: 'rate_limited', message: 'quota', details: { resetAt } } }

  it.each([
    [ERROR_CODE.reviewCreate, ERROR_MESSAGE.reviewCreate],
    [ERROR_CODE.reviewRun, ERROR_MESSAGE.reviewRun],
    [ERROR_CODE.testRegenerate, ERROR_MESSAGE.testRegenerate]
  ])('names the reset time in the %s message', (action, message) => {
    const error = AppError.fromResponse(429, quotaBody).forAction(action)
    expect(error.resetAt).toBe(resetAt)
    expect(error.userMessage).toBe(`${message} ${ANALYSIS_HINT.quota(resetAt)}`)
    expect(error.userMessage).toMatch(/after \d{1,2}:\d{2}\s?(AM|PM)/)
    // Survives the plain form kept in the store.
    expect(AppError.fromJson(error.toJSON()).resetAt).toBe(resetAt)
  })

  it('falls back to "later" when the reset time is missing or malformed', () => {
    const body = { error: { code: 'rate_limited', message: 'q', details: { resetAt: 'soon' } } }
    const error = AppError.fromResponse(429, body).forAction(ERROR_CODE.reviewRun)
    expect(error.resetAt).toBeUndefined()
    expect(error.userMessage).toBe(`${ERROR_MESSAGE.reviewRun} ${ANALYSIS_HINT.quota()}`)
  })

  it('words Regenerate 502 and 504 for the AI service, not for GitHub', () => {
    const bad = AppError.fromResponse(502, { error: { code: 'upstream_error', message: 'x' } }).forAction(ERROR_CODE.testRegenerate)
    const slow = AppError.fromResponse(504, { error: { code: 'upstream_timeout', message: 'x' } }).forAction(ERROR_CODE.testRegenerate)
    expect(bad.userMessage).toBe(`${ERROR_MESSAGE.testRegenerate} ${ANALYSIS_HINT.upstreamError}`)
    expect(slow.userMessage).toBe(`${ERROR_MESSAGE.testRegenerate} ${ANALYSIS_HINT.upstreamTimeout}`)
    expect(bad.userMessage).not.toContain('GitHub')
  })

  it('reports a 429 on Run review with the quota toast', async () => {
    const user = userEvent.setup()
    const { services, toast } = createFakeServices()
    services.review.run.mockRejectedValueOnce(AppError.fromResponse(429, quotaBody))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })
    // Run review is enabled once the language differs from the analyzed one.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Go')
    await user.click(screen.getByRole('button', { name: REVIEW_TEXT.runButton }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`${ERROR_MESSAGE.reviewRun} ${ANALYSIS_HINT.quota(resetAt)}`))
  })
})

describe('AI notice', () => {
  async function renderWith(analyzer: 'claude' | 'stub' | Error, route = '/review/r1') {
    const { services } = createFakeServices()
    services.review.analyzer.mockImplementation(async () => {
      if (analyzer instanceof Error) throw analyzer
      return analyzer
    })
    await renderWithStoreSettled(<App />, { route, services })
    return services
  }

  it('says code is sent to Anthropic only when the analyzer is claude', async () => {
    await renderWith('claude')
    expect(await screen.findByTestId('ai-notice-claude')).toHaveTextContent(AI_NOTICE_TEXT.claude)
    expect(screen.queryByTestId('ai-notice-stub')).not.toBeInTheDocument()
  })

  it('shows the stub note only when the analyzer is stub', async () => {
    await renderWith('stub')
    expect(await screen.findByTestId('ai-notice-stub')).toHaveTextContent(AI_NOTICE_TEXT.stub)
    expect(screen.queryByTestId('ai-notice-claude')).not.toBeInTheDocument()
  })

  it('shows neither when the health check fails, without an error toast', async () => {
    const services = await renderWith(new AppError({ code: ERROR_CODE.network, kind: 'network' }))
    await waitFor(() => expect(services.review.analyzer).toHaveBeenCalled())
    expect(screen.queryByTestId('ai-notice-claude')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-notice-stub')).not.toBeInTheDocument()
  })

  it('also shows on /review/new', async () => {
    await renderWith('claude', '/review/new')
    expect(await screen.findByTestId('ai-notice-claude')).toBeInTheDocument()
  })
})

describe('review service analyzer', () => {
  it.each([
    [{ status: 'ok', analyzer: 'claude' }, 'claude'],
    [{ status: 'ok', analyzer: 'stub' }, 'stub'],
    [{ status: 'ok' }, 'stub'],
    [{ status: 'ok', analyzer: 'other' }, 'stub']
  ])('reads %j as %s', async (body, expected) => {
    const source = { request: vi.fn(async () => body) } as never
    expect(await createReviewService(source).analyzer()).toBe(expected)
  })

  it('asks GET /api/health through the API service', async () => {
    const fetchFn = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({ status: 'ok', analyzer: 'claude' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const api = createApiService({ baseUrl: 'http://x', fetchFn })
    expect(await createReviewService(api).analyzer()).toBe('claude')
    expect(fetchFn.mock.calls[0][0]).toBe('http://x/api/health')
  })
})
