import type { ActivityRange } from '../types'

// Dashboard UI constants (not data): the activity range picker and the Recent Reviews preview size.
export const activityRangeList: { id: ActivityRange; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '14d', label: 'Last 14 days' },
  { id: '30d', label: 'Last 30 days' }
]

export const recentPreviewCount = 4

// Empty states: a fresh backend has no reviews, so every block says so instead of an empty chart.
export const DASHBOARD_EMPTY_TEXT = {
  severityTitle: 'No findings yet',
  severityDetail: 'Findings by severity appear after your first completed review.',
  categoryTitle: 'No findings by category yet',
  categoryDetail: 'Each finding is counted under security, bugs, performance, readability or maintainability.',
  activityTitle: 'No reviews in this range',
  activityDetail: 'Reviews you create are counted here by day.',
  recentTitle: 'No reviews yet',
  recentDetail: 'Your latest reviews will show up here.',
  startReview: 'Start a new review'
} as const

// Plan 037: the Loader of each block on the first load, before any data has arrived. Only the stat
// bar's is announced (one live region per page), so it names the whole Dashboard.
export const DASHBOARD_LOADING_TEXT = {
  stat: 'Loading the dashboard...',
  severity: 'Loading findings by severity...',
  category: 'Loading findings by category...',
  activity: 'Loading review activity...',
  recent: 'Loading recent reviews...'
} as const
