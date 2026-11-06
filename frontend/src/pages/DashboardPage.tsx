import { useCallback, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import DashboardStatBar from '../components/DashboardStatBar'
import FindingsByCategory from '../components/FindingsByCategory'
import FindingsBySeverity from '../components/FindingsBySeverity'
import RecentReviews from '../components/RecentReviews'
import ReviewActivity from '../components/ReviewActivity'
import { fetchDashboard, selectDashboard, selectDashboardStatus } from '../store/dashboard.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchReviewList, selectReviewList, selectReviewListStatus } from '../store/review.slice'
import { PAGE_ERROR_MESSAGE } from '../utils/error-messages'

export default function DashboardPage() {
  const dispatch = useAppDispatch()
  const dashboard = useAppSelector(selectDashboard)
  const reviewList = useAppSelector(selectReviewList)
  const status = useAppSelector(selectDashboardStatus)
  const hasData = useAppSelector((state) => state.dashboard.data !== null)
  const error = useAppSelector((state) => state.dashboard.error)
  const reviewListStatus = useAppSelector(selectReviewListStatus)
  // Plan 037: until the first answer the blocks show the Loader, never all-zero stats or empty
  // states. A reload keeps the data it has.
  const firstLoad = !hasData && status !== 'failed' && status !== 'succeeded'

  const load = useCallback(() => {
    dispatch(fetchDashboard())
    dispatch(fetchReviewList())
  }, [dispatch])

  useEffect(load, [load])

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-(--page-padding)">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-text-muted">Get an overview of your code quality and review activity.</p>
      </header>
      {status === 'failed' && !hasData ? (
        // No data to show: an error with a retry instead of all-zero stats.
        <section role="alert" className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-8 text-center shadow-card">
          <h2 className="text-base font-semibold">{PAGE_ERROR_MESSAGE.dashboardUnavailable}</h2>
          <p className="text-sm text-text-muted">{error?.userMessage}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {PAGE_ERROR_MESSAGE.retry}
          </button>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          <DashboardStatBar statList={dashboard.statList} loading={firstLoad} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FindingsBySeverity countList={dashboard.severityCountList} loading={firstLoad} />
            <FindingsByCategory countList={dashboard.categoryCountList} loading={firstLoad} />
            <ReviewActivity activityByRange={dashboard.activityByRange} loading={firstLoad} />
            <RecentReviews reviewList={reviewList} loading={reviewListStatus === 'idle' || reviewListStatus === 'loading'} />
          </div>
        </div>
      )}
    </main>
  )
}
