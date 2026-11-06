import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../../src/App'
import FindingsByCategory from '../../src/components/FindingsByCategory'
import FindingsBySeverity from '../../src/components/FindingsBySeverity'
import ReviewActivity from '../../src/components/ReviewActivity'
import { DASHBOARD_EMPTY_TEXT } from '../../src/lib/dashboard.constants'
import { HISTORY_TEXT } from '../../src/lib/review.constants'
import { isDashboardDto } from '../../src/models/dashboard.model'
import type { DashboardDto } from '../../src/models/dto'
import { countedSeverityList, findingCategoryList, isFindingDto } from '../../src/models/review.model'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { createStorageService } from '../../src/services/storage.service'
import { createFakeServices } from '../utils/fakeServices'
import { categoryCountList, sampleReview } from '../utils/sampleData'
import { renderWithStoreSettled } from '../utils/renderWithStore'

// Plan 019 addendum (the backend starts empty): Finding.category, the stricter Dashboard guard, and
// the empty states a fresh backend shows.

const zeroPointList = (length: number) => Array.from({ length }, (_, index) => ({ date: `Day ${index + 1}`, count: 0 }))

const emptyDashboard: DashboardDto = {
  statList: [
    { id: 'total', label: 'Total Reviews', value: 0, trend: 0 },
    { id: 'completed', label: 'Completed', value: 0, trend: 0 },
    { id: 'failed', label: 'Failed', value: 0, trend: 0 },
    { id: 'quality', label: 'Avg. Quality Score', value: 0, suffix: ' / 100', trend: 0 }
  ],
  severityCountList: countedSeverityList.map((severity) => ({ severity, label: severity, count: 0 })),
  categoryCountList: [],
  activityByRange: { '7d': zeroPointList(7), '14d': zeroPointList(14), '30d': zeroPointList(30) }
}

describe('Finding category', () => {
  it('is required and must be one of the five contract values', () => {
    const [finding] = sampleReview.finding
    expect(findingCategoryList).toEqual(['security', 'bug', 'performance', 'readability', 'maintainability'])
    expect(isFindingDto(finding)).toBe(true)
    const { category: _category, ...withoutCategory } = finding
    expect(isFindingDto(withoutCategory)).toBe(false)
    expect(isFindingDto({ ...finding, category: 'style' })).toBe(false)
  })

  it('is set on every demo finding', () => {
    expect(sampleReview.finding.every((item) => findingCategoryList.includes(item.category))).toBe(true)
  })
})

describe('Dashboard guard (contract 0.5.0)', () => {
  it('accepts an empty dashboard: four zero severities, no categories, zero activity', () => {
    expect(isDashboardDto(emptyDashboard)).toBe(true)
  })

  it('accepts only the contract category ids (style and refactor no longer exist)', () => {
    expect(categoryCountList.every((item) => findingCategoryList.includes(item.id))).toBe(true)
    for (const id of ['style', 'refactor']) {
      expect(isDashboardDto({ ...emptyDashboard, categoryCountList: [{ id, label: id, count: 1 }] })).toBe(false)
    }
  })

  it('requires the four counted severities, each once', () => {
    expect(isDashboardDto({ ...emptyDashboard, severityCountList: emptyDashboard.severityCountList.slice(1) })).toBe(false)
    const twice = [...emptyDashboard.severityCountList.slice(1), emptyDashboard.severityCountList[1]]
    expect(isDashboardDto({ ...emptyDashboard, severityCountList: twice })).toBe(false)
  })

  it('the JSON dashboard route never carries the recent reviews (they come from GET /api/review)', async () => {
    const value = await createFixtureDataSource({ storage: createStorageService() }).request<Record<string, unknown>>('GET', '/api/dashboard')
    expect(value).not.toHaveProperty('recentReviewList')
    expect(isDashboardDto(value)).toBe(true)
  })
})

describe('Dashboard empty states', () => {
  it('the severity block shows an empty state instead of an all-zero donut', () => {
    render(<FindingsBySeverity countList={emptyDashboard.severityCountList} />)
    expect(screen.getByTestId('severity-empty')).toHaveTextContent(DASHBOARD_EMPTY_TEXT.severityTitle)
    expect(screen.queryByTestId('severity-total')).not.toBeInTheDocument()
  })

  it('the category block shows an empty state when there are no categories', () => {
    render(<FindingsByCategory countList={[]} />)
    expect(screen.getByTestId('category-empty')).toHaveTextContent(DASHBOARD_EMPTY_TEXT.categoryTitle)
  })

  it('the activity block shows an empty state for an all-zero range, and keeps the range picker', () => {
    render(<ReviewActivity activityByRange={emptyDashboard.activityByRange} />)
    expect(screen.getByTestId('activity-empty')).toHaveTextContent(DASHBOARD_EMPTY_TEXT.activityTitle)
    expect(screen.getByRole('combobox', { name: 'Date range' })).toBeInTheDocument()
  })

  it('the activity chart comes back when the range has a review', () => {
    const activityByRange = { ...emptyDashboard.activityByRange, '7d': [...zeroPointList(6), { date: 'Today', count: 1 }] }
    render(<ReviewActivity activityByRange={activityByRange} />)
    expect(screen.queryByTestId('activity-empty')).not.toBeInTheDocument()
  })

  it('a fresh store: stats at 0, every block empty, and no rows in Recent Reviews or History', async () => {
    const { services } = createFakeServices()
    services.dashboard.get.mockResolvedValue(structuredClone(emptyDashboard))
    services.review.list.mockResolvedValue([])
    await renderWithStoreSettled(<App />, { route: '/', services })

    for (const id of ['total', 'completed', 'failed', 'quality']) {
      expect(within(screen.getByTestId(`stat-${id}`)).getByText('0')).toBeInTheDocument()
    }
    expect(screen.getByTestId('severity-empty')).toBeInTheDocument()
    expect(screen.getByTestId('category-empty')).toBeInTheDocument()
    expect(screen.getByTestId('activity-empty')).toBeInTheDocument()
    const recent = screen.getByRole('region', { name: 'Recent Reviews' })
    expect(within(recent).getByTestId('recent-empty')).toHaveTextContent(DASHBOARD_EMPTY_TEXT.recentTitle)
    expect(within(recent).getByRole('link', { name: DASHBOARD_EMPTY_TEXT.startReview })).toHaveAttribute('href', '/review/new')
    expect(within(recent).queryByRole('button', { name: 'View all' })).not.toBeInTheDocument()
    expect(within(recent).queryByTestId('review-row')).not.toBeInTheDocument()
  })

  it('Review History shows its empty state with no rows', async () => {
    const { services } = createFakeServices()
    services.review.list.mockResolvedValue([])
    await renderWithStoreSettled(<App />, { route: '/history', services })

    expect(screen.getByTestId('history-empty')).toHaveTextContent(HISTORY_TEXT.emptyTitle)
    expect(screen.queryByTestId('review-row')).not.toBeInTheDocument()
  })
})
