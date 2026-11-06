import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import ReviewStatusBadge from '../../src/components/ReviewStatusBadge'
import { recentPreviewCount } from '../../src/lib/dashboard.constants'
import { activityByRange, recentReviewList } from '../utils/sampleData'
import type { ReviewStatus } from '../../src/types'
import { renderWithStoreSettled } from '../utils/renderWithStore'

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

function renderApp(path = '/') {
  return renderWithStoreSettled(<App />, { route: path })
}

describe('Dashboard page', () => {
  it('renders as the home page with the stat bar values', async () => {
    await renderApp()

    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('stat-total')).toHaveTextContent('Total Reviews24')
    expect(screen.getByTestId('stat-completed')).toHaveTextContent('21')
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('3')
    expect(screen.getByTestId('stat-quality')).toHaveTextContent('78 / 100')
  })

  it('renders the four blocks', async () => {
    await renderApp()

    for (const name of ['Findings by Severity', 'Findings by Category', 'Review Activity', 'Recent Reviews']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('shows the donut total and the legend with percentages', async () => {
    await renderApp()

    expect(screen.getByTestId('severity-total')).toHaveTextContent('48')
    expect(screen.getByTestId('legend-critical')).toHaveTextContent('6 (13%)')
    expect(screen.getByTestId('legend-medium')).toHaveTextContent('18 (38%)')
  })

  it('changes the activity data when the range changes', async () => {
    const user = userEvent.setup()
    await renderApp()

    expect(screen.getByTestId('activity-count')).toHaveTextContent(`${activityByRange['7d'].length} days`)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'Last 30 days')

    expect(screen.getByTestId('activity-count')).toHaveTextContent(`${activityByRange['30d'].length} days`)
  })

  it('expands the recent reviews list with View all', async () => {
    const user = userEvent.setup()
    await renderApp()

    expect(screen.getAllByTestId('review-row')).toHaveLength(recentPreviewCount)
    await user.click(screen.getByRole('button', { name: /View all/ }))

    expect(screen.getAllByTestId('review-row')).toHaveLength(recentReviewList.length)
    expect(screen.getByRole('button', { name: /Show less/ })).toBeInTheDocument()
  })

  it('shows the dot tooltip text with the severity count', async () => {
    await renderApp()

    const first = within(screen.getAllByTestId('review-row')[0])
    expect(first.getByTestId('dot-high')).toHaveAccessibleDescription('High severity findings: 3')
    expect(first.getByTestId('dot-medium')).toHaveAccessibleDescription('Medium severity findings: 2')
    expect(first.getByTestId('dot-low')).toHaveAccessibleDescription('Low severity findings: 1')
  })

  it('shows a green dot with No findings tooltip when a review has none', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByRole('button', { name: /View all/ }))

    expect(screen.getAllByTestId('dot-none')[0]).toHaveAccessibleDescription('No findings')
  })

  it('shows every status in the expanded list', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByRole('button', { name: /View all/ }))

    for (const status of ['pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled']) {
      expect(screen.getAllByTestId(`status-${status}`).length).toBeGreaterThan(0)
    }
  })
})

describe('ReviewStatusBadge', () => {
  it.each<[ReviewStatus, string, string]>([
    ['pending', 'Pending', 'waiting to start'],
    ['queued', 'Queued', 'processing queue'],
    ['in_progress', 'In progress', 'analyzing the code'],
    ['completed', 'Completed', 'finished successfully'],
    ['failed', 'Failed', 'due to an error'],
    ['cancelled', 'Cancelled', 'cancelled the review']
  ])('renders the %s label and meaning', (status, label, meaning) => {
    render(<ReviewStatusBadge status={status} />)

    expect(screen.getByText(label)).toHaveAttribute('title', expect.stringContaining(meaning))
  })
})

describe('Sidebar navigation', () => {
  it('marks Dashboard active on the home route', async () => {
    await renderApp('/')

    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('navigates to New Review and back', async () => {
    const user = userEvent.setup()
    await renderApp('/')

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'New Review' }))
    expect(screen.getByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'New Review' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Dashboard' }))
    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
  })
})
