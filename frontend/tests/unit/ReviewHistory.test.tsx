import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { recentReviewList } from '../utils/sampleData'
import { renderWithStoreSettled } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    language,
    options,
    onChange
  }: {
    value: string
    language: string
    options?: { readOnly?: boolean }
    onChange?: (value: string) => void
  }) => (
    <div data-testid="monaco" data-language={language} data-readonly={String(options?.readOnly)}>
      {value}
      <button type="button" onClick={() => onChange?.('edited code')}>
        simulate edit
      </button>
    </div>
  )
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

function renderApp(path: string) {
  return renderWithStoreSettled(<App />, { route: path })
}

describe('Review History page', () => {
  it('lists every mock review as a link to /review/:id', async () => {
    await renderApp('/history')

    expect(screen.getByRole('heading', { name: 'Review History', level: 1 })).toBeInTheDocument()
    const rowList = screen.getAllByTestId('review-row')
    expect(rowList).toHaveLength(recentReviewList.length)
    recentReviewList.forEach((review, index) => {
      expect(within(rowList[index]).getByRole('link')).toHaveAttribute('href', `/review/${review.id}`)
    })
  })

  it('labels each row with its language and created date', async () => {
    await renderApp('/history')

    const rowList = screen.getAllByTestId('review-row')
    recentReviewList.forEach((review, index) => {
      expect(within(rowList[index]).getByText(`${review.language} - Created ${review.timeAgo}`)).toBeInTheDocument()
    })
  })

  it('highlights the sidebar History link and has a New review button', async () => {
    await renderApp('/history')

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Review History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'New review' })).toHaveAttribute('href', '/review/new')
  })

  it('opens a review from the list', async () => {
    const user = userEvent.setup()
    await renderApp('/history')

    await user.click(screen.getByRole('link', { name: /Payment API/ }))

    expect(screen.getByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'javascript')
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Analyzed')).toBeInTheDocument()
  })

  it('opens the review whose row was clicked, by id in the route', async () => {
    const user = userEvent.setup()
    await renderApp('/history')

    await user.click(screen.getByRole('link', { name: /Data Processor/ }))

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'go')
  })

  it('keeps editor changes when switching tabs and coming back', async () => {
    const user = userEvent.setup()
    await renderApp('/review/r1')

    await user.click(screen.getByRole('button', { name: 'simulate edit' }))
    expect(screen.getByTestId('monaco')).toHaveTextContent('edited code')

    await user.click(screen.getByRole('tab', { name: /Findings/ }))
    await user.click(screen.getByRole('tab', { name: 'Summary' }))

    expect(screen.getByTestId('monaco')).toHaveTextContent('edited code')
  })
})

describe('Review page by id', () => {
  it('renders a failed review with its real status', async () => {
    await renderApp('/review/r4')

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'go')
  })

  it('opens /review/new as a blank, unsaved review (no request for `new`)', async () => {
    await renderApp('/review/new')

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Not analyzed yet')).toBeInTheDocument()
    expect(screen.getByTestId('monaco')).toHaveTextContent(/^simulate edit$/)
    expect(screen.queryByText('Review not found')).not.toBeInTheDocument()
  })

  it('shows Review not found with a link to History for an unknown id', async () => {
    await renderApp('/review/nope')

    expect(screen.getByRole('heading', { name: 'Review not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Review History' })).toHaveAttribute('href', '/history')
  })

  it('has no back arrow, an editable editor and a changeable language', async () => {
    const user = userEvent.setup()
    await renderApp('/review/r1')

    expect(document.querySelector('.lucide-arrow-left')).toBeNull()
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-readonly', 'false')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Python')
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'python')
  })
})

describe('Dashboard Recent Reviews', () => {
  it('rows link to /review/:id', async () => {
    await renderApp('/')

    expect(within(screen.getAllByTestId('review-row')[0]).getByRole('link')).toHaveAttribute('href', '/review/r1')
  })

  it('rows show the same created label as History', async () => {
    await renderApp('/')

    const first = recentReviewList[0]
    expect(within(screen.getAllByTestId('review-row')[0]).getByText(`${first.language} - Created ${first.timeAgo}`)).toBeInTheDocument()
  })
})

describe('global pointer cursor', () => {
  const css = readFileSync(resolve(__dirname, '../../src/styles/basics/base.css'), 'utf8')

  it('defines one pointer rule for enabled clickable elements', async () => {
    expect(css).toMatch(/button:not\(:disabled\)[^{]*\{\s*cursor: pointer;/)
    expect(css).toContain('a[href]')
    expect(css).toContain("[role='tab']")
    expect(css.match(/cursor: pointer;/g)).toHaveLength(1)
  })
})
