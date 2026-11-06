import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import App from '../../src/App'
import ReviewHistoryList from '../../src/components/ReviewHistoryList'
import { notify } from '../../src/lib/useSettings'
import { settingsStorageKey } from '../../src/services/settings.service'
import { defaultSettings } from '../../src/lib/settings.constants'
import { AppError } from '../../src/models/app-error'
import { initialAccountState } from '../../src/store/account.slice'
import { fixtureData } from '../utils/fixtureData'
import { createFakeServices } from '../utils/fakeServices'
import { recentReviewList } from '../utils/sampleData'
import { renderWithStore, renderWithStoreSettled } from '../utils/renderWithStore'

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ options }: { options: { fontSize: number } }) => <div data-testid="monaco" data-font-size={options.fontSize} />
}))

function renderApp(path = '/settings') {
  return renderWithStoreSettled(<App />, { route: path })
}

async function openSection(name: string) {
  await userEvent.setup().click(screen.getByRole('tab', { name }))
}

function sidebarLink(name: string) {
  return within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name })
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

describe('Settings page', () => {
  it('lists the five sections and shows Account first with mock data', async () => {
    await renderApp()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Account',
      'Security',
      'Notifications',
      'Appearance',
      'AI preferences'
    ])
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByText('John Doe')).toBeInTheDocument()
    expect(panel.getByText('john@company.com')).toBeInTheDocument()
    expect(panel.getByText('Member since')).toBeInTheDocument()
    expect(panel.getByText(fixtureData.account.memberSince)).toBeInTheDocument()
    expect(panel.getByRole('img', { name: 'Profile image' })).toHaveTextContent('JD')
  })

  it('shows the profile from the account service (GET /api/account)', async () => {
    const { services } = createFakeServices()
    services.account.get.mockResolvedValue({ username: 'ada.lovelace', fullName: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: null, memberSince: 'May 1, 2024' })
    // Signed in, but the account is not loaded yet.
    await renderWithStoreSettled(<App />, { route: '/settings', services, preloadedState: { account: initialAccountState } })

    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(panel.getByText('ada@example.com')).toBeInTheDocument()
    expect(panel.getByRole('img', { name: 'Profile image' })).toHaveTextContent('AL')
    expect(services.account.get).toHaveBeenCalledTimes(1)
  })

  it('says the account is unavailable and shows one error toast when it cannot load', async () => {
    const { services, toast: errorToast } = createFakeServices()
    services.account.get.mockRejectedValue(AppError.fromResponse(500, { error: { code: 'internal_error', message: 'x' } }))
    await renderWithStoreSettled(<App />, { route: '/settings', services, preloadedState: { account: initialAccountState } })

    expect(within(screen.getByRole('tabpanel')).getByRole('status')).toHaveTextContent('Account details are unavailable.')
    expect(errorToast.error).toHaveBeenCalledTimes(1)
    expect(errorToast.error.mock.calls[0][0]).toMatch(/^Could not load your account\./)
  })

  it('switches the panel when a section is chosen', async () => {
    await renderApp()

    await openSection('Notifications')

    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByText('Member since')).not.toBeInTheDocument()
  })

  it('links to settings from the sidebar', async () => {
    await renderApp()

    expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Settings', current: 'page' })).toHaveAttribute('href', '/settings')
  })
})

describe('Security section', () => {
  it('hides new and confirm password until Update password is clicked', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')

    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
    expect(screen.queryByText('Active Sessions')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update password' }))

    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
  })

  it('flips the input type with the reveal toggles', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    for (const label of ['Current password', 'New password', 'Confirm password']) {
      const input = screen.getByLabelText(label)
      expect(input).toHaveAttribute('type', 'password')
      await user.click(screen.getByRole('button', { name: `Show ${label.toLowerCase()}` }))
      expect(input).toHaveAttribute('type', 'text')
      await user.click(screen.getByRole('button', { name: `Hide ${label.toLowerCase()}` }))
      expect(input).toHaveAttribute('type', 'password')
    }
  })

  it('asks for the current password first', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.type(screen.getByLabelText('New password'), 'longenough1')
    await user.type(screen.getByLabelText('Confirm password'), 'longenough1')
    await user.click(screen.getByRole('button', { name: 'Save password' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter your current password.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows an error when the passwords do not match', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.type(screen.getByLabelText('Current password'), fixtureData.password)
    await user.type(screen.getByLabelText('New password'), 'longenough1')
    await user.type(screen.getByLabelText('Confirm password'), 'different99')
    await user.click(screen.getByRole('button', { name: 'Save password' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows an error when the password is too short', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.type(screen.getByLabelText('Current password'), fixtureData.password)
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Save password' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Password must be 8 to 200 characters.')
  })

  it('applies the password rules before sending: a letter and a digit, not a common password', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    await renderWithStoreSettled(<App />, { route: '/settings?section=security', services })
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.type(screen.getByLabelText('Current password'), fixtureData.password)
    await user.type(screen.getByLabelText('New password'), 'no-digits-here')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('at least one letter and one digit')

    await user.clear(screen.getByLabelText('New password'))
    await user.type(screen.getByLabelText('New password'), 'Password123')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('too common')
    expect(services.account.changePassword).not.toHaveBeenCalled()
  })

  async function changePassword(user: ReturnType<typeof userEvent.setup>, current: string, next: string) {
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.type(screen.getByLabelText('Current password'), current)
    await user.type(screen.getByLabelText('New password'), next)
    await user.type(screen.getByLabelText('Confirm password'), next)
    await user.click(screen.getByRole('button', { name: 'Save password' }))
  }

  it('confirms a valid update with a toast and hides the form', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await changePassword(user, fixtureData.password, 'longenough1')

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password updated'))
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('marks a wrong current password under its field, with no error toast', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await changePassword(user, 'not-the-password', 'longenough1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is not correct.')
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('New password')).not.toHaveAttribute('aria-invalid')
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Current password'), 'x')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses the new password from then on', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Security')
    await changePassword(user, fixtureData.password, 'longenough1')
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password updated'))

    await changePassword(user, fixtureData.password, 'longenough2')
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is not correct.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await changePassword(user, 'longenough1', 'longenough2')
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2))
  })

  it('shows one error toast and keeps the form when the server fails', async () => {
    const user = userEvent.setup()
    const { services, toast: errorToast } = createFakeServices()
    services.account.changePassword.mockRejectedValue(AppError.fromResponse(500, { error: { code: 'internal_error', message: 'x' } }))
    await renderWithStoreSettled(<App />, { route: '/settings', services })
    await openSection('Security')
    await changePassword(user, 'anything', 'longenough1')

    await vi.waitFor(() => expect(errorToast.error).toHaveBeenCalledTimes(1))
    expect(errorToast.error.mock.calls[0][0]).toMatch(/^Could not update your password\./)
    expect(services.account.changePassword).toHaveBeenCalledWith({ currentPassword: 'anything', newPassword: 'longenough1' })
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  // Plan 028: the API-mode Sign Out (dialog, DELETE /api/session) is in SignOut.test.tsx.
  // Plan 035: no mock mode, so Sign Out is always there and no mode note is shown.
  it('always shows Sign Out and no mock-mode note; opening the section sends no sign-out', async () => {
    const { services } = createFakeServices()
    await renderWithStoreSettled(<App />, { route: '/settings?section=security', services })

    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeEnabled()
    expect(screen.queryByText(/Mock mode/)).not.toBeInTheDocument()
    expect(services.session.signOut).not.toHaveBeenCalled()
  })

  it('Update password works against the fake backend', async () => {
    const user = userEvent.setup()
    await renderApp('/settings?section=security')
    await changePassword(user, fixtureData.password, 'longenough1')

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password updated'))
  })
})

describe('Settings ?section= parameter (plan 028)', () => {
  it('opens the section named in the URL and writes the chosen one back', async () => {
    const user = userEvent.setup()
    await renderApp('/settings?section=notifications')

    expect(screen.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Security' }))
    expect(screen.getByRole('tab', { name: 'Security' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument()
  })

  it('shows Account for an unknown section', async () => {
    await renderApp('/settings?section=nope')

    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the email note: no email is sent yet', async () => {
    await renderApp('/settings?section=notifications')

    expect(screen.getByText(/Email delivery is not available yet/)).toBeInTheDocument()
  })
})

describe('Notifications section', () => {
  it('updates a toggle and persists it', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Notifications')
    const toggle = screen.getByRole('switch', { name: 'Review failed' })

    expect(toggle).toBeChecked()
    await user.click(toggle)

    expect(toggle).not.toBeChecked()
    expect(JSON.parse(window.localStorage.getItem(settingsStorageKey)!).notification.reviewFailed).toBe(false)
  })

  it('raises a toast only for enabled types', async () => {
    const settings = { ...defaultSettings, notification: { ...defaultSettings.notification, reviewCompleted: false } }

    expect(notify(settings, 'reviewCompleted', 'Done')).toBe(false)
    expect(notify(settings, 'reviewFailed', 'Boom')).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Boom')
  })

  it('does not toast from the test button when the type is off', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Notifications')
    await user.click(screen.getByRole('switch', { name: 'Review completed' }))
    await user.click(screen.getByRole('button', { name: /Send test Review completed/ }))

    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Appearance section', () => {
  it('selects the defaults', async () => {
    await renderApp()
    await openSection('Appearance')

    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Medium/ })).toBeChecked()
    expect(screen.queryByText('Default editor layout')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Comfortable/ })).toBeChecked()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('sets data-theme when the theme radio changes', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('Appearance')
    await user.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('offers System default and follows the OS appearance live', async () => {
    let osDark = true
    const listenerList: Array<() => void> = []
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() {
        return osDark
      },
      addEventListener: (_: string, listener: () => void) => listenerList.push(listener),
      removeEventListener: (_: string, listener: () => void) => {
        listenerList.splice(listenerList.indexOf(listener), 1)
      }
    })) as unknown as typeof window.matchMedia

    try {
      const user = userEvent.setup()
      await renderApp()
      await openSection('Appearance')
      await user.click(screen.getByRole('radio', { name: /System default/ }))

      expect(document.documentElement.dataset.theme).toBe('dark')

      osDark = false
      act(() => listenerList.forEach((listener) => listener()))
      expect(document.documentElement.dataset.theme).toBe('light')

      await user.click(screen.getByRole('radio', { name: 'Dark' }))
      expect(listenerList).toHaveLength(0)
    } finally {
      // @ts-expect-error restore jsdom default (no matchMedia)
      delete window.matchMedia
    }
  })

  it('falls back to light for System default where matchMedia is unavailable', async () => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ theme: 'system' }))
    await renderApp()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('restores saved settings on the next load', async () => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ theme: 'dark' }))
    await renderApp()

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to defaults when storage is corrupt', async () => {
    window.localStorage.setItem(settingsStorageKey, '{not json')
    await renderApp()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies the editor font size to Monaco', async () => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ editorFontSize: 'large' }))
    await renderApp('/review/new')

    const size = Number(screen.getByTestId('monaco').getAttribute('data-font-size'))
    expect(size).toBeGreaterThanOrEqual(16)
  })

  it('applies compact density to the history list', async () => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ historyDensity: 'compact' }))
    renderWithStore(<ReviewHistoryList reviewList={recentReviewList} />)

    expect(screen.getByRole('list')).toHaveAttribute('data-density', 'compact')
  })
})

describe('AI preferences section', () => {
  it('selects the defaults', async () => {
    await renderApp()
    await openSection('AI preferences')

    expect(screen.getByRole('radio', { name: 'All categories' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Balanced/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Detailed/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Generated tests' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Programming language' })).toHaveValue('auto')
  })

  it('hides the Generated tests tab when the toggle is off', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('AI preferences')
    await user.click(screen.getByRole('switch', { name: 'Generated tests' }))
    await user.click(sidebarLink('New Review'))

    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('uses the default language on the review page', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openSection('AI preferences')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Programming language' }), 'Python')
    await user.click(sidebarLink('New Review'))

    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('Python')
  })
})
