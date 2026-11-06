import type { ReactElement } from 'react'
import { act, render, type RenderOptions } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import type { Services } from '../../src/services'
import { fixtureData } from './fixtureData'
import { createFixtureServices, type FixtureServicesOption } from './fixtureDataSource'
import { createAppStore, type AppStore, type RootState } from '../../src/store'
import { initialAccountState } from '../../src/store/account.slice'
import { initialSessionState, type SessionStatus } from '../../src/store/session.slice'

export type RenderWithStoreOption = Omit<RenderOptions, 'wrapper'> & {
  // Wraps the UI in a MemoryRouter at this path. Pass `router: false` when the test has its own router.
  route?: string
  // Router state of the initial entry (for example the guard's `{ from }`).
  routeState?: unknown
  router?: boolean
  store?: AppStore
  services?: Services
  // Options of the default services on the fake backend (createFixtureServices).
  serviceOption?: FixtureServicesOption
  preloadedState?: Partial<RootState>
  // The session the store starts with. `signedIn` (the default) preloads the fixture account, as
  // after a session restore; `unknown` lets the app run its own restore.
  session?: SessionStatus
}

// The preloaded state of a signed-in session: the session and its account.
export function signedInState(account = fixtureData.account): Pick<RootState, 'session' | 'account'> {
  return {
    session: { ...initialSessionState(), status: 'signedIn', restoreStatus: 'succeeded', expiresAt: '2026-10-28T10:00:00.000Z' },
    account: { ...initialAccountState, account: structuredClone(account), status: 'succeeded' }
  }
}

function sessionStateOf(session: SessionStatus): Partial<RootState> {
  if (session === 'signedIn') return signedInState()
  return { session: { ...initialSessionState(), status: session, restoreStatus: session === 'unknown' ? 'idle' : 'succeeded' } }
}

// A fresh store (services on the fake backend by default) per render, so tests never share state.
export function renderWithStore(ui: ReactElement, option: RenderWithStoreOption = {}) {
  const { route = '/', routeState, router = true, store, services, serviceOption, preloadedState, session = 'signedIn', ...renderOption } = option
  const appStore =
    store ??
    createAppStore({
      services: services ?? createFixtureServices(serviceOption),
      preloadedState: { ...sessionStateOf(session), ...preloadedState }
    })
  const content = router ? <MemoryRouter initialEntries={[{ pathname: route.split(/[?#]/)[0], search: searchOf(route), hash: hashOf(route), state: routeState }]}>{ui}</MemoryRouter> : ui
  const result = render(<Provider store={appStore}>{content}</Provider>, renderOption)
  return { ...result, store: appStore }
}

function searchOf(route: string): string {
  const match = /\?[^#]*/.exec(route)
  return match ? match[0] : ''
}

function hashOf(route: string): string {
  const index = route.indexOf('#')
  return index >= 0 ? route.slice(index) : ''
}

// Lets pending thunks (mock services resolve on the next tick) finish and React re-render.
export async function settle() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

// Render and wait for the first data load, for tests that query right after rendering.
export async function renderWithStoreSettled(ui: ReactElement, option: RenderWithStoreOption = {}) {
  const result = renderWithStore(ui, option)
  await settle()
  return result
}
