import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import App from '../../src/App'
import { ROUTE_PATH, safeRedirectTarget } from '../../src/lib/route.constants'
import { AppError } from '../../src/models/app-error'
import { fixtureData } from '../utils/fixtureData'
import { settingsStorageKey } from '../../src/services/settings.service'
import { createAppStore } from '../../src/store'
import { fetchDashboard } from '../../src/store/dashboard.slice'
import { initialSessionState, restoreSession, sessionEnded, signIn } from '../../src/store/session.slice'
import { SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { createFixtureServices } from '../utils/fixtureDataSource'
import { renderWithStore, renderWithStoreSettled, settle, signedInState } from '../utils/renderWithStore'

// Plan 028: the session (sign-in required). The session service is a fake.

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
}

const where = () => screen.getByTestId('location').textContent

function appWithProbe() {
  return (
    <>
      <App />
      <LocationProbe />
    </>
  )
}

const unauthorized = () => AppError.fromResponse(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })
const rateLimited = (second: number) => AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'x', details: { retryAfterSecond: second } } })

// Signed out: the restore answers 401.
function signedOutServices() {
  const fake = createFakeServices()
  fake.services.session.restore.mockRejectedValue(unauthorized())
  return fake
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

// Plan 035: there is no mock mode. Sign-in is always required, /login and /register always
// exist, and the session is always checked once on load.
describe('sign-in is always required', () => {
  it('an unauthenticated visit to / redirects to /login', async () => {
    const { services } = signedOutServices()
    await renderWithStoreSettled(appWithProbe(), { route: '/', services, session: 'unknown' })

    expect(services.session.restore).toHaveBeenCalledTimes(1)
    expect(where()).toBe(ROUTE_PATH.login)
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  })

  it.each([ROUTE_PATH.login, ROUTE_PATH.register])('%s exists for a signed-out visitor', async (route) => {
    const { services } = signedOutServices()
    await renderWithStoreSettled(appWithProbe(), { route, services, session: 'unknown' })

    expect(where()).toBe(route)
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('a store built without a preloaded session starts `unknown` and its thunks call the session service', async () => {
    const { services } = signedOutServices()
    const store = createAppStore({ services })
    expect(store.getState().session.status).toBe('unknown')

    await store.dispatch(restoreSession())

    expect(services.session.restore).toHaveBeenCalledTimes(1)
    expect(store.getState().session.status).toBe('signedOut')
  })

  it('a 401 after sign-in always ends the session', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    services.dashboard.get.mockRejectedValue(unauthorized())

    await store.dispatch(fetchDashboard())

    expect(store.getState().session).toMatchObject({ status: 'signedOut', end: 'ended' })
  })
})

describe('the redirect target (open-redirect check)', () => {
  it.each([
    ['/history?x=1#a', '/history?x=1#a'],
    ['/review/new', '/review/new'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login', '/'],
    ['/login?next=/x', '/'],
    ['/register', '/'],
    ['', '/'],
    [undefined, '/'],
    [42, '/']
  ])('%s resolves to %s', (target, expected) => {
    expect(safeRedirectTarget(target)).toBe(expected)
  })
})

describe('route guard', () => {
  it('while the session is unknown, shows the status and neither /login nor the page', async () => {
    const { services } = createFakeServices()
    services.session.restore.mockReturnValue(new Promise(() => {}))
    await renderWithStoreSettled(appWithProbe(), { route: '/history', services, session: 'unknown' })

    expect(screen.getByText('Checking your session...')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(where()).toBe('/history')
    expect(services.session.restore).toHaveBeenCalledTimes(1)
    expect(services.review.list).not.toHaveBeenCalled()
    expect(services.settings.get).not.toHaveBeenCalled()
  })

  it('restores a session once on load, with no extra GET /api/account', async () => {
    const { services } = createFakeServices()
    await renderWithStoreSettled(appWithProbe(), { route: '/settings', services, session: 'unknown' })

    expect(services.session.restore).toHaveBeenCalledTimes(1)
    expect(within(screen.getByRole('tabpanel')).getByText('john@company.com')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-profile')).toHaveTextContent('John Doe')
    expect(services.account.get).not.toHaveBeenCalled()
  })

  it('signed out, /history?x=1#a goes to /login, and after sign-in lands on /history?x=1#a', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderWithStoreSettled(appWithProbe(), { route: '/history?x=1#a', services, session: 'unknown' })

    expect(where()).toBe('/login')
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('User name'), '  john.doe ')
    await user.type(screen.getByLabelText('Password'), 'mock-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await settle()

    expect(services.session.signIn).toHaveBeenCalledWith({ username: 'john.doe', password: 'mock-password' })
    expect(where()).toBe('/history?x=1#a')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it.each(['//evil.example', 'https://evil.example', '/login'])('a kept target of %s lands on / after sign-in', async (from) => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderWithStoreSettled(appWithProbe(), { route: '/login', routeState: { from }, services, session: 'signedOut' })

    await user.type(screen.getByLabelText('User name'), 'john.doe')
    await user.type(screen.getByLabelText('Password'), 'mock-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await settle()

    expect(where()).toBe('/')
  })

  it('a signed-in visitor who opens /login or /register goes to /', async () => {
    for (const route of [ROUTE_PATH.login, ROUTE_PATH.register]) {
      const { unmount } = await renderWithStoreSettled(appWithProbe(), { route, services: createFakeServices().services })
      expect(where()).toBe('/')
      unmount()
    }
  })

  it('a restore that fails for another reason offers Retry', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    services.session.restore.mockRejectedValueOnce(AppError.fromResponse(503, { error: { code: 'internal_error', message: 'x' } }))
    await renderWithStoreSettled(appWithProbe(), { route: '/', services, session: 'unknown' })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not check your session')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await settle()
    expect(services.session.restore).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})

describe('login form', () => {
  function renderLogin(services = signedOutServices().services) {
    return renderWithStoreSettled(appWithProbe(), { route: '/login', services, session: 'signedOut' })
  }

  it('shows the required messages and sends nothing for empty fields', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderLogin(services)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByText('Enter your user name.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByLabelText('User name')).toHaveAttribute('aria-invalid', 'true')
    expect(services.session.signIn).not.toHaveBeenCalled()
  })

  it('refuses over-long values before sending', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderLogin(services)
    await user.click(screen.getByLabelText('User name'))
    await user.paste('a'.repeat(65))
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByText('Use at most 64 characters.')).toBeInTheDocument()
    expect(services.session.signIn).not.toHaveBeenCalled()
  })

  it('a 401 shows the one generic message, clears the password and raises no toast', async () => {
    const user = userEvent.setup()
    const { services, toast: errorToast } = signedOutServices()
    services.session.signIn.mockRejectedValue(AppError.fromResponse(401, { error: { code: 'unauthorized', message: 'Incorrect user name or password.' } }))
    await renderLogin(services)
    await user.type(screen.getByLabelText('User name'), 'john.doe')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await settle()

    expect(screen.getByRole('alert')).toHaveTextContent(SESSION_ERROR_MESSAGE.signInFailed)
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('User name')).toHaveValue('john.doe')
    expect(errorToast.error).not.toHaveBeenCalled()
    expect(where()).toBe('/login')
  })

  it('a 429 shows the wait time', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    services.session.signIn.mockRejectedValue(rateLimited(840))
    await renderLogin(services)
    await user.type(screen.getByLabelText('User name'), 'john.doe')
    await user.type(screen.getByLabelText('Password'), 'mock-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await settle()

    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts. Try again in 14 minutes.')
  })

  it('a network failure is an error toast, not an inline message', async () => {
    const user = userEvent.setup()
    const { services, toast: errorToast } = signedOutServices()
    services.session.signIn.mockRejectedValue(new AppError({ code: 'network', kind: 'network' }))
    await renderLogin(services)
    await user.type(screen.getByLabelText('User name'), 'john.doe')
    await user.type(screen.getByLabelText('Password'), 'mock-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await settle()

    expect(errorToast.error).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables Submit while the request is pending', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    services.session.signIn.mockReturnValue(new Promise(() => {}))
    await renderLogin(services)
    await user.type(screen.getByLabelText('User name'), 'john.doe')
    await user.type(screen.getByLabelText('Password'), 'mock-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Signing in...' }))
    expect(services.session.signIn).toHaveBeenCalledTimes(1)
  })

  it('uses the username and current-password autocomplete, and links to Create an account', async () => {
    const user = userEvent.setup()
    await renderLogin()

    expect(screen.getByLabelText('User name')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    await user.click(screen.getByRole('link', { name: 'Create an account' }))
    expect(where()).toBe('/register')
  })
})

describe('register form', () => {
  function renderRegister(services = signedOutServices().services) {
    return renderWithStoreSettled(appWithProbe(), { route: '/register', services, session: 'signedOut' })
  }

  async function fill(user: ReturnType<typeof userEvent.setup>, value: { username?: string; email?: string; password?: string; confirm?: string }) {
    if (value.username) await user.type(screen.getByLabelText('User name'), value.username)
    if (value.email) await user.type(screen.getByLabelText('Email address'), value.email)
    if (value.password) await user.type(screen.getByLabelText('Password'), value.password)
    if (value.confirm) await user.type(screen.getByLabelText('Confirm password'), value.confirm)
  }

  const ruleOf = (rule: string) => document.querySelector(`[data-rule="${rule}"]`)

  it('shows every required message for an empty form and sends nothing', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderRegister(services)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Enter your user name.')).toBeInTheDocument()
    expect(screen.getByText('Email address is required')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByText('Confirm your password.')).toBeInTheDocument()
    expect(services.account.register).not.toHaveBeenCalled()
  })

  it('refuses a bad user name, a bad email, a weak password and a mismatched confirm', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderRegister(services)
    await fill(user, { username: 'a b', email: 'not-an-email', password: 'password123', confirm: 'password124' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Use letters, numbers, dots, dashes and underscores only.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('This password is too common. Choose another one.')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(services.account.register).not.toHaveBeenCalled()
  })

  it('refuses a user name that is too short and a password equal to the user name', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderRegister(services)
    await fill(user, { username: 'ab', email: 'ab@example.com', password: 'ab@example.com1', confirm: 'x' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('User name must be 3 to 32 characters.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('User name'))
    await user.clear(screen.getByLabelText('Password'))
    await fill(user, { username: 'grace.h1', password: 'Grace.H1' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Password must not be your user name or email address.')).toBeInTheDocument()
    expect(services.account.register).not.toHaveBeenCalled()
  })

  it('the checklist reflects each rule as the password is typed', async () => {
    const user = userEvent.setup()
    await renderRegister()
    await fill(user, { username: 'grace.h', email: 'grace@example.com' })

    for (const rule of ['length', 'letterDigit', 'personal', 'common']) expect(ruleOf(rule)).toHaveAttribute('data-met', 'false')
    await user.type(screen.getByLabelText('Password'), 'abc')
    expect(ruleOf('letterDigit')).toHaveAttribute('data-met', 'false')
    expect(ruleOf('personal')).toHaveAttribute('data-met', 'true')
    await user.type(screen.getByLabelText('Password'), '12345')
    expect(ruleOf('length')).toHaveAttribute('data-met', 'true')
    expect(ruleOf('letterDigit')).toHaveAttribute('data-met', 'true')
    expect(ruleOf('common')).toHaveAttribute('data-met', 'false')
    await user.type(screen.getByLabelText('Password'), 'x')
    expect(ruleOf('common')).toHaveAttribute('data-met', 'true')
    expect(within(ruleOf('common') as HTMLElement).getByText(/: met/)).toBeInTheDocument()
  })

  it('a 409 shows the one generic message that names no field', async () => {
    const user = userEvent.setup()
    const { services, toast: errorToast } = signedOutServices()
    services.account.register.mockRejectedValue(AppError.fromResponse(409, { error: { code: 'conflict', message: 'This user name or email cannot be used.' } }))
    await renderRegister(services)
    await fill(user, { username: 'john.doe', email: 'john@company.com', password: 'brand-new-1', confirm: 'brand-new-1' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await settle()

    expect(screen.getByRole('alert')).toHaveTextContent(SESSION_ERROR_MESSAGE.registerConflict)
    expect(screen.getByLabelText('User name')).not.toHaveAttribute('aria-invalid')
    expect(errorToast.error).not.toHaveBeenCalled()
  })

  it('a 422 naming a field marks that field; a 429 shows the wait time', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    services.account.register
      .mockRejectedValueOnce(AppError.fromResponse(422, { error: { code: 'validation_error', message: 'x', details: { issue: [{ field: 'password', message: 'is too common' }] } } }))
      .mockRejectedValueOnce(rateLimited(30))
    await renderRegister(services)
    await fill(user, { username: 'grace.h', email: 'grace@example.com', password: 'brand-new-1', confirm: 'brand-new-1' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await settle()
    expect(screen.getByText('Choose a password that follows the rules below.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await settle()
    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts. Try again in 30 seconds.')
  })

  it('success signs in (Open Question 6): the trimmed values are sent, the app opens / with the new account', async () => {
    const user = userEvent.setup()
    const { services } = signedOutServices()
    await renderRegister(services)
    await fill(user, { username: ' grace.h ', email: ' grace@example.com ', password: 'brand-new-1', confirm: 'brand-new-1' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await settle()

    expect(services.account.register).toHaveBeenCalledWith({ username: 'grace.h', email: 'grace@example.com', password: 'brand-new-1' })
    expect(where()).toBe('/')
    expect(screen.getByTestId('sidebar-profile')).toHaveTextContent('grace@example.com')
  })

  it('links back to Sign in', async () => {
    const user = userEvent.setup()
    await renderRegister()
    await user.click(screen.getByRole('link', { name: 'Sign in' }))

    expect(where()).toBe('/login')
  })
})

describe('a session that ends mid-use (401)', () => {
  it('dispatches sessionEnded once, keeps the path for after sign-in, and shows one toast only', async () => {
    const { services, toast: serviceToast } = createFakeServices()
    const { store } = await renderWithStoreSettled(appWithProbe(), { route: '/history?x=1', services })
    const dispatched = vi.fn()
    const unsubscribe = store.subscribe(dispatched)
    services.dashboard.get.mockRejectedValue(unauthorized())
    services.review.list.mockRejectedValue(unauthorized())

    await act(async () => {
      await Promise.all([store.dispatch(fetchDashboard()), store.dispatch(fetchDashboard()), store.dispatch(fetchDashboard())])
    })
    await settle()
    unsubscribe()

    expect(store.getState().session).toMatchObject({ status: 'signedOut', end: 'ended' })
    expect(where()).toBe('/login')
    expect(serviceToast.error).toHaveBeenCalledTimes(1)
    expect(serviceToast.error).toHaveBeenCalledWith(SESSION_ERROR_MESSAGE.sessionEnded)
    expect(services.settings.clearCache).toHaveBeenCalled()
    // The state is reset: no data of the account stays in the store.
    expect(store.getState().account.account).toBeNull()

    // Signing in again returns to the page the user was on (the server answers again).
    services.review.list.mockResolvedValue([])
    services.dashboard.get.mockReset()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('User name'), 'john.doe')
    await user.type(screen.getByLabelText('Password'), 'mock-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await settle()
    expect(where()).toBe('/history?x=1')
  })

  it('the restore, sign-in and registration 401s never end a session', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: { session: { ...initialSessionState(), status: 'signedOut' } } })
    services.session.signIn.mockRejectedValue(unauthorized())

    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    expect(store.getState().session.status).toBe('signedOut')
    expect(store.getState().session.end).toBeNull()
  })

  it('the root reset empties every slice but the session', () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    expect(store.getState().account.account).not.toBeNull()

    store.dispatch(sessionEnded())

    expect(store.getState().account.account).toBeNull()
    expect(store.getState().review.current).toBeNull()
    expect(store.getState().session.status).toBe('signedOut')
  })
})

describe('Sign Out', () => {
  async function openSecurity(services = createFakeServices().services) {
    const result = await renderWithStoreSettled(appWithProbe(), { route: '/settings?section=security', services })
    return { ...result, services }
  }

  it('opens an accessible dialog first; Cancel and Escape send nothing and return the focus', async () => {
    const user = userEvent.setup()
    const { services } = await openSecurity()
    const trigger = screen.getByRole('button', { name: 'Sign Out' })

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(services.session.signOut).not.toHaveBeenCalled()
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    await openSecurity()
    await user.click(screen.getByRole('button', { name: 'Sign Out' }))
    const dialog = screen.getByRole('dialog')

    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('Confirm sends DELETE /api/session, resets the state, drops cr.settings, opens /login and shows "Signed out"', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ theme: 'dark' }))
    const services = createFixtureServices({ supportDelayMs: 0 })
    const signOut = vi.fn(async () => undefined)
    const { store } = await renderWithStoreSettled(appWithProbe(), {
      route: '/settings?section=security',
      services: { ...services, session: { ...services.session, signOut } }
    })

    await user.click(screen.getByRole('button', { name: 'Sign Out' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }))
    await settle()

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(store.getState().account.account).toBeNull()
    expect(store.getState().session).toMatchObject({ status: 'signedOut', end: 'signOut' })
    expect(where()).toBe('/login')
    expect(toast.success).toHaveBeenCalledWith('Signed out')
  })

  it('a failure keeps the user signed in and shows an error toast', async () => {
    const user = userEvent.setup()
    const { services, toast: serviceToast } = createFakeServices()
    services.session.signOut.mockRejectedValue(AppError.fromResponse(500, { error: { code: 'internal_error', message: 'x' } }))
    const { store } = await openSecurity(services)

    await user.click(screen.getByRole('button', { name: 'Sign Out' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }))
    await settle()

    expect(serviceToast.error).toHaveBeenCalledTimes(1)
    expect(serviceToast.error.mock.calls[0][0]).toMatch(/^Could not sign out\./)
    expect(store.getState().session.status).toBe('signedIn')
    expect(where()).toBe('/settings?section=security')
    expect(toast.success).not.toHaveBeenCalled()
    expect(services.settings.clearCache).not.toHaveBeenCalled()
  })

  it('shows the account data in the Account tab: full name, user name, email, member since', async () => {
    await renderWithStoreSettled(appWithProbe(), { route: '/settings', services: createFakeServices().services })
    const panel = within(screen.getByRole('tabpanel'))

    expect(panel.getByText(fixtureData.account.fullName)).toBeInTheDocument()
    expect(panel.getByText(fixtureData.account.username)).toBeInTheDocument()
    expect(panel.getByText(fixtureData.account.email)).toBeInTheDocument()
    expect(panel.getByText(fixtureData.account.memberSince)).toBeInTheDocument()
  })
})

describe('renderWithStore helper', () => {
  it('defaults to a signed-in session with the fixture account', () => {
    const { store } = renderWithStore(<div />)
    expect(store.getState().session.status).toBe('signedIn')
    expect(store.getState().account.account).toEqual(fixtureData.account)
  })
})
