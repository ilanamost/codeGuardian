import { afterEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_TEXT } from '../../src/lib/review.constants'
import { SETTINGS_WAIT_MAX_MS } from '../../src/lib/settings.constants'
import { AppError } from '../../src/models/app-error'
import type { SettingsDto } from '../../src/models/dto'
import { AppSettings } from '../../src/models/settings.model'
import { createAppStore } from '../../src/store'
import { fetchReview } from '../../src/store/review.slice'
import { fetchSettings } from '../../src/store/settings.slice'
import { ERROR_CODE, ERROR_HINT, ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices, detailOf } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'

// QA AI-43 D3: a preference-gated notice is decided only once GET /api/settings has settled. The
// store starts from the browser's cached settings, which may be the defaults or stale.
const reviewLoadText = `${ERROR_MESSAGE.reviewLoad} ${ERROR_HINT.server}`

function withReviewFailed(enabled: boolean): SettingsDto {
  const settings = AppSettings.defaultDto()
  return { ...settings, notification: { ...settings.notification, reviewFailed: enabled } }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// A store whose cached settings say `cached` and whose settings load waits until the test answers.
function setup(cached: boolean) {
  const { services, toast } = createFakeServices()
  services.settings.read.mockReturnValue(withReviewFailed(cached))
  const load = deferred<SettingsDto>()
  services.settings.get.mockReturnValue(load.promise)
  services.review.get.mockRejectedValue(new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 }))
  const store = createAppStore({ services })
  return { store, services, toast, load }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('preference-gated notices wait for the settings load', () => {
  it('drops a review failure that arrives before the load when the saved preference is off (fresh browser)', async () => {
    const { store, toast, load } = setup(true)
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))
    await flush()
    expect(toast.error).not.toHaveBeenCalled()

    load.resolve(withReviewFailed(false))
    await flush()
    await flush()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows it once the load says on, although this browser cached off (stale cache)', async () => {
    const { store, toast, load } = setup(false)
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))
    await flush()
    expect(toast.error).not.toHaveBeenCalled()

    load.resolve(withReviewFailed(true))
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(reviewLoadText))
  })

  it('shows it when the settings fail to load, so the error is not lost', async () => {
    const { store, toast, load } = setup(false)
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))
    load.reject(new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(reviewLoadText))
  })

  it('after a failed load, a later review failure is shown as well', async () => {
    const { store, toast, load } = setup(false)
    store.dispatch(fetchSettings())
    load.reject(new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 }))
    await flush()
    toast.error.mockClear()

    await store.dispatch(fetchReview('r1'))
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(reviewLoadText))
  })

  it('shows it after SETTINGS_WAIT_MAX_MS when the load never answers', async () => {
    vi.useFakeTimers()
    const { store, toast } = setup(false)
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))
    await vi.advanceTimersByTimeAsync(SETTINGS_WAIT_MAX_MS - 1)
    expect(toast.error).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(toast.error).toHaveBeenCalledWith(reviewLoadText)
  })

  it('uses the loaded preference at once for a failure after the load', async () => {
    const { store, toast, load } = setup(true)
    store.dispatch(fetchSettings())
    load.resolve(withReviewFailed(false))
    await flush()

    await store.dispatch(fetchReview('r1'))
    await flush()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('two loads in flight (React StrictMode) share one wait', async () => {
    const { store, services, toast } = setup(false)
    const first = deferred<SettingsDto>()
    const second = deferred<SettingsDto>()
    services.settings.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    store.dispatch(fetchSettings())
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))

    first.resolve(withReviewFailed(true))
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(reviewLoadText))
    second.resolve(withReviewFailed(true))
  })
})

describe('notices that do not wait', () => {
  it('a network failure is shown at once, before the settings load', async () => {
    const { store, services, toast } = setup(false)
    services.review.get.mockRejectedValue(new AppError({ code: ERROR_CODE.network, kind: 'network' }))
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))
    await flush()

    expect(toast.error).toHaveBeenCalledWith(`${ERROR_MESSAGE.reviewLoad} ${ERROR_HINT.network}`)
  })

  it('a store without a settings load (no app shell) decides with the current state', async () => {
    const { store, toast } = setup(true)
    await store.dispatch(fetchReview('r1'))
    await flush()
    expect(toast.error).toHaveBeenCalledWith(reviewLoadText)
  })
})

describe('the Review completed notice waits too', () => {
  it('follows the loaded preference, not the cached one', async () => {
    const { store, services, toast, load } = setup(true)
    const cached = withReviewFailed(true)
    services.settings.read.mockReturnValue({ ...cached, notification: { ...cached.notification, reviewCompleted: true } })
    services.review.get
      .mockResolvedValueOnce(detailOf('r1', { ...structuredClone(sampleReview), status: 'pending' }))
      .mockResolvedValueOnce(detailOf('r1', structuredClone(sampleReview)))
    const loaded = AppSettings.defaultDto()
    store.dispatch(fetchSettings())
    await store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r1'))
    await flush()
    expect(toast.success).not.toHaveBeenCalled()

    load.resolve({ ...loaded, notification: { ...loaded.notification, reviewCompleted: false } })
    await flush()
    await flush()
    // sampleReview has a critical finding: only that notice (plan 028) follows, on its own toggle.
    expect(toast.success).not.toHaveBeenCalledWith('Review completed')
  })
})

describe('the Critical security findings notice (plan 028)', () => {
  async function completeWith(criticalFinding: boolean, review = structuredClone(sampleReview)) {
    const { store, services, toast, load } = setup(true)
    services.review.get
      .mockResolvedValueOnce(detailOf('r1', { ...structuredClone(sampleReview), status: 'pending' }))
      .mockResolvedValueOnce(detailOf('r1', review))
    const loaded = AppSettings.defaultDto()
    store.dispatch(fetchSettings())
    load.resolve({ ...loaded, notification: { ...loaded.notification, criticalFinding } })
    await flush()
    await store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r1'))
    await flush()
    await flush()
    return toast
  }

  it('shows on completion with a critical finding when the toggle is on', async () => {
    const toast = await completeWith(true)

    expect(toast.success).toHaveBeenCalledWith(REVIEW_TEXT.criticalFinding)
  })

  it('stays silent when the toggle is off', async () => {
    const toast = await completeWith(false)

    expect(toast.success).not.toHaveBeenCalledWith(REVIEW_TEXT.criticalFinding)
    expect(toast.success).toHaveBeenCalledWith('Review completed')
  })

  it('stays silent for a review without a critical finding', async () => {
    const review = { ...structuredClone(sampleReview), findingCount: [], finding: sampleReview.finding.filter((item) => item.severity !== 'critical') }
    const toast = await completeWith(true, review)

    expect(toast.success).not.toHaveBeenCalledWith(REVIEW_TEXT.criticalFinding)
  })
})
