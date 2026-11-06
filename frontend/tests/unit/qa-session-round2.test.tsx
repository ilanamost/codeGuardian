import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountDto } from '../../src/models/dto'
import { AppSettings } from '../../src/models/settings.model'
import { createApiService } from '../../src/services/api.service'
import { createServices } from '../../src/services'
import { settingsStorageKey } from '../../src/services/settings.service'
import { createAppStore } from '../../src/store'
import { fetchAccount } from '../../src/store/account.slice'
import { fetchDashboard } from '../../src/store/dashboard.slice'
import { fetchReview, fetchReviewList } from '../../src/store/review.slice'
import { fetchSettings } from '../../src/store/settings.slice'
import { register, restoreSession, signIn, signOut } from '../../src/store/session.slice'
import { activityByRange, categoryCountList, dashboardStatList, recentReviewList, sampleReview, severityCountList } from '../utils/sampleData'
import { signedInState } from '../utils/renderWithStore'

// QA round 2 (plan 028, D1): the real api.service over a fetch the test answers by hand, so the
// in-flight GET map, abortAll and the settings cache are exercised for real. Account A signs
// out (or its session ends) with GETs in flight; account B signs in in the same tab.

type Call = { method: string, url: string, signal?: AbortSignal | null, answer: (status: number, body?: unknown) => void }

const alice: AccountDto = { username: 'alice', fullName: 'Alice A', email: 'alice@example.com', avatarUrl: null, memberSince: 'Jan 2024' }
const bob: AccountDto = { username: 'bob', fullName: 'Bob B', email: 'bob@example.com', avatarUrl: null, memberSince: 'Oct 2026' }
const aliceDashboard = { statList: dashboardStatList, severityCountList, categoryCountList, activityByRange }
const aliceSettings = { ...AppSettings.defaultDto(), theme: 'dark' as const }

function harness() {
  const callList: Call[] = []
  const fetchFn = vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true })
    callList.push({
      method: init?.method ?? 'GET',
      url: String(input),
      signal,
      answer: (status, body) => resolve(new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    })
  }))
  const toast = { success: vi.fn(), error: vi.fn() }
  const services = createServices({ dataSource: createApiService({ baseUrl: 'http://api.test', fetchFn }), notification: { toast } })
  const store = createAppStore({ services, preloadedState: signedInState(alice) })
  const open = (method: string, path: string) => callList.filter((call) => call.method === method && new URL(call.url).pathname === path && !call.signal?.aborted)
  const last = (method: string, path: string) => {
    const list = open(method, path)
    const call = list[list.length - 1]
    if (!call) throw new Error(`no open ${method} ${path}`)
    return call
  }
  return { callList, fetchFn, toast, services, store, open, last }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  window.localStorage.clear()
})

describe('QA round 2: no answer of account A reaches account B', () => {
  it('sign-out with Dashboard, History, Review, Settings and Account GETs in flight: all aborted, nothing of A kept, B starts clean', async () => {
    const { store, open, last, callList, toast } = harness()
    const pendingList = [
      store.dispatch(fetchDashboard()),
      store.dispatch(fetchReviewList()),
      store.dispatch(fetchReview('r-alice')),
      store.dispatch(fetchSettings()),
      store.dispatch(fetchAccount())
    ]
    await flush()
    const aliceGetList = callList.filter((call) => call.method === 'GET')
    // fetchAccount is skipped by its condition while the session's account is loaded: 4 GETs.
    expect(aliceGetList.length).toBeGreaterThanOrEqual(4)

    const out = store.dispatch(signOut())
    await flush()
    last('DELETE', '/api/session').answer(204)
    await out
    await Promise.allSettled(pendingList)

    // Every GET of A was cancelled; answering them now (as a late network would) changes nothing.
    for (const call of aliceGetList) expect(call.signal?.aborted).toBe(true)
    aliceGetList.forEach((call) => call.answer(200, {}))
    await flush()

    const state = store.getState()
    expect(state.session.status).toBe('signedOut')
    expect(state.dashboard.data).toBeNull()
    expect(state.review.list).toEqual([])
    expect(state.review.current).toBeNull()
    expect(state.account.account).toBeNull()
    expect(state.settings.theme).not.toBe('dark')
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(Object.keys(window.localStorage).filter((key) => key.startsWith('cr.'))).toEqual([])
    expect(toast.error).not.toHaveBeenCalled()

    // B signs in; its GETs are new requests (not joined to A's), and their answers are kept.
    const inPromise = store.dispatch(signIn({ username: 'bob', password: 'bob-Secret-42' }))
    await flush()
    last('POST', '/api/session').answer(200, bob)
    await inPromise
    const dash = store.dispatch(fetchDashboard())
    const list = store.dispatch(fetchReviewList())
    await flush()
    expect(open('GET', '/api/dashboard').length).toBe(1)
    last('GET', '/api/dashboard').answer(200, { ...aliceDashboard, statList: [] })
    last('GET', '/api/review').answer(200, [])
    await Promise.all([dash, list])
    expect(store.getState().account.account?.username).toBe('bob')
    expect(store.getState().dashboard.data?.statList).toEqual([])
    expect(store.getState().review.list).toEqual([])
  })

  // R2-D6 (low): a settings GET whose body already arrived when abortAll runs is no longer
  // stoppable, and settings.service.get writes cr.settings after the sign-out cleared it.
  it("a settings GET that answers in the same tick as the sign-out DELETE never leaves A's settings in cr.settings", async () => {
    const { store, last } = harness()
    const settingsLoad = store.dispatch(fetchSettings())
    const out = store.dispatch(signOut())
    await flush()
    // Both answers arrive back to back, before any continuation runs.
    last('DELETE', '/api/session').answer(204)
    last('GET', '/api/settings').answer(200, aliceSettings)
    await Promise.allSettled([settingsLoad, out])
    await flush()
    expect(store.getState().session.status).toBe('signedOut')
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(store.getState().settings.theme).not.toBe('dark')
  })

  it('the reverse order (settings answer first, then DELETE) is also clean', async () => {
    const { store, last } = harness()
    const settingsLoad = store.dispatch(fetchSettings())
    const out = store.dispatch(signOut())
    await flush()
    last('GET', '/api/settings').answer(200, aliceSettings)
    last('DELETE', '/api/session').answer(204)
    await Promise.allSettled([settingsLoad, out])
    await flush()
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(store.getState().settings.theme).not.toBe('dark')
  })

  it('401 mid-use: one session toast, every other GET of A aborted, then B signs in and loads normally', async () => {
    const { store, last, callList, toast } = harness()
    const pendingList = [store.dispatch(fetchDashboard()), store.dispatch(fetchReviewList()), store.dispatch(fetchSettings())]
    await flush()
    last('GET', '/api/dashboard').answer(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })
    await Promise.allSettled(pendingList)
    await flush()

    expect(store.getState().session).toMatchObject({ status: 'signedOut', end: 'ended' })
    expect(callList.filter((call) => call.method === 'GET' && new URL(call.url).pathname !== '/api/dashboard').every((call) => call.signal?.aborted)).toBe(true)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()

    const inPromise = store.dispatch(signIn({ username: 'bob', password: 'bob-Secret-42' }))
    await flush()
    last('POST', '/api/session').answer(200, bob)
    await inPromise
    const dash = store.dispatch(fetchDashboard())
    await flush()
    last('GET', '/api/dashboard').answer(200, aliceDashboard)
    await dash
    expect(store.getState().session.status).toBe('signedIn')
    expect(store.getState().dashboard.data).not.toBeNull()
  })

  it('a real error of the new session still raises its toast (the guard drops only old-session answers)', async () => {
    const { store, last, toast } = harness()
    const out = store.dispatch(signOut())
    await flush()
    last('DELETE', '/api/session').answer(204)
    await out
    const inPromise = store.dispatch(signIn({ username: 'bob', password: 'bob-Secret-42' }))
    await flush()
    last('POST', '/api/session').answer(200, bob)
    await inPromise
    const dash = store.dispatch(fetchDashboard())
    await flush()
    last('GET', '/api/dashboard').answer(500, { error: { code: 'internal_error', message: 'boom' } })
    await dash
    expect(store.getState().dashboard.status).toBe('failed')
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it("an old mutation of A that answers 401 after B signed in neither ends B's session nor shows a toast", async () => {
    const { store, last, toast, services } = harness()
    const save = services.settings.save(aliceSettings).catch(() => undefined)
    const out = store.dispatch(signOut())
    await flush()
    last('DELETE', '/api/session').answer(204)
    await out
    const inPromise = store.dispatch(signIn({ username: 'bob', password: 'bob-Secret-42' }))
    await flush()
    last('POST', '/api/session').answer(200, bob)
    await inPromise
    last('PUT', '/api/settings').answer(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })
    await save
    await flush()
    expect(store.getState().session.status).toBe('signedIn')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a sign-in that races an old restore answer keeps the sign-in (no drop of the new session)', async () => {
    const { callList, fetchFn: _fetch, toast: _toast, ...rest } = harness()
    void callList
    const services = rest.services
    const store = createAppStore({ services })
    const restore = store.dispatch(restoreSession())
    await flush()
    const inPromise = store.dispatch(signIn({ username: 'bob', password: 'bob-Secret-42' }))
    await flush()
    rest.last('POST', '/api/session').answer(200, bob)
    await inPromise
    rest.last('GET', '/api/session').answer(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })
    await restore
    expect(store.getState().session.status).toBe('signedIn')
    expect(store.getState().account.account?.username).toBe('bob')
  })

  it('registration after a sign-out signs the new account in and keeps its account', async () => {
    const { store, last } = harness()
    const out = store.dispatch(signOut())
    await flush()
    last('DELETE', '/api/session').answer(204)
    await out
    const created = store.dispatch(register({ username: 'bob', email: 'bob@example.com', password: 'bob-Secret-42' }))
    await flush()
    last('POST', '/api/account').answer(201, bob)
    await created
    expect(store.getState().session.status).toBe('signedIn')
    expect(store.getState().account.account?.email).toBe('bob@example.com')
  })

  it('sampleReview fixture sanity', () => {
    expect(recentReviewList.length).toBeGreaterThan(0)
    expect(sampleReview).toBeTruthy()
  })
})
