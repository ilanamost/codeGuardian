// QA for plan 017 Validation "with no backend running, each page shows its error toast once".
// Plan 035: the HTTP API is the only data source; this injects it with a fetch that always
// fails, as the browser does when nothing listens.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { SESSION_TEXT } from '../../src/lib/session.constants'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createServices } from '../../src/services'
import { PAGE_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { renderWithStore, settle } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

const settingsToast = 'Could not load your settings. Check your internet connection and try again.'
const dashboardToast = 'Could not load the dashboard. Check your internet connection and try again.'
const reviewToast = 'Could not load the review. Check your internet connection and try again.'

function downServices() {
  const toast = { success: vi.fn(), error: vi.fn() }
  const fetchFn = vi.fn<FetchFn>(async () => {
    throw new TypeError('Failed to fetch')
  })
  // dedupeMs 0: a repeated toast would be counted, not hidden by the dedupe window.
  const services = createServices({ dataSource: createApiService({ baseUrl: 'http://x', fetchFn }), notification: { toast, dedupeMs: 0 } })
  return { services, toast, fetchFn }
}

describe('QA: no backend, signed-in session', () => {
  it.each<[string, string[]]>([
    ['/', [dashboardToast, reviewToast, settingsToast]],
    ['/history', [reviewToast, settingsToast]],
    ['/review/r1', [reviewToast, settingsToast]],
    ['/github', [settingsToast]],
    ['/settings', [settingsToast]],
    ['/help?topic=contact', [settingsToast]],
    ['/help', [settingsToast]]
  ])('%s shows one toast per failed load and never repeats one', async (route, expected) => {
    const { services, toast, fetchFn } = downServices()

    renderWithStore(<App />, { route, services })
    await settle()
    await settle()

    const shown = toast.error.mock.calls.map(([message]) => message)
    expect(shown.sort()).toEqual([...expected].sort())
    // One request per failed load; the account came with the session, so it is not loaded again.
    // Plan 040: Settings also reads the GitHub sign-in flag from /api/health, a background
    // request whose failure is silent (it only hides the GitHub row), so it is not counted.
    expect(fetchFn.mock.calls.filter(([input]) => !input.endsWith('/api/health'))).toHaveLength(expected.length)
    expect(fetchFn.mock.calls.filter(([input]) => input.endsWith('/api/account'))).toHaveLength(0)
  })
})

// Plan 035, Validation 7 (Open Question 4A): the existing error state and error notification
// only, no dedicated offline screen.
describe('QA: no backend, session not checked yet', () => {
  it.each(['/', '/history', '/login'])('%s shows the session error state with Retry and one error toast', async (route) => {
    const { services, toast, fetchFn } = downServices()

    renderWithStore(<App />, { route, services, session: 'unknown' })
    await settle()
    await settle()

    expect(fetchFn.mock.calls.map(([input]) => input)).toEqual(['http://x/api/session'])
    expect(screen.getByRole('alert')).toHaveTextContent(PAGE_ERROR_MESSAGE.sessionUnavailable)
    expect(screen.getByRole('button', { name: SESSION_TEXT.retry })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error.mock.calls[0][0]).toMatch(/^Could not check your session\./)
  })
})
