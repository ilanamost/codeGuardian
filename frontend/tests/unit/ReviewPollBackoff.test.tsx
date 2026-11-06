import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import {
  REVIEW_POLL_BACKOFF_FACTOR,
  REVIEW_POLL_INTERVAL_MS,
  REVIEW_POLL_MAX_DURATION_MS,
  REVIEW_POLL_MAX_FAILURE,
  REVIEW_POLL_MAX_INTERVAL_MS,
  REVIEW_POLL_RETRY_MS,
  REVIEW_TEXT
} from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import type { ReviewDetailDto } from '../../src/models/dto'
import { createFakeServices } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 019, QA round 1 follow-up: while the status of an unfinished review stays the same, the
// Review page waits longer between polls (backoff) and stops after a maximum duration with a
// hint and a Check again button (no toast). Any status change starts over. With fake timers.

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

function detail(status: ReviewDetailDto['review']['status']): ReviewDetailDto {
  return { id: 'r7', review: { ...sampleReview, status }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language }
}

// Lets timers up to `ms` fire and every resolved request re-render the page.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// Advances second by second: React applies each answer's re-render (which arms the next poll)
// when its act ends, so a long wait is cut into many acts.
async function advanceStepwise(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += REVIEW_POLL_INTERVAL_MS) await advance(REVIEW_POLL_INTERVAL_MS)
}

// The wait before poll number `step` + 1 while the status does not change.
const backoff = (step: number) => Math.min(REVIEW_POLL_INTERVAL_MS * REVIEW_POLL_BACKOFF_FACTOR ** step, REVIEW_POLL_MAX_INTERVAL_MS)

async function openUnfinished(services = createFakeServices().services) {
  renderWithStore(<App />, { route: '/review/r7', services })
  await advance(0)
  expect(screen.getByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
  return services
}

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Review page poll backoff', () => {
  it('waits 1 s, then 2 s, then 4 s while the status stays the same', async () => {
    const { services } = createFakeServices()
    services.review.get.mockImplementation(async () => detail('pending'))
    await openUnfinished(services)
    expect(services.review.get).toHaveBeenCalledTimes(1)

    for (let step = 0; step < 3; step += 1) {
      const calls = services.review.get.mock.calls.length
      await advance(backoff(step) - 1)
      expect(services.review.get).toHaveBeenCalledTimes(calls)
      await advance(1)
      expect(services.review.get).toHaveBeenCalledTimes(calls + 1)
    }
  })

  it('never waits longer than the maximum interval', async () => {
    const { services } = createFakeServices()
    services.review.get.mockImplementation(async () => detail('queued'))
    await openUnfinished(services)
    let step = 0
    while (backoff(step) < REVIEW_POLL_MAX_INTERVAL_MS) {
      await advance(backoff(step))
      step += 1
    }

    const calls = services.review.get.mock.calls.length
    await advance(REVIEW_POLL_MAX_INTERVAL_MS)
    expect(services.review.get).toHaveBeenCalledTimes(calls + 1)
    await advance(REVIEW_POLL_MAX_INTERVAL_MS)
    expect(services.review.get).toHaveBeenCalledTimes(calls + 2)
  })

  it('starts over at 1 s when the status changes', async () => {
    const { services } = createFakeServices()
    services.review.get
      .mockResolvedValueOnce(detail('pending'))
      .mockResolvedValueOnce(detail('pending'))
      .mockResolvedValueOnce(detail('pending'))
      .mockImplementation(async () => detail('in_progress'))
    await openUnfinished(services)
    await advance(backoff(0))
    await advance(backoff(1))
    expect(services.review.get).toHaveBeenCalledTimes(3)

    await advance(backoff(2))
    expect(screen.getByText('In progress')).toBeInTheDocument()
    const calls = services.review.get.mock.calls.length
    await advance(REVIEW_POLL_INTERVAL_MS)
    expect(services.review.get).toHaveBeenCalledTimes(calls + 1)
  })

  it('stops after the maximum duration with a hint and no toast, and Check again starts over', async () => {
    const { services, toast } = createFakeServices()
    services.review.get.mockImplementation(async () => detail('pending'))
    await openUnfinished(services)
    await advanceStepwise(REVIEW_POLL_MAX_DURATION_MS - REVIEW_POLL_MAX_INTERVAL_MS)
    expect(screen.queryByText(REVIEW_TEXT.pollStopped)).not.toBeInTheDocument()
    // Polled all along, with growing waits: far fewer polls than one per second.
    const beforeStop = services.review.get.mock.calls.length
    expect(beforeStop).toBeGreaterThan(5)
    expect(beforeStop).toBeLessThan(REVIEW_POLL_MAX_DURATION_MS / REVIEW_POLL_MAX_INTERVAL_MS + 10)
    await advanceStepwise(REVIEW_POLL_MAX_INTERVAL_MS * 2)

    expect(screen.getByRole('status')).toHaveTextContent(REVIEW_TEXT.pollStopped)
    expect(toast.error).not.toHaveBeenCalled()
    const calls = services.review.get.mock.calls.length
    await advanceStepwise(REVIEW_POLL_MAX_INTERVAL_MS * 4)
    expect(services.review.get).toHaveBeenCalledTimes(calls)

    fireEvent.click(screen.getByRole('button', { name: REVIEW_TEXT.pollResume }))
    await advance(0)
    expect(screen.queryByText(REVIEW_TEXT.pollStopped)).not.toBeInTheDocument()
    await advance(REVIEW_POLL_INTERVAL_MS)
    expect(services.review.get).toHaveBeenCalledTimes(calls + 1)
  })

  it('a status change before the maximum duration keeps polling past it', async () => {
    const { services } = createFakeServices()
    let status: ReviewDetailDto['review']['status'] = 'pending'
    services.review.get.mockImplementation(async () => detail(status))
    await openUnfinished(services)
    await advanceStepwise(REVIEW_POLL_MAX_DURATION_MS - REVIEW_POLL_MAX_INTERVAL_MS)
    status = 'in_progress'
    await advanceStepwise(REVIEW_POLL_MAX_INTERVAL_MS * 3)

    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByText(REVIEW_TEXT.pollStopped)).not.toBeInTheDocument()
    const calls = services.review.get.mock.calls.length
    await advance(REVIEW_POLL_INTERVAL_MS * 2)
    expect(services.review.get.mock.calls.length).toBeGreaterThan(calls)
  })

  it('keeps the D2 rule: a failed poll retries after the retry wait, and stops (with the hint) at the failure cap', async () => {
    const { services, toast } = createFakeServices()
    services.review.get
      .mockResolvedValueOnce(detail('pending'))
      .mockRejectedValue(new AppError({ code: 'network', kind: 'network', message: 'down' }))
    await openUnfinished(services)
    await advance(REVIEW_POLL_INTERVAL_MS)
    expect(services.review.get).toHaveBeenCalledTimes(2)

    await advance(REVIEW_POLL_RETRY_MS - 1)
    expect(services.review.get).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(services.review.get).toHaveBeenCalledTimes(3)

    // One act per retry: React applies the re-render of each failure when its act ends.
    for (let round = 0; round < REVIEW_POLL_MAX_FAILURE; round += 1) await advance(REVIEW_POLL_RETRY_MS)
    expect(services.review.get).toHaveBeenCalledTimes(1 + REVIEW_POLL_MAX_FAILURE)
    expect(screen.getByRole('status')).toHaveTextContent(REVIEW_TEXT.pollStopped)
    // The failures themselves are toasted (2 s de-duplication), the stop is not.
    expect(toast.error.mock.calls.length).toBeLessThanOrEqual(REVIEW_POLL_MAX_FAILURE)
  })

  it('stops as soon as the review is finished, with no hint', async () => {
    const { services } = createFakeServices()
    services.review.get.mockResolvedValueOnce(detail('pending')).mockResolvedValue(detail('completed'))
    await openUnfinished(services)
    await advance(REVIEW_POLL_INTERVAL_MS)
    expect(screen.getByText('Completed')).toBeInTheDocument()

    await advanceStepwise(REVIEW_POLL_MAX_INTERVAL_MS * 3)
    expect(services.review.get).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(REVIEW_TEXT.pollStopped)).not.toBeInTheDocument()
  })
})
