import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Inbox } from 'lucide-react'
import { DASHBOARD_EMPTY_TEXT, DASHBOARD_LOADING_TEXT, recentPreviewCount } from '../lib/dashboard.constants'
import { ROUTE_PATH } from '../lib/route.constants'
import type { ReviewSummary } from '../types'
import EmptyState from './EmptyState'
import Loader from './Loader'
import ReviewRow from './ReviewRow'

// Plan 037 (Validation 6): the Loader, the empty state and the data share one body with a minimum
// height that covers each of them, so the block keeps its size when the data arrives.
const bodyClass = 'flex min-h-50 flex-col justify-center'

// `loading` (plan 037): the list is loading and has no row yet, so the Loader is shown instead of the empty state.
export default function RecentReviews({ reviewList, loading = false }: { reviewList: ReviewSummary[]; loading?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const visibleList = expanded ? reviewList : reviewList.slice(0, recentPreviewCount)

  return (
    <section aria-labelledby="recent-reviews-title" className="min-w-0 rounded-md border border-border bg-card p-4 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="recent-reviews-title" className="text-sm font-bold">
          Recent Reviews
        </h2>
        {reviewList.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
        >
          {expanded ? 'Show less' : 'View all'}
          <ArrowRight size={12} aria-hidden="true" />
        </button>
        )}
      </div>
      <div data-testid="recent-body" className={bodyClass}>
      {reviewList.length === 0 && loading ? (
        <Loader label={DASHBOARD_LOADING_TEXT.recent} announce={false} />
      ) : reviewList.length === 0 ? (
        <EmptyState
          testId="recent-empty"
          Icon={Inbox}
          title={DASHBOARD_EMPTY_TEXT.recentTitle}
          detail={DASHBOARD_EMPTY_TEXT.recentDetail}
          action={
            <Link to={ROUTE_PATH.newReview} className="text-sm font-medium text-primary hover:text-primary-hover">
              {DASHBOARD_EMPTY_TEXT.startReview}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleList.map((review) => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </ul>
      )}
      </div>
    </section>
  )
}
