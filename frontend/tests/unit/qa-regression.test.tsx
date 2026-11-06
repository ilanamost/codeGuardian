import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import type { ReviewDetailDto, SettingsDto } from '../../src/models/dto'
import { sampleReview } from '../utils/sampleData'
import ReviewPage from '../../src/pages/ReviewPage'
import { createApiService } from '../../src/services/api.service'
import { createFixtureDataSource, deletedReviewsKey, savedReviewsKey } from '../utils/fixtureDataSource'
import { createReviewService } from '../../src/services/review.service'
import { createStorageService } from '../../src/services/storage.service'
import { createAppStore } from '../../src/store'
import { fetchReview, fetchReviewList } from '../../src/store/review.slice'
import { fetchSettings, mergeLoadedSettings, notificationSet, settingsUpdated } from '../../src/store/settings.slice'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore, settle } from '../utils/renderWithStore'

// Regression tests for the defects QA found in plan 016 (.orchestrate/qa-report.md).

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function detail(id: string, title = id): ReviewDetailDto {
  return { id, review: { ...structuredClone(sampleReview), title }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('defect 1: a stale review response never replaces the current review', () => {
  it('keeps the newest id when an older request resolves last', async () => {
    const { services } = createFakeServices()
    const first = deferred<ReviewDetailDto | null>()
    services.review.get.mockImplementation((id: string) => (id === 'r1' ? first.promise : Promise.resolve(detail(id))))
    const store = createAppStore({ services })

    store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r2'))
    first.resolve(detail('r1'))
    await tick()

    expect(store.getState().review.current?.id).toBe('r2')
    expect(store.getState().review.currentStatus).toBe('succeeded')
  })

  it('ignores a late failure of a left review: no failed state, no toast', async () => {
    const { services, toast } = createFakeServices()
    const first = deferred<ReviewDetailDto | null>()
    services.review.get.mockImplementation((id: string) => (id === 'r1' ? first.promise : Promise.resolve(detail(id))))
    const store = createAppStore({ services })

    store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r2'))
    first.reject(new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 }))
    await tick()

    expect(store.getState().review.currentStatus).toBe('succeeded')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('an aborted request does not mark the review as failed', async () => {
    const { services, toast } = createFakeServices()
    services.review.get.mockImplementation(() => new Promise(() => {}))
    const store = createAppStore({ services })

    const request = store.dispatch(fetchReview('r1'))
    request.abort()
    await request
    await tick()

    expect(store.getState().review.currentStatus).toBe('loading')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('ReviewPage aborts the previous request when the id changes and shows the new review', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    const signalById = new Map<string, AbortSignal | undefined>()
    const slow = deferred<ReviewDetailDto | null>()
    services.review.get.mockImplementation((id: string, option?: { signal?: AbortSignal }) => {
      signalById.set(id, option?.signal)
      return id === 'r1' ? slow.promise : Promise.resolve(detail(id, 'Second review'))
    })
    renderWithStore(
      <>
        <Link to="/review/r2">go</Link>
        <Routes>
          <Route path="/review/:id" element={<ReviewPage />} />
        </Routes>
      </>,
      { route: '/review/r1', services }
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading review...')

    await user.click(screen.getByRole('link', { name: 'go' }))
    slow.resolve(detail('r1', 'First review'))
    await settle()

    expect(signalById.get('r1')?.aborted).toBe(true)
    expect(screen.getByTestId('review-name')).toHaveTextContent('Second review')
  })
})

describe('defect 2: the initial settings load keeps changes made while it was in flight', () => {
  it('keeps a theme change made before GET settings answers', async () => {
    const { services } = createFakeServices()
    const load = deferred<SettingsDto>()
    services.settings.get.mockImplementation(() => load.promise)
    const store = createAppStore({ services })

    store.dispatch(fetchSettings())
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    store.dispatch(notificationSet({ type: 'email', enabled: true }))
    load.resolve({ ...store.getState().settings, theme: 'light', editorFontSize: 'large', notification: { ...store.getState().settings.notification, email: false, reviewFailed: false } })
    await tick()

    const settings = store.getState().settings
    expect(settings.theme).toBe('dark')
    expect(settings.notification.email).toBe(true)
    // Untouched fields take the loaded values.
    expect(settings.editorFontSize).toBe('large')
    expect(settings.notification.reviewFailed).toBe(false)
  })

  it('mergeLoadedSettings returns the loaded settings when nothing changed locally', () => {
    const before = createFakeServices().services.settings.read()
    const loaded = { ...before, theme: 'system' as const }

    expect(mergeLoadedSettings(before, before, loaded)).toEqual(loaded)
  })
})

// Defect 3 (timeout and abort while reading the body) covered the per-request timeout, which
// plan 017 removed (Open Question 3). The caller abort is covered in api.service.test.ts.

describe('defect 4: a failed delete never drops the saved edits', () => {
  function storageWith(failKey: string) {
    const data = new Map<string, string>()
    data.set(savedReviewsKey, JSON.stringify({ r1: { name: 'Kept name', language: 'Go', code: 'x', savedAt: 't' } }))
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === failKey) throw new DOMException('full', 'QuotaExceededError')
        data.set(key, value)
      },
      removeItem: (key: string) => data.delete(key)
    } as unknown as Storage
    return { data, service: createReviewService(createFixtureDataSource({ storage: createStorageService(() => storage) })) }
  }

  it('keeps the saved name when recording the deletion fails', async () => {
    const { service } = storageWith(deletedReviewsKey)

    await expect(service.delete('r1')).rejects.toMatchObject({ kind: 'storage' })
    expect((await service.list()).find((row) => row.id === 'r1')?.title).toBe('Kept name')
  })

  it('rolls the deletion back when removing the saved edits fails', async () => {
    const { service, data } = storageWith(savedReviewsKey)

    await expect(service.delete('r1')).rejects.toMatchObject({ kind: 'storage' })
    expect(JSON.parse(data.get(deletedReviewsKey) ?? '[]')).toEqual([])
    expect((await service.get('r1'))?.saved?.name).toBe('Kept name')
  })
})

describe('notification policy (user decision)', () => {
  it('a network outage while loading reviews is shown even when Review failed is off', async () => {
    const { services, toast } = createFakeServices()
    services.review.list.mockRejectedValue(new AppError({ code: ERROR_CODE.network, kind: 'network' }))
    const store = createAppStore({ services })
    store.dispatch(notificationSet({ type: 'reviewFailed', enabled: false }))

    await store.dispatch(fetchReviewList())
    await tick()

    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('API review.service edge cases', () => {
  it('encodes an id with a slash', async () => {
    const urlList: string[] = []
    const api = createApiService({
      baseUrl: 'http://x',
      fetchFn: async (url) => {
        urlList.push(url)
        return new Response('', { status: 404 })
      }
    })

    expect(await createReviewService(api).get('a/../b')).toBeNull()
    expect(urlList[0]).toBe('http://x/api/review/a%2F..%2Fb')
  })

  it('does not treat 401 as not found', async () => {
    const api = createApiService({ baseUrl: 'http://x', fetchFn: async () => new Response('', { status: 401 }) })

    await expect(createReviewService(api).get('r1')).rejects.toMatchObject({ code: ERROR_CODE.unauthorized })
  })
})
