import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import AccountPanel from '../../src/components/AccountPanel'
import GlobalLoader from '../../src/components/GlobalLoader'
import Loader from '../../src/components/Loader'
import { ACCOUNT_TEXT } from '../../src/lib/account.constants'
import { DASHBOARD_LOADING_TEXT } from '../../src/lib/dashboard.constants'
import { GITHUB_TEXT } from '../../src/lib/github.constants'
import { LOADER_TEXT, LOADER_TIMING } from '../../src/lib/loader.constants'
import { createRequestTracker } from '../../src/lib/requestTracker'
import { HISTORY_TEXT, REVIEW_TEXT } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import { initialAccountState } from '../../src/store/account.slice'
import { createAppStore } from '../../src/store'
import { fetchReview } from '../../src/store/review.slice'
import { PAGE_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices, detailOf } from '../utils/fakeServices'
import { renderWithStore, settle, signedInState } from '../utils/renderWithStore'
import { sampleReview } from '../utils/sampleData'

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco" />
}))

// Recharts measures its container with ResizeObserver, which jsdom lacks.
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

afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error restore jsdom default (no matchMedia)
  delete window.matchMedia
})

// A promise the test settles itself.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function networkError() {
  return new AppError({ code: 'network', kind: 'network', message: 'offline' })
}

function stubReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia
}

describe('Loader', () => {
  it('is a polite status with the default accessible name', () => {
    render(<Loader />)

    const loader = screen.getByRole('status', { name: LOADER_TEXT.loading })
    expect(loader).toHaveAttribute('aria-live', 'polite')
    expect(loader).toHaveTextContent(LOADER_TEXT.loading)
  })

  it('takes its accessible name from the label, and can hide the label visually', () => {
    render(<Loader label="Loading files..." labelHidden />)

    expect(screen.getByRole('status', { name: 'Loading files...' })).toBeInTheDocument()
    expect(screen.getByText('Loading files...')).toHaveClass('sr-only')
  })

  it('is not a live region when it is not announced, and keeps its visible label', () => {
    render(<Loader label="Loading findings..." announce={false} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('loader')).not.toHaveAttribute('aria-live')
    expect(screen.getByText('Loading findings...')).toBeVisible()
  })

  it.each([
    ['sm', '16'],
    ['md', '24'],
    ['lg', '32']
  ] as const)('renders the %s size', (size, pixel) => {
    render(<Loader size={size} />)

    expect(screen.getByRole('status')).toHaveAttribute('data-size', size)
    expect(screen.getByTestId('loader-icon')).toHaveAttribute('width', pixel)
  })

  it('spins when motion is allowed', () => {
    stubReducedMotion(false)
    render(<Loader />)

    expect(screen.getByTestId('loader-icon')).toHaveClass('animate-spin')
  })

  it('has no animation class under prefers-reduced-motion', () => {
    stubReducedMotion(true)
    render(<Loader />)

    expect(screen.getByTestId('loader-icon').getAttribute('class')).not.toMatch(/animate-/)
    expect(screen.getByRole('status')).toHaveTextContent(LOADER_TEXT.loading)
  })
})

describe('GlobalLoader (Open Question 2A)', () => {
  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('appears only after 200 ms of a slow request and stays at least 400 ms once shown', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    let release = () => {}
    act(() => {
      release = tracker.begin()
    })
    await advance(LOADER_TIMING.showDelayMs - 1)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
    await advance(1)
    expect(screen.getByTestId('global-loader')).toBeInTheDocument()

    // The call ends 100 ms after the loader appeared: it stays until 400 ms have passed.
    await advance(100)
    act(() => release())
    await advance(LOADER_TIMING.minVisibleMs - 100 - 1)
    expect(screen.getByTestId('global-loader')).toBeInTheDocument()
    await advance(1)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('hides right after a call that ran longer than the minimum time', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    let release = () => {}
    act(() => {
      release = tracker.begin()
    })
    await advance(LOADER_TIMING.showDelayMs + LOADER_TIMING.minVisibleMs + 500)
    expect(screen.getByTestId('global-loader')).toBeInTheDocument()

    act(() => release())
    await advance(0)
    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('never appears for a request faster than 200 ms', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    let release = () => {}
    act(() => {
      release = tracker.begin()
    })
    await advance(LOADER_TIMING.showDelayMs - 50)
    act(() => release())
    await advance(1000)

    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('never appears for background requests, such as the review status poll', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    act(() => {
      tracker.begin({ background: true })
    })
    await advance(5000)

    expect(screen.queryByTestId('global-loader')).not.toBeInTheDocument()
  })

  it('is hidden from screen readers and never blocks the screen', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker()
    render(<GlobalLoader tracker={tracker} />)

    act(() => {
      tracker.begin()
    })
    await advance(LOADER_TIMING.showDelayMs)

    const bar = screen.getByTestId('global-loader')
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(bar).toHaveClass('pointer-events-none')
  })
})

describe('the review status poll (Validation 7)', () => {
  it('loads the review as background work', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: signedInState() })

    await store.dispatch(fetchReview({ id: 'r1', background: true }))

    expect(services.review.get).toHaveBeenCalledWith('r1', expect.objectContaining({ background: true }))
    expect(store.getState().review.current?.id).toBe('r1')
  })

  it('loads a review the page opened as counted work', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: signedInState() })

    await store.dispatch(fetchReview('r1'))

    expect(services.review.get).toHaveBeenCalledWith('r1', expect.objectContaining({ background: undefined }))
  })
})

describe('area loaders (Validation 4)', () => {
  it('Dashboard shows a Loader in every block until the data arrives, then the data', async () => {
    const { services } = createFakeServices()
    const dashboard = deferred<Awaited<ReturnType<typeof services.dashboard.get>>>()
    const reviewList = deferred<Awaited<ReturnType<typeof services.review.list>>>()
    const answer = await services.dashboard.get()
    const rowList = await services.review.list()
    services.dashboard.get.mockImplementation(() => dashboard.promise)
    services.review.list.mockImplementation(() => reviewList.promise)
    renderWithStore(<App />, { route: '/', services })

    // One live region per page: the stat bar's Loader is announced, the blocks' are shown silently.
    expect(screen.getAllByTestId('loader')).toHaveLength(Object.keys(DASHBOARD_LOADING_TEXT).length)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })).toBeInTheDocument()
    for (const label of Object.values(DASHBOARD_LOADING_TEXT)) {
      expect(screen.getByText(label)).toBeVisible()
    }
    expect(screen.queryByTestId('stat-total')).not.toBeInTheDocument()

    await act(async () => {
      dashboard.resolve(answer)
      reviewList.resolve(rowList)
    })

    expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    expect(screen.getByTestId('stat-total')).toHaveTextContent('Total Reviews24')
  })

  it('Dashboard replaces the Loader with the error and Retry when the load fails', async () => {
    const { services } = createFakeServices()
    services.dashboard.get.mockRejectedValue(networkError())
    renderWithStore(<App />, { route: '/', services })
    await settle()

    expect(screen.queryByRole('status', { name: DASHBOARD_LOADING_TEXT.stat })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(PAGE_ERROR_MESSAGE.dashboardUnavailable)
  })

  it('Review History shows the Loader until the list arrives', async () => {
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: '/history', services })

    expect(screen.getByRole('status', { name: HISTORY_TEXT.loading })).toHaveAttribute('data-testid', 'loader')
    await settle()

    expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('review-row').length).toBeGreaterThan(0)
  })

  it('Review History replaces the Loader with the error when the list fails', async () => {
    const { services } = createFakeServices()
    services.review.list.mockRejectedValue(networkError())
    renderWithStore(<App />, { route: '/history', services })
    await settle()

    expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('the Review page shows the Loader until the review arrives', async () => {
    const { services } = createFakeServices()
    const review = deferred<Awaited<ReturnType<typeof services.review.get>>>()
    services.review.get.mockImplementation(() => review.promise)
    renderWithStore(<App />, { route: '/review/r1', services })

    expect(screen.getByRole('status', { name: REVIEW_TEXT.loading })).toHaveAttribute('data-size', 'lg')

    await act(async () => review.resolve(detailOf('r1', structuredClone(sampleReview))))

    expect(screen.queryByRole('status', { name: REVIEW_TEXT.loading })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
  })

  it('the Review page replaces the Loader with its error when the review fails', async () => {
    const { services } = createFakeServices()
    services.review.get.mockRejectedValue(networkError())
    renderWithStore(<App />, { route: '/review/r1', services })
    await settle()

    expect(screen.queryByRole('status', { name: REVIEW_TEXT.loading })).not.toBeInTheDocument()
    expect(screen.getByText(PAGE_ERROR_MESSAGE.reviewUnavailable)).toBeInTheDocument()
  })

  it('the Account panel shows the Loader until the account arrives', async () => {
    const { services } = createFakeServices()
    renderWithStore(<AccountPanel />, { services, preloadedState: { account: initialAccountState } })

    expect(screen.getByRole('status', { name: ACCOUNT_TEXT.loading })).toHaveAttribute('data-testid', 'loader')
    await settle()

    expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    expect(screen.getByTestId('account-username')).toBeInTheDocument()
  })

  it('the Account panel replaces the Loader with its error when the account fails', async () => {
    const { services } = createFakeServices()
    services.account.get.mockRejectedValue(networkError())
    renderWithStore(<AccountPanel />, { services, preloadedState: { account: initialAccountState } })
    await settle()

    expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(PAGE_ERROR_MESSAGE.accountUnavailable)
  })

  it('the GitHub wizard shows the Loader while the repositories and then the files load', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    const fileList = deferred<Awaited<ReturnType<typeof services.github.listFile>>>()
    services.github.listFile.mockImplementation(() => fileList.promise)
    const search = deferred<Awaited<ReturnType<typeof services.github.searchRepo>>>()
    // The account starts with no repository row, so the next search has none to keep.
    services.github.searchRepo.mockResolvedValueOnce({ items: [], truncated: false })
    renderWithStore(<App />, { route: '/github', services })
    await user.type(screen.getByLabelText(GITHUB_TEXT.usernameLabel), 'octocat')
    await user.click(screen.getByRole('button', { name: GITHUB_TEXT.connect }))
    await settle()
    expect(screen.getByText(GITHUB_TEXT.noRepo)).toBeInTheDocument()

    // A search with no rows yet: the Loader instead of "No repositories match".
    services.github.searchRepo.mockImplementation(() => search.promise)
    await user.type(screen.getByLabelText('Search repositories'), 'r')
    expect(screen.getByRole('status', { name: GITHUB_TEXT.loadingRepo })).toBeInTheDocument()
    expect(screen.queryByText(GITHUB_TEXT.noRepoMatch)).not.toBeInTheDocument()
    await act(async () => search.resolve({ items: [{ id: 'repo', name: 'repo', description: '' }], truncated: false }))
    expect(screen.queryByRole('status', { name: GITHUB_TEXT.loadingRepo })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('status', { name: GITHUB_TEXT.loadingFile })).toBeInTheDocument()

    await act(async () => fileList.resolve({ items: [{ id: 'f1', path: 'a.ts', language: 'TypeScript' }], truncated: false }))
    expect(screen.queryByRole('status', { name: GITHUB_TEXT.loadingFile })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'a.ts' })).toBeInTheDocument()
  })

  it('the GitHub wizard file list shows its empty text, not the Loader, when the files fail', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    services.github.listFile.mockRejectedValue(networkError())
    renderWithStore(<App />, { route: '/github', services })
    await user.type(screen.getByLabelText(GITHUB_TEXT.usernameLabel), 'octocat')
    await user.click(screen.getByRole('button', { name: GITHUB_TEXT.connect }))
    await settle()

    await user.click(screen.getByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await settle()

    expect(screen.queryByRole('status', { name: GITHUB_TEXT.loadingFile })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('the GitHub repository list keeps its rows, without a Loader, while a search runs', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: '/github', services })
    await user.type(screen.getByLabelText(GITHUB_TEXT.usernameLabel), 'octocat')
    await user.click(screen.getByRole('button', { name: GITHUB_TEXT.connect }))
    await settle()

    services.github.searchRepo.mockImplementation(() => new Promise(() => {}))
    await user.type(screen.getByLabelText('Search repositories'), 'r')

    expect(screen.getByRole('radio', { name: 'repo' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: GITHUB_TEXT.loadingRepo })).not.toBeInTheDocument()
  })
})
