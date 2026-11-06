import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { toast } from 'sonner'
import type { ReviewSummary } from '../types'
import { useSettings } from '../lib/useSettings'
import { useAppDispatch } from '../store/hooks'
import { deleteReview } from '../store/review.slice'
import { HISTORY_TEXT } from '../lib/review.constants'
import { ROUTE_PATH } from '../lib/route.constants'
import EmptyState from './EmptyState'
import Loader from './Loader'
import ReviewRow from './ReviewRow'

type Props = {
  // Already visible rows (deleted reviews hidden, saved names applied by review.service).
  reviewList: ReviewSummary[]
  loading?: boolean
  // Shown instead of the empty state when the list could not be loaded.
  errorMessage?: string
}

export default function ReviewHistoryList({ reviewList, loading = false, errorMessage }: Props) {
  const { settings } = useSettings()
  const dispatch = useAppDispatch()
  const compact = settings.historyDensity === 'compact'

  // On failure the row stays and the store shows the error toast.
  const handleDelete = async (id: string) => {
    const result = await dispatch(deleteReview(id))
    if (deleteReview.fulfilled.match(result)) toast.success('Review deleted')
  }

  return (
    <section aria-labelledby="review-history-title" className="min-w-0 rounded-md border border-border bg-card p-4 shadow-card">
      <h2 id="review-history-title" className="mb-4 text-sm font-bold">
        All Reviews
      </h2>
      {reviewList.length === 0 && loading ? (
        <Loader label={HISTORY_TEXT.loading} className="py-8" />
      ) : reviewList.length === 0 && errorMessage ? (
        <p role="alert" className="py-8 text-center text-sm text-text-muted">
          {errorMessage}
        </p>
      ) : reviewList.length === 0 ? (
        <EmptyState
          testId="history-empty"
          Icon={History}
          title={HISTORY_TEXT.emptyTitle}
          detail={HISTORY_TEXT.emptyDetail}
          action={
            <Link to={ROUTE_PATH.newReview} className="text-sm font-medium text-primary hover:text-primary-hover">
              {HISTORY_TEXT.startReview}
            </Link>
          }
        />
      ) : (
        <ul data-density={settings.historyDensity} className={`flex flex-col ${compact ? 'gap-1' : 'gap-3'}`}>
          {reviewList.map((review) => (
            <ReviewRow key={review.id} review={review} compact={compact} onDelete={handleDelete} />
          ))}
        </ul>
      )}
    </section>
  )
}
