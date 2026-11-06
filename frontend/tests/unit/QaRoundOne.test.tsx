import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import Sidebar from '../../src/components/Sidebar'
import { REVIEW_LIMIT, REVIEW_POLL_MAX_FAILURE } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import type { ReviewDetailDto } from '../../src/models/dto'
import { createAppStore } from '../../src/store'
import { initialAccountState } from '../../src/store/account.slice'
import { regenerateTest } from '../../src/store/review.slice'
import { createFakeServices } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'
import { renderWithStore, renderWithStoreSettled } from '../utils/renderWithStore'

// Plan 019, QA round 1 (.orchestrate/qa-report.md): D1, D2, D3, the Sidebar profile, Regenerate
// on a review that is not completed, and the client-side length check.

// Short poll timings, so the retry and the cap run in a few hundred milliseconds.
vi.mock('../../src/lib/review.constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/review.constants')>()),
  REVIEW_POLL_INTERVAL_MS: 30,
  REVIEW_POLL_RETRY_MS: 60,
  REVIEW_POLL_MAX_FAILURE: 3
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

const down = () => new AppError({ code: 'network', kind: 'network', message: 'down' })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function detail(status: ReviewDetailDto['review']['status']): ReviewDetailDto {
  return { id: 'p1', review: { ...sampleReview, status }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language }
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('D2: polling survives a failed poll, up to a cap', () => {
  it('retries after a failed poll and shows the review once it completes', async () => {
    const { services } = createFakeServices()
    services.review.get
      .mockResolvedValueOnce(detail('pending'))
      .mockRejectedValueOnce(down())
      .mockResolvedValue(detail('completed'))
    renderWithStore(<App />, { route: '/review/p1', services })

    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(await screen.findByText('Completed', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(services.review.get).toHaveBeenCalledTimes(3)
  })

  it(`stops after ${3} failed polls in a row`, async () => {
    const { services } = createFakeServices()
    services.review.get.mockResolvedValueOnce(detail('pending')).mockRejectedValue(down())
    renderWithStore(<App />, { route: '/review/p1', services })

    expect(await screen.findByText('Pending')).toBeInTheDocument()
    await vi.waitFor(() => expect(services.review.get).toHaveBeenCalledTimes(1 + REVIEW_POLL_MAX_FAILURE), { timeout: 2000 })
    await wait(400)
    expect(services.review.get).toHaveBeenCalledTimes(1 + REVIEW_POLL_MAX_FAILURE)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('an answer in between resets the failure count', async () => {
    const { services } = createFakeServices()
    services.review.get
      .mockResolvedValueOnce(detail('pending'))
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValueOnce(detail('in_progress'))
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValue(detail('completed'))
    renderWithStore(<App />, { route: '/review/p1', services })

    expect(await screen.findByText('Completed', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(services.review.get).toHaveBeenCalledTimes(7)
  })
})

describe('D1: no navigation after the page was left', () => {
  it('leaving the new review while it saves keeps the user where they went', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    let answer: (value: ReviewDetailDto) => void = () => {}
    services.review.create.mockImplementation(
      () => new Promise<ReviewDetailDto>((resolve) => (answer = resolve)) as ReturnType<typeof services.review.create>
    )
    await renderWithStoreSettled(<App />, { route: '/review/new', services })
    await user.type(screen.getByTestId('monaco'), 'x')
    await user.click(screen.getByRole('button', { name: 'Run review' }))

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Review History' }))
    expect(await screen.findByRole('heading', { name: 'Review History' })).toBeInTheDocument()
    answer({ id: 'c1', review: { ...sampleReview, status: 'pending' }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language })
    await wait(50)

    expect(services.review.save).toHaveBeenCalledWith('c1', { name: 'New review', language: 'TypeScript', code: 'x' })
    expect(screen.getByRole('heading', { name: 'Review History' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review Results' })).not.toBeInTheDocument()
  })

  it('leaving the wizard while a file imports does not open the editor', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    let answer: (value: { id: string; path: string; language: string; content: string }) => void = () => {}
    services.github.getFile.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    await renderWithStoreSettled(<App />, { route: '/github', services })
    await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('checkbox', { name: 'a.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Review History' }))
    answer({ id: 'f1', path: 'a.ts', language: 'TypeScript', content: 'x' })
    await wait(50)

    expect(screen.getByRole('heading', { name: 'Review History' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review Results' })).not.toBeInTheDocument()
  })
})

describe('D3: a failed Regenerate follows the Review failed preference', () => {
  function servicesWithReviewFailed(enabled: boolean) {
    const fake = createFakeServices()
    const settings = fake.services.settings.read()
    fake.services.settings.read.mockReturnValue({ ...settings, notification: { ...settings.notification, reviewFailed: enabled } })
    return fake
  }

  it('shows no toast for a server failure when Review failed is off', async () => {
    const { services, toast: notice } = servicesWithReviewFailed(false)
    services.review.regenerateTest.mockRejectedValue(AppError.fromResponse(500, {}))

    await createAppStore({ services }).dispatch(regenerateTest('r1'))

    expect(notice.error).not.toHaveBeenCalled()
  })

  it('still shows a network failure when Review failed is off, and a server failure when it is on', async () => {
    const off = servicesWithReviewFailed(false)
    off.services.review.regenerateTest.mockRejectedValue(down())
    await createAppStore({ services: off.services }).dispatch(regenerateTest('r1'))
    expect(off.toast.error).toHaveBeenCalledTimes(1)

    const on = servicesWithReviewFailed(true)
    on.services.review.regenerateTest.mockRejectedValue(AppError.fromResponse(500, {}))
    await createAppStore({ services: on.services }).dispatch(regenerateTest('r1'))
    expect(on.toast.error).toHaveBeenCalledTimes(1)
  })
})

// Signed in, but the account is not loaded yet: the Sidebar loads it in the background.
describe('Sidebar profile from GET /api/account', () => {
  it('shows the account name, email and initials', async () => {
    const { services } = createFakeServices()
    services.account.get.mockResolvedValue({ username: 'ada.lovelace', fullName: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: null, memberSince: 'x' })
    renderWithStore(<Sidebar />, { services, preloadedState: { account: initialAccountState } })

    const profile = await screen.findByTestId('sidebar-profile')
    expect(profile).toHaveTextContent('AL')
    expect(profile).toHaveTextContent('Ada Lovelace')
    expect(profile).toHaveTextContent('ada@example.com')
  })

  it('shows nothing and no toast when the background load fails', async () => {
    const { services, toast: notice } = createFakeServices()
    services.account.get.mockRejectedValue(down())
    renderWithStore(<Sidebar />, { services, preloadedState: { account: initialAccountState } })
    await wait(50)

    expect(screen.queryByTestId('sidebar-profile')).not.toBeInTheDocument()
    expect(notice.error).not.toHaveBeenCalled()
  })
})

describe('Regenerate on a review that is not completed', () => {
  it('is disabled with a hint, and sends nothing', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    services.review.get.mockResolvedValue({ id: 'r5', review: { ...sampleReview, status: 'failed' }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language })
    await renderWithStoreSettled(<App />, { route: '/review/r5', services })
    await user.click(screen.getByRole('tab', { name: /Generated tests/ }))

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    expect(screen.getByText('Tests can be regenerated once the review is completed.')).toBeInTheDocument()
    expect(services.review.regenerateTest).not.toHaveBeenCalled()
  })
})

describe('Client-side length check', () => {
  it('names the limit and disables Save over 100 000 characters', async () => {
    await renderWithStoreSettled(<App />, { route: '/review/new' })
    const editor = screen.getByTestId('monaco')

    await userEvent.setup().click(editor)
    // fireEvent-like change: typing 100 001 characters key by key would take minutes.
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(editor, { target: { value: 'a'.repeat(REVIEW_LIMIT.contentMax + 1) } })

    expect(screen.getByRole('alert')).toHaveTextContent('Code is too long: 100,001 characters. Use at most 100,000 characters.')
    expect(screen.getByRole('button', { name: 'Run review' })).toBeDisabled()
  })

  it('counts a Windows line break once, and sends LF', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    await renderWithStoreSettled(<App />, { route: '/review/new', services })
    const { fireEvent } = await import('@testing-library/react')
    // 50 000 lines of one character: 100 000 characters with LF, 149 999 with CR LF.
    const crlf = Array.from({ length: 50_000 }, () => 'a').join('\r\n') + '\r\n'
    fireEvent.change(screen.getByTestId('monaco'), { target: { value: crlf } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run review' }))

    const sent = (services.review.create.mock.calls as unknown as [{ content: string }][])[0]?.[0]
    expect(sent?.content).toBe(crlf.replace(/\r\n/g, '\n'))
    expect(sent?.content.length).toBe(REVIEW_LIMIT.contentMax)
    expect(toast.success).toHaveBeenCalledWith('Review started')
  })
})
