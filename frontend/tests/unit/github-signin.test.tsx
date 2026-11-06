import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountPanel from '../../src/components/AccountPanel'
import SecurityPanel from '../../src/components/SecurityPanel'
import { ACCOUNT_TEXT, SECURITY_TEXT } from '../../src/lib/account.constants'
import { authErrorOf, githubSignInUrl } from '../../src/lib/github-signin'
import { AUTH_ERROR_CODE_LIST, AUTH_ERROR_TEXT, SESSION_TEXT } from '../../src/lib/session.constants'
import { githubOAuthOf, isAccountDto, signInMethodOf } from '../../src/models/account.model'
import { AppError } from '../../src/models/app-error'
import type { AccountDto } from '../../src/models/dto'
import LoginPage from '../../src/pages/LoginPage'
import RegisterPage from '../../src/pages/RegisterPage'
import { createAccountService } from '../../src/services/account.service'
import type { DataSource } from '../../src/services/data-source'
import { createSessionService } from '../../src/services/session.service'
import { createAppStore } from '../../src/store'
import { fetchGithubSignIn, initialSessionState, selectGithubSignIn } from '../../src/store/session.slice'
import { toast as sonnerToast } from 'sonner'
import { createFakeServices } from '../utils/fakeServices'
import { fixtureData } from '../utils/fixtureData'
import { renderWithStore, signedInState } from '../utils/renderWithStore'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

// Plan 040: GitHub sign-in, frontend part. The backend redirects, so these tests cover the
// health flag, the button, the auth_error messages, Settings link and unlink, and the
// passwordless Security tab. Nothing here reaches github.com.

function Probe() {
  const location = useLocation()
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
}

const githubOnly: AccountDto = { ...fixtureData.account, signInMethod: 'github', githubLogin: 'octocat' }
const both: AccountDto = { ...fixtureData.account, signInMethod: 'both', githubLogin: 'octocat' }

function withFlag(enabled: boolean) {
  const fake = createFakeServices()
  fake.services.session.githubSignIn.mockResolvedValue(enabled)
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('github sign-in helpers', () => {
  it('builds the start URL, with returnTo only for a page other than home', () => {
    expect(githubSignInUrl()).toMatch(/\/api\/auth\/github$/)
    expect(githubSignInUrl('/')).toMatch(/\/api\/auth\/github$/)
    expect(githubSignInUrl('/history?x=1')).toMatch(/\/api\/auth\/github\?returnTo=%2Fhistory%3Fx%3D1$/)
  })

  it('reads every code of the closed list and treats an unknown value as provider_error', () => {
    for (const code of AUTH_ERROR_CODE_LIST) expect(authErrorOf(code)).toBe(code)
    expect(authErrorOf('whatever')).toBe('provider_error')
    expect(authErrorOf(null)).toBeNull()
    expect(Object.keys(AUTH_ERROR_TEXT).sort()).toEqual([...AUTH_ERROR_CODE_LIST].sort())
  })

  it('reads the health flag and the account fields with safe defaults', () => {
    expect(githubOAuthOf({ status: 'ok', githubOAuth: true })).toBe(true)
    expect(githubOAuthOf({ status: 'ok' })).toBe(false)
    expect(githubOAuthOf({ githubOAuth: 'yes' })).toBe(false)
    expect(githubOAuthOf(null)).toBe(false)
    expect(signInMethodOf(fixtureData.account)).toBe('password')
    expect(isAccountDto(githubOnly)).toBe(true)
    expect(isAccountDto({ ...fixtureData.account, signInMethod: 'sso' })).toBe(false)
    expect(isAccountDto({ ...fixtureData.account, githubLogin: 5 })).toBe(false)
  })
})

describe('services', () => {
  const source = (answer: unknown) => ({ request: vi.fn(async () => answer) }) as unknown as DataSource & { request: ReturnType<typeof vi.fn> }

  it('reads githubOAuth from /api/health as a background request', async () => {
    const dataSource = source({ status: 'ok', githubOAuth: true })
    expect(await createSessionService(dataSource).githubSignIn()).toBe(true)
    expect(dataSource.request).toHaveBeenCalledWith('GET', '/api/health', undefined, { background: true })
  })

  it('links with POST and unlinks with DELETE on /api/auth/github/link', async () => {
    const link = source({ url: 'https://github.com/login/oauth/authorize?x=1' })
    expect(await createAccountService(link).linkGithub()).toBe('https://github.com/login/oauth/authorize?x=1')
    expect(link.request).toHaveBeenCalledWith('POST', '/api/auth/github/link', undefined, undefined)

    const unlink = source({ ...fixtureData.account, signInMethod: 'password', githubLogin: null })
    expect((await createAccountService(unlink).unlinkGithub()).githubLogin).toBeNull()
    expect(unlink.request).toHaveBeenCalledWith('DELETE', '/api/auth/github/link', undefined, undefined)
  })

  it('rejects a link answer without a url', async () => {
    await expect(createAccountService(source({})).linkGithub()).rejects.toBeInstanceOf(AppError)
  })
})

describe('health flag in the store', () => {
  it('stores true, and false when the request fails (never rejects)', async () => {
    const on = withFlag(true)
    const onStore = createAppStore({ services: on.services })
    await onStore.dispatch(fetchGithubSignIn())
    expect(selectGithubSignIn(onStore.getState())).toBe(true)

    const off = createFakeServices()
    off.services.session.githubSignIn.mockRejectedValue(new Error('down'))
    const offStore = createAppStore({ services: off.services })
    await offStore.dispatch(fetchGithubSignIn())
    expect(selectGithubSignIn(offStore.getState())).toBe(false)
    expect(off.toast.error).not.toHaveBeenCalled()
  })

  it('asks once while the answer is known', async () => {
    const { services } = withFlag(true)
    const store = createAppStore({ services })
    await store.dispatch(fetchGithubSignIn())
    await store.dispatch(fetchGithubSignIn())
    expect(services.session.githubSignIn).toHaveBeenCalledTimes(1)
  })

  it('starts unknown, so a new session asks again', () => {
    expect(initialSessionState().githubSignIn).toBeNull()
  })
})

describe('Continue with GitHub', () => {
  it('is absent on /login and /register when GitHub sign-in is not configured', async () => {
    const { services } = withFlag(false)
    const login = renderWithStore(<LoginPage />, { route: '/login', services, session: 'signedOut' })
    await screen.findByRole('button', { name: SESSION_TEXT.signIn })
    await vi.waitFor(() => expect(services.session.githubSignIn).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: SESSION_TEXT.continueWithGithub })).not.toBeInTheDocument()
    login.unmount()

    const register = withFlag(false).services
    renderWithStore(<RegisterPage />, { route: '/register', services: register, session: 'signedOut' })
    await screen.findByRole('button', { name: SESSION_TEXT.register })
    await vi.waitFor(() => expect(register.session.githubSignIn).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: SESSION_TEXT.continueWithGithub })).not.toBeInTheDocument()
  })

  it('is a plain link to the backend on /login and /register when configured', async () => {
    const login = renderWithStore(<LoginPage />, { route: '/login', services: withFlag(true).services, session: 'signedOut' })
    const link = await screen.findByRole('link', { name: SESSION_TEXT.continueWithGithub })
    expect(link.getAttribute('href')).toMatch(/\/api\/auth\/github$/)
    login.unmount()

    renderWithStore(<RegisterPage />, { route: '/register', services: withFlag(true).services, session: 'signedOut' })
    expect((await screen.findByRole('link', { name: SESSION_TEXT.continueWithGithub })).getAttribute('href')).toMatch(/\/api\/auth\/github$/)
  })

  it('sends the page the guard kept as returnTo, and never an unsafe one', async () => {
    const login = renderWithStore(<LoginPage />, { route: '/login', routeState: { from: '/history' }, services: withFlag(true).services, session: 'signedOut' })
    expect((await screen.findByRole('link', { name: SESSION_TEXT.continueWithGithub })).getAttribute('href')).toMatch(/returnTo=%2Fhistory$/)
    login.unmount()

    renderWithStore(<LoginPage />, { route: '/login', routeState: { from: '//evil.example' }, services: withFlag(true).services, session: 'signedOut' })
    expect((await screen.findByRole('link', { name: SESSION_TEXT.continueWithGithub })).getAttribute('href')).not.toContain('returnTo')
  })
})

describe('auth_error on /login', () => {
  it.each(AUTH_ERROR_CODE_LIST)('shows the message for %s and removes the parameter', async (code) => {
    renderWithStore(
      <>
        <LoginPage />
        <Probe />
      </>,
      { route: `/login?auth_error=${code}&keep=1`, services: withFlag(false).services, session: 'signedOut' }
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_TEXT[code])
    await vi.waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?keep=1'))
    expect(screen.getByRole('alert')).toHaveTextContent(AUTH_ERROR_TEXT[code])
  })

  it('shows the rate limit message for rate_limited', async () => {
    expect(AUTH_ERROR_CODE_LIST).toContain('rate_limited')
    renderWithStore(<LoginPage />, { route: '/login?auth_error=rate_limited', services: withFlag(false).services, session: 'signedOut' })
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_TEXT.rate_limited)
  })

  it('shows the provider message for a code it does not know', async () => {
    renderWithStore(<LoginPage />, { route: '/login?auth_error=whatever', services: withFlag(false).services, session: 'signedOut' })
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_TEXT.provider_error)
  })

  it('shows no message without the parameter', async () => {
    renderWithStore(<LoginPage />, { route: '/login', services: withFlag(false).services, session: 'signedOut' })
    await screen.findByRole('button', { name: SESSION_TEXT.signIn })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Settings > Account', () => {
  it('shows nothing about GitHub when it is not configured and the account has no link', async () => {
    const { services } = withFlag(false)
    renderWithStore(<AccountPanel />, { services })
    await screen.findByTestId('account-username')
    await vi.waitFor(() => expect(services.session.githubSignIn).toHaveBeenCalled())
    expect(screen.queryByText(ACCOUNT_TEXT.githubHeading)).not.toBeInTheDocument()
  })

  it('links: asks the backend for the URL and navigates the browser to it', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const user = userEvent.setup()
    renderWithStore(<AccountPanel />, { services: withFlag(true).services })

    expect(await screen.findByTestId('github-sign-in-state')).toHaveTextContent(ACCOUNT_TEXT.githubNotConnected)
    await user.click(screen.getByRole('button', { name: ACCOUNT_TEXT.githubLink }))

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.example/authorize'))
  })

  it('a failed link start reports the error and does not navigate', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const user = userEvent.setup()
    const { services, toast } = withFlag(true)
    services.account.linkGithub.mockRejectedValue(AppError.fromResponse(404, { error: { code: 'not_found', message: 'off' } }))
    renderWithStore(<AccountPanel />, { services })

    await user.click(await screen.findByRole('button', { name: ACCOUNT_TEXT.githubLink }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows "Connected as @login" and unlinks an account that also has a password', async () => {
    const user = userEvent.setup()
    const { services } = withFlag(false)
    renderWithStore(<AccountPanel />, { services, preloadedState: signedInState(both) })

    expect(await screen.findByTestId('github-sign-in-state')).toHaveTextContent('Connected as @octocat')
    await user.click(screen.getByRole('button', { name: ACCOUNT_TEXT.githubUnlink }))

    await vi.waitFor(() => expect(screen.queryByTestId('github-sign-in-state')).not.toBeInTheDocument())
    expect(services.account.unlinkGithub).toHaveBeenCalledTimes(1)
    expect(sonnerToast.success).toHaveBeenCalledWith(ACCOUNT_TEXT.githubUnlinked)
  })

  it('keeps the link of a GitHub-only account (unlink disabled with a hint) and hides Edit', async () => {
    renderWithStore(<AccountPanel />, { services: withFlag(false).services, preloadedState: signedInState(githubOnly) })

    expect(await screen.findByRole('button', { name: ACCOUNT_TEXT.githubUnlink })).toBeDisabled()
    expect(screen.getByText(ACCOUNT_TEXT.githubOnlyHint)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })).not.toBeInTheDocument()
    expect(screen.getByText(ACCOUNT_TEXT.githubNoEdit)).toBeInTheDocument()
  })

  it('a failed unlink keeps the link and reports the error', async () => {
    const user = userEvent.setup()
    const { services, toast } = withFlag(false)
    services.account.unlinkGithub.mockRejectedValue(AppError.fromResponse(409, { error: { code: 'conflict', message: 'no way in' } }))
    renderWithStore(<AccountPanel />, { services, preloadedState: signedInState(both) })

    await user.click(await screen.findByRole('button', { name: ACCOUNT_TEXT.githubUnlink }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByTestId('github-sign-in-state')).toHaveTextContent('Connected as @octocat')
  })

  it('shows the auth_error of a failed link and removes the parameter', async () => {
    renderWithStore(
      <>
        <AccountPanel />
        <Probe />
      </>,
      { route: '/settings?section=account&auth_error=identity_in_use', services: withFlag(true).services }
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_TEXT.identity_in_use)
    await vi.waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/settings?section=account'))
    expect(screen.getByTestId('location')).not.toHaveTextContent('auth_error')
  })
})

describe('Settings > Security', () => {
  it('a password account keeps the Update password button', async () => {
    renderWithStore(<SecurityPanel />, { services: withFlag(false).services })
    expect(await screen.findByRole('button', { name: SECURITY_TEXT.updatePassword })).toBeInTheDocument()
    expect(screen.queryByText(SECURITY_TEXT.githubOnly)).not.toBeInTheDocument()
  })

  it('a GitHub-only account sees the note, no password form, and can still sign out', async () => {
    renderWithStore(<SecurityPanel />, { services: withFlag(false).services, preloadedState: signedInState(githubOnly) })
    expect(await screen.findByText(SECURITY_TEXT.githubOnly)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SECURITY_TEXT.updatePassword })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: SECURITY_TEXT.signOut })).toBeInTheDocument()
  })

  it('an account with GitHub and a password keeps the password form', async () => {
    renderWithStore(<SecurityPanel />, { services: withFlag(false).services, preloadedState: signedInState(both) })
    expect(await screen.findByRole('button', { name: SECURITY_TEXT.updatePassword })).toBeInTheDocument()
  })
})
