import { describe, expect, it } from 'vitest'
import { safeRedirectTarget } from '../../src/lib/route.constants'
import { createAppStore } from '../../src/store'
import { fetchAccount } from '../../src/store/account.slice'
import { fetchDashboard } from '../../src/store/dashboard.slice'
import { fetchReviewList } from '../../src/store/review.slice'
import { sessionEnded, signIn, signOut } from '../../src/store/session.slice'
import { createFakeServices } from '../utils/fakeServices'
import { signedInState } from '../utils/renderWithStore'

// QA (plan 028): adversarial checks on the redirect target and on the state reset between two
// accounts in the same tab.

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('QA: redirect target variants never leave the app', () => {
  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' /history',
    '%2F%2Fevil.example',
    '/\tevil.example',
    '/\nevil.example',
    '\\\\evil.example',
    '/\\/evil.example',
    'http:/evil.example',
    '///evil.example',
    '/register?x=1',
    '/login#a'
  ])('%j resolves to /', (target) => {
    expect(safeRedirectTarget(target)).toBe('/')
  })

  it.each(['/%2F%2Fevil.example', '/LOGIN', '/./login'])('%j stays an in-app path (no scheme, no //)', (target) => {
    const result = safeRedirectTarget(target)
    expect(result.startsWith('/')).toBe(true)
    expect(result.startsWith('//')).toBe(false)
  })
})

describe('QA: no data of account A survives for account B', () => {
  it('a dashboard response that arrives after sign-out is not kept in the store', async () => {
    const { services } = createFakeServices()
    const late = deferred<Awaited<ReturnType<typeof services.dashboard.get>>>()
    services.dashboard.get.mockImplementationOnce(() => late.promise)
    const store = createAppStore({ services, preloadedState: signedInState() })

    const pending = store.dispatch(fetchDashboard())
    await store.dispatch(signOut())
    expect(store.getState().session.status).toBe('signedOut')
    late.resolve(await createFakeServices().services.dashboard.get())
    await pending

    expect(store.getState().dashboard.data).toBeNull()
  })

  it('a review list response that arrives after the session ended is not kept in the store', async () => {
    const { services } = createFakeServices()
    const late = deferred<Awaited<ReturnType<typeof services.review.list>>>()
    services.review.list.mockImplementationOnce(() => late.promise)
    const store = createAppStore({ services, preloadedState: signedInState() })

    const pending = store.dispatch(fetchReviewList())
    store.dispatch(sessionEnded())
    late.resolve(await createFakeServices().services.review.list())
    await pending

    expect(store.getState().review.list).toEqual([])
  })

  it("an account response for A that arrives after B signed in does not replace B's account", async () => {
    const { services } = createFakeServices()
    const late = deferred<Awaited<ReturnType<typeof services.account.get>>>()
    services.account.get.mockImplementationOnce(() => late.promise)
    const store = createAppStore({ services, preloadedState: signedInState() })

    const pending = store.dispatch(fetchAccount())
    await store.dispatch(signOut())
    services.session.signIn.mockResolvedValueOnce({ username: 'bob', fullName: 'bob', email: 'bob@example.com', avatarUrl: null, memberSince: 'Oct 2026' })
    await store.dispatch(signIn({ username: 'bob', password: 'bob-Secret-42' }))
    late.resolve({ username: 'john.doe', fullName: 'John Doe', email: 'john@company.com', avatarUrl: null, memberSince: 'Jan 2024' })
    await pending

    expect(store.getState().account.account?.username).toBe('bob')
  })

  it('sign-out drops the settings cache and every data slice', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    await store.dispatch(fetchDashboard())
    await store.dispatch(fetchReviewList())
    await store.dispatch(signOut())
    const state = store.getState()
    expect(services.settings.clearCache).toHaveBeenCalled()
    expect(state.account.account).toBeNull()
    expect(state.dashboard.data).toBeNull()
    expect(state.review.list).toEqual([])
  })
})
