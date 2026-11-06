import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { REVIEW_POLL_INTERVAL_MS } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import type { ReviewDetailDto } from '../../src/models/dto'
import { initialReviewState } from '../../src/store/review.slice'
import { createFakeServices } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'
import { readSavedReview } from '../utils/reviewStorage'
import { renderWithStore, renderWithStoreSettled } from '../utils/renderWithStore'

// Plan 019 Scope 2: /review/new is a blank, unsaved review. Save creates it (POST /api/review),
// saves the edit, moves to /review/{id} and polls until the analysis finishes.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language, onChange }: { value: string; language: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" data-language={language} value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

const saveButton = () => screen.getByRole('button', { name: 'Run review' })

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('New review page', () => {
  it('opens blank: empty editor, the default language, pending, empty result tabs, nothing fetched', async () => {
    const { services } = createFakeServices()
    await renderWithStoreSettled(<App />, { route: '/review/new', services })

    expect(screen.getByTestId('monaco')).toHaveValue('')
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'typescript')
    expect(screen.getByTestId('review-name')).toHaveTextContent('New review')
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Not analyzed yet')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Findings (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Suggested refactors (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Generated tests (0)' })).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download report' })).toBeDisabled()
    expect(services.review.get).not.toHaveBeenCalled()
  })

  it('uses the AI preferences language for a blank review', async () => {
    const { services } = createFakeServices()
    services.settings.read.mockReturnValue({ ...services.settings.read(), language: 'Go' })
    services.settings.get.mockResolvedValue({ ...services.settings.read(), language: 'Go' })
    await renderWithStoreSettled(<App />, { route: '/review/new', services })

    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'go')
  })

  it('creates, saves and opens the review on the fake backend, which completes with findings', async () => {
    const user = userEvent.setup()
    const { store } = await renderWithStoreSettled(<App />, { route: '/review/new' })

    await user.type(screen.getByTestId('monaco'), 'const a = 1')
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    const id = store.getState().review.current?.id ?? ''
    expect(id).toMatch(/^review-/)
    expect(toast.success).toHaveBeenCalledWith('Review started')
    expect(readSavedReview(id)).toMatchObject({ name: 'New review', code: 'const a = 1', language: 'TypeScript' })
    expect(screen.getByTestId('monaco')).toHaveValue('const a = 1')
    expect(screen.getByRole('tab', { name: `Findings (${sampleReview.finding.length})` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download report' })).toBeEnabled()
    expect(store.getState().review.list).toEqual([])
  })

  it('sends the name, language and code, then lists the created review in History', async () => {
    const user = userEvent.setup()
    const { store } = await renderWithStoreSettled(<App />, { route: '/review/new' })
    await user.click(screen.getByRole('button', { name: 'Edit review name' }))
    await user.clear(screen.getByRole('textbox', { name: 'Review name' }))
    await user.type(screen.getByRole('textbox', { name: 'Review name' }), 'My snippet{Enter}')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Python')
    await user.type(screen.getByTestId('monaco'), 'print(1)')
    await user.click(saveButton())
    await screen.findByText('Completed')

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Review History' }))

    expect(await screen.findByRole('link', { name: /My snippet/ })).toBeInTheDocument()
    expect(store.getState().review.list[0]).toMatchObject({ title: 'My snippet', language: 'Python', status: 'completed' })
  })

  it('raises the Review completed notice when the review it waited for completes', async () => {
    const user = userEvent.setup()
    const { services, toast: notice } = createFakeServices()
    services.review.create.mockResolvedValue({ id: 'c1', review: { ...sampleReview, status: 'pending' }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language })
    await renderWithStoreSettled(<App />, { route: '/review/new', services })
    await user.type(screen.getByTestId('monaco'), 'x')
    await user.click(saveButton())

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(services.review.create).toHaveBeenCalledWith({ title: 'New review', language: 'TypeScript', content: 'x' })
    expect(services.review.save).toHaveBeenCalledWith('c1', { name: 'New review', language: 'TypeScript', code: 'x' })
    expect(notice.success).toHaveBeenCalledWith('Review completed')
  })

  it('stays on the blank review with one error toast when creating fails', async () => {
    const user = userEvent.setup()
    const { services, toast: notice } = createFakeServices()
    services.review.create.mockRejectedValue(AppError.fromResponse(413, { error: { code: 'payload_too_large', message: 'x' } }))
    await renderWithStoreSettled(<App />, { route: '/review/new', services })
    await user.type(screen.getByTestId('monaco'), 'x')
    await user.click(saveButton())

    await vi.waitFor(() => expect(notice.error).toHaveBeenCalledTimes(1))
    expect(notice.error).toHaveBeenCalledWith('Could not start the review. It is too large, shorten it and try again.')
    expect(services.review.save).not.toHaveBeenCalled()
    expect(screen.getByText('Not analyzed yet')).toBeInTheDocument()
    expect(screen.getByTestId('monaco')).toHaveValue('x')
    expect(saveButton()).toBeEnabled()
  })

  it('opens an imported file (the draft) in the editor and drops the draft when left', async () => {
    const user = userEvent.setup()
    const draft = { title: 'src/server.ts', language: 'Python', content: 'print(2)' }
    const { store } = await renderWithStoreSettled(<App />, {
      route: '/review/new',
      preloadedState: { review: { ...initialReviewState, draft } }
    })

    expect(screen.getByTestId('monaco')).toHaveValue('print(2)')
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'python')
    expect(screen.getByTestId('review-name')).toHaveTextContent('src/server.ts')
    expect(saveButton()).toBeEnabled()

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Review History' }))
    expect(store.getState().review.draft).toBeNull()
  })
})

describe('Review page polling', () => {
  function detail(status: ReviewDetailDto['review']['status']): ReviewDetailDto {
    return { id: 'p1', review: { ...sampleReview, status }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language }
  }

  it('fetches a pending review again until it is completed, then stops', async () => {
    const { services } = createFakeServices()
    services.review.get.mockResolvedValueOnce(detail('pending')).mockResolvedValueOnce(detail('in_progress')).mockResolvedValue(detail('completed'))
    renderWithStore(<App />, { route: '/review/p1', services })

    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(await screen.findByText('In progress', {}, { timeout: REVIEW_POLL_INTERVAL_MS * 3 })).toBeInTheDocument()
    expect(await screen.findByText('Completed', {}, { timeout: REVIEW_POLL_INTERVAL_MS * 3 })).toBeInTheDocument()
    expect(services.review.get).toHaveBeenCalledTimes(3)

    await new Promise((resolve) => setTimeout(resolve, REVIEW_POLL_INTERVAL_MS * 1.5))
    expect(services.review.get).toHaveBeenCalledTimes(3)
  })

  it('does not poll a finished review', async () => {
    const { services } = createFakeServices()
    services.review.get.mockResolvedValue(detail('failed'))
    renderWithStore(<App />, { route: '/review/p1', services })

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, REVIEW_POLL_INTERVAL_MS * 1.5))
    expect(services.review.get).toHaveBeenCalledTimes(1)
  })
  // Retry after a failed poll: tests/unit/ReviewPolling.test.tsx.
})
