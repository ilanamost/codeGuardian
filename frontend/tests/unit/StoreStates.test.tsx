import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { AppSettings } from '../../src/models/settings.model'
import { recentReviewList } from '../utils/sampleData'
import { createServices } from '../../src/services'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createFixtureDataSource, createFixtureServices } from '../utils/fixtureDataSource'
import { createSettingsService, settingsStorageKey } from '../../src/services/settings.service'
import { createStorageService } from '../../src/services/storage.service'
import { fixtureData } from '../utils/fixtureData'
import { renderWithStore, settle } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

// Settings on the fake backend, so only the page's own requests reach the failing API.
function localSettings() {
  const storage = createStorageService()
  return createSettingsService(createFixtureDataSource({ storage }), storage)
}

// The HTTP API against a backend that is down (every request fails at the network level). Settings
// stay local so only the page's own requests can fail.
function offlineApiServices() {
  const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new TypeError('Failed to fetch'))
  const services = createServices({
    dataSource: createApiService({ baseUrl: 'http://api.test', fetchFn }),
    override: { settings: localSettings() }
  })
  return { services, fetchFn }
}

// The HTTP API against a backend that answers every request with HTTP 500 (a domain failure, not a
// connection problem).
function failingApiServices() {
  const fetchFn = vi.fn<FetchFn>().mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'boom', message: 'x' }, requestId: 'r' }), { status: 500 }))
  return createServices({
    dataSource: createApiService({ baseUrl: 'http://api.test', fetchFn }),
    override: { settings: localSettings() }
  })
}

// Turns the "Review failed" notification off the way the Settings page stores it.
function turnReviewFailedOff() {
  const settings = AppSettings.defaultDto()
  window.localStorage.setItem(settingsStorageKey, JSON.stringify({ ...settings, notification: { ...settings.notification, reviewFailed: false } }))
}

describe('loading states', () => {
  it('shows a loading line in History until the list arrives, then the rows', async () => {
    renderWithStore(<App />, { route: '/history' })

    expect(screen.getByRole('status')).toHaveTextContent('Loading reviews...')
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument()
    await settle()
    expect(screen.getAllByTestId('review-row')).toHaveLength(recentReviewList.length)
  })

  it('shows a loading line on the Review page until the review arrives', async () => {
    renderWithStore(<App />, { route: '/review/r1' })

    expect(screen.getByRole('status')).toHaveTextContent('Loading review...')
    await settle()
    expect(screen.getByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
  })
})

describe('API failures (backend down)', () => {
  it('History shows the error toast once and the error instead of the empty state', async () => {
    const { services } = offlineApiServices()
    renderWithStore(<App />, { route: '/history', services })
    await settle()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Could not load the review. Check your internet connection and try again.')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the review.')
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument()
  })

  it('History still shows a network outage when Review failed notifications are off', async () => {
    const { services } = offlineApiServices()
    turnReviewFailedOff()
    renderWithStore(<App />, { route: '/history', services })
    await settle()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Could not load the review. Check your internet connection and try again.')
  })

  it('History shows no toast for a server-side review failure when Review failed is off', async () => {
    turnReviewFailedOff()
    renderWithStore(<App />, { route: '/history', services: failingApiServices() })
    await settle()

    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the review. The server had a problem')
  })

  it('History shows the server-side review failure when Review failed is on', async () => {
    renderWithStore(<App />, { route: '/history', services: failingApiServices() })
    await settle()

    expect(toast.error).toHaveBeenCalledWith('Could not load the review. The server had a problem, please try again shortly.')
  })

  it('Dashboard reports its own failure even when Review failed is off, with an on-page retry', async () => {
    const user = userEvent.setup()
    turnReviewFailedOff()
    const services = failingApiServices()
    renderWithStore(<App />, { route: '/', services })
    await settle()

    // Only the dashboard error: the review list failure (HTTP 500) follows the preference.
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Could not load the dashboard. The server had a problem, please try again shortly.')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Dashboard unavailable')
    expect(screen.queryByTestId('stat-total')).not.toBeInTheDocument()

    services.dashboard.get = vi.fn(createFixtureServices().dashboard.get)
    services.review.list = vi.fn(createFixtureServices().review.list)
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(screen.getByTestId('stat-total')).toHaveTextContent('Total Reviews24')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Review page shows Review unavailable and the toast', async () => {
    const { services } = offlineApiServices()
    renderWithStore(<App />, { route: '/review/r1', services })
    await settle()

    expect(screen.getByRole('heading', { name: 'Review unavailable' })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('GitHub connect failure is always reported', async () => {
    const user = userEvent.setup()
    const { services } = offlineApiServices()
    turnReviewFailedOff()
    renderWithStore(<App />, { route: '/github', services })

    await user.type(screen.getByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(toast.error).toHaveBeenCalledWith('GitHub authorization failed. Check your internet connection and try again.')
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('Contact Support keeps the form values when submitting fails', async () => {
    const user = userEvent.setup()
    const { services } = offlineApiServices()
    renderWithStore(<App />, { route: '/help?topic=contact', services })

    await user.click(screen.getByRole('radio', { name: 'Other' }))
    // The email starts from the signed-in account.
    expect(screen.getByLabelText('Email address')).toHaveValue(fixtureData.account.email)
    await user.clear(screen.getByLabelText('Email address'))
    await user.type(screen.getByLabelText('Email address'), 'me@example.com')
    await user.type(screen.getByLabelText('Describe the problem'), 'The review never finishes')
    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    expect(toast.error).toHaveBeenCalledWith('Could not submit your request. Check your internet connection and try again.')
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Describe the problem')).toHaveValue('The review never finishes')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('History with a failing service', () => {
  it('does not show the delete toast when the review list cannot delete', async () => {
    const user = userEvent.setup()
    const services = createFixtureServices()
    services.review.delete = vi.fn().mockRejectedValue(new Error('boom'))
    renderWithStore(<App />, { route: '/history', services })
    await settle()

    const first = screen.getAllByTestId('review-row')[0]
    await user.click(within(first).getByRole('button', { name: /^Delete review / }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not delete the review. Please try again.')
    expect(screen.getAllByTestId('review-row')).toHaveLength(recentReviewList.length)
  })
})
