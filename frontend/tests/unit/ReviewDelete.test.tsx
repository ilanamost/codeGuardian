import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { readDeletedIdList, readSavedReview, seedSavedReview } from '../utils/reviewStorage'
import { recentReviewList } from '../utils/sampleData'
import { renderWithStoreSettled } from '../utils/renderWithStore'

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

function renderApp(path: string) {
  return renderWithStoreSettled(<App />, { route: path })
}

const first = recentReviewList[0]

describe('Delete review', () => {
  it('has an accessible delete button on every row', async () => {
    await renderApp('/history')

    expect(screen.getAllByRole('button', { name: /^Delete review / })).toHaveLength(recentReviewList.length)
    expect(screen.getByRole('button', { name: `Delete review ${first.title}` })).toBeInTheDocument()
  })

  it('asks for confirmation and keeps the review on Cancel', async () => {
    const user = userEvent.setup()
    await renderApp('/history')

    await user.click(screen.getByRole('button', { name: `Delete review ${first.title}` }))
    expect(screen.getByText('Delete this review? This cannot be undone.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('link', { name: new RegExp(first.title) })).toBeInTheDocument()
    expect(readDeletedIdList()).toEqual([])
  })

  it('removes the review, its saved record and shows a toast on Delete', async () => {
    const user = userEvent.setup()
    seedSavedReview(first.id, { name: 'Mine', language: 'Go', code: 'x' })
    await renderApp('/history')

    await user.click(screen.getByRole('button', { name: 'Delete review Mine' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.queryByRole('link', { name: /Mine/ })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('review-row')).toHaveLength(recentReviewList.length - 1)
    expect(readDeletedIdList()).toEqual([first.id])
    expect(readSavedReview(first.id)).toBeUndefined()
    expect(toast.success).toHaveBeenCalledWith('Review deleted')
  })

  it('shows an error toast and keeps the row when storage is blocked', async () => {
    const user = userEvent.setup()
    await renderApp('/history')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    await user.click(screen.getByRole('button', { name: `Delete review ${first.title}` }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(toast.error).toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('hides a deleted review from History and the Dashboard recent list', async () => {
    window.localStorage.setItem('deleted-reviews', JSON.stringify([first.id]))

    const history = await renderApp('/history')
    expect(screen.queryByRole('link', { name: new RegExp(first.title) })).not.toBeInTheDocument()
    history.unmount()

    await renderApp('/')
    const recent = screen.getByRole('region', { name: 'Recent Reviews' })
    expect(within(recent).queryByRole('link', { name: new RegExp(first.title) })).not.toBeInTheDocument()
  })

  it('shows Review not found for a deleted id', async () => {
    window.localStorage.setItem('deleted-reviews', JSON.stringify([first.id]))

    await renderApp(`/review/${first.id}`)

    expect(screen.getByRole('heading', { name: 'Review not found' })).toBeInTheDocument()
  })

  it('shows an empty state when every review is deleted', async () => {
    window.localStorage.setItem('deleted-reviews', JSON.stringify(recentReviewList.map((review) => review.id)))

    await renderApp('/history')

    expect(screen.getByText('No reviews yet')).toBeInTheDocument()
  })

  it('shows a saved name as the title in History', async () => {
    seedSavedReview(first.id, { name: 'Renamed review', language: 'Go', code: 'x' })

    await renderApp('/history')

    expect(screen.getByRole('link', { name: /Renamed review/ })).toBeInTheDocument()
  })
})
