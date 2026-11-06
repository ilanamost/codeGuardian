import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createAppStore } from '../../src/store'
import { fetchDashboard } from '../../src/store/dashboard.slice'
import { fetchReviewList } from '../../src/store/review.slice'
import { fetchSettings } from '../../src/store/settings.slice'
import { sessionEnded, signIn, signOut } from '../../src/store/session.slice'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { signedInState } from '../utils/renderWithStore'

// Plan 028 revision 1 (QA D1): no answer of a previous session reaches the store, and the next
// account's first GET is a new request.

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function signedInStore() {
  const fake = createFakeServices()
  const store = createAppStore({ services: fake.services, preloadedState: signedInState() })
  return { ...fake, store }
}

describe('the session generation', () => {
  it('is bumped by sign-out and by a session that ended, never by sign-in', async () => {
    const { store } = signedInStore()
    expect(store.getState().session.generation).toBe(0)

    await store.dispatch(signOut())
    expect(store.getState().session.generation).toBe(1)
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    expect(store.getState().session.generation).toBe(1)
    store.dispatch(sessionEnded())
    expect(store.getState().session.generation).toBe(2)
  })

  it('a failure of the previous session raises no toast after sign-out', async () => {
    const { store, services, toast } = signedInStore()
    const late = deferred<never>()
    services.dashboard.get.mockImplementationOnce(() => late.promise)

    const pending = store.dispatch(fetchDashboard())
    await store.dispatch(signOut())
    late.reject(AppError.fromResponse(500, { error: { code: 'internal_error', message: 'x' } }))
    await pending

    expect(toast.error).not.toHaveBeenCalled()
    expect(store.getState().dashboard.status).not.toBe('failed')
  })

  it('stale settings of the previous account do not replace the defaults', async () => {
    const { store, services } = signedInStore()
    const late = deferred<Awaited<ReturnType<typeof services.settings.get>>>()
    services.settings.get.mockImplementationOnce(() => late.promise)

    const pending = store.dispatch(fetchSettings())
    store.dispatch(sessionEnded())
    late.resolve({ ...(await createFakeServices().services.settings.get()), theme: 'dark' })
    await pending

    expect(store.getState().settings.theme).not.toBe('dark')
  })

  it('a request of the new session is kept', async () => {
    const { store } = signedInStore()
    await store.dispatch(signOut())
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))

    await store.dispatch(fetchReviewList())

    expect(store.getState().review.list.length).toBeGreaterThan(0)
  })

  it('sign-out and a session that ended cancel the requests in flight', async () => {
    const { store, services } = signedInStore()

    await store.dispatch(signOut())
    expect(services.session.abortAll).toHaveBeenCalledTimes(1)

    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    services.dashboard.get.mockRejectedValueOnce(AppError.fromResponse(401, { error: { code: 'unauthorized', message: 'x' } }))
    await store.dispatch(fetchDashboard())
    expect(store.getState().session.status).toBe('signedOut')
    expect(services.session.abortAll).toHaveBeenCalledTimes(2)
  })

  it('a failed sign-out cancels nothing', async () => {
    const { store, services } = signedInStore()
    services.session.signOut.mockRejectedValueOnce(new Error('down'))

    await store.dispatch(signOut())

    expect(services.session.abortAll).not.toHaveBeenCalled()
    expect(store.getState().session.generation).toBe(0)
  })
})

describe('api.service abortAll', () => {
  it('cancels a shared GET in flight as an abort (never reported), and the next GET of the URL is a new fetch', async () => {
    const answerList: ReturnType<typeof deferred<Response>>[] = []
    const fetchFn = vi.fn<FetchFn>((_input, init) => {
      const answer = deferred<Response>()
      init.signal?.addEventListener('abort', () => answer.reject(new DOMException('aborted', 'AbortError')))
      answerList.push(answer)
      return answer.promise
    })
    const source = createApiService({ baseUrl: 'http://api.test', fetchFn })

    const previous = source.request('GET', '/api/dashboard')
    source.abortAll?.()
    await expect(previous).rejects.toMatchObject({ code: ERROR_CODE.abort, kind: 'abort' })

    const next = source.request('GET', '/api/dashboard')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    answerList[1].resolve(new Response(JSON.stringify({ mine: true }), { status: 200 }))
    await expect(next).resolves.toEqual({ mine: true })
  })

  it('with nothing in flight it does nothing', () => {
    const source = createApiService({ baseUrl: 'http://api.test', fetchFn: vi.fn<FetchFn>() })

    expect(() => source.abortAll?.()).not.toThrow()
  })
})
