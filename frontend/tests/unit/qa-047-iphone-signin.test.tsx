import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PasswordField from '../../src/components/PasswordField'
import TextField from '../../src/components/TextField'
import { COOKIE_BLOCKED_WINDOW_MS } from '../../src/lib/session.constants'
import { AppError } from '../../src/models/app-error'
import { createAppStore } from '../../src/store'
import { fetchDashboard } from '../../src/store/dashboard.slice'
import { initialSessionState, signIn } from '../../src/store/session.slice'
import { SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { settle } from '../utils/renderWithStore'

// Plan 047: no zoom on iPhone (16px inputs below 640px) and a clear message when the browser did
// not keep the session cookie.

afterEach(() => {
  vi.useRealTimers()
})

const unauthorized = () => AppError.fromResponse(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })

describe('input font size', () => {
  it('TextField uses 16px on phones and 14px from 640px up', () => {
    render(<TextField label="User name" value="" onChange={() => {}} />)
    expect(screen.getByLabelText('User name')).toHaveClass('text-base', 'sm:text-sm')
    expect(screen.getByLabelText('User name')).not.toHaveClass('text-sm')
  })

  it('PasswordField uses 16px on phones and 14px from 640px up', () => {
    render(<PasswordField label="Password" value="" onChange={() => {}} />)
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveClass('text-base', 'sm:text-sm')
    expect(screen.getByLabelText('Password', { selector: 'input' })).not.toHaveClass('text-sm')
  })
})

describe('a session that ends right after sign-in', () => {
  function signedOutStore() {
    const fake = createFakeServices()
    const store = createAppStore({ services: fake.services, preloadedState: { session: { ...initialSessionState(), status: 'signedOut' } } })
    fake.services.dashboard.get.mockRejectedValue(unauthorized())
    return { ...fake, store }
  }

  it('shows the cookieBlocked toast once, not sessionEnded, and signs out', async () => {
    const { store, toast } = signedOutStore()
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    expect(store.getState().session.status).toBe('signedIn')

    await Promise.all([store.dispatch(fetchDashboard()), store.dispatch(fetchDashboard())])
    await settle()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(SESSION_ERROR_MESSAGE.cookieBlocked)
    expect(store.getState().session).toMatchObject({ status: 'signedOut', end: 'ended' })
  })

  it('a 401 long after sign-in still shows sessionEnded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { store, toast } = signedOutStore()
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    vi.setSystemTime(Date.now() + COOKIE_BLOCKED_WINDOW_MS + 1000)

    await store.dispatch(fetchDashboard())
    await settle()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(SESSION_ERROR_MESSAGE.sessionEnded)
  })

  it('a wrong password keeps the inline message and raises no toast', async () => {
    const { store, services, toast } = signedOutStore()
    services.session.signIn.mockRejectedValue(unauthorized())

    await store.dispatch(signIn({ username: 'john.doe', password: 'wrong' }))
    await settle()

    expect(store.getState().session.status).toBe('signedOut')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
