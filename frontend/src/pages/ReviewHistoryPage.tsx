import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import ReviewHistoryList from '../components/ReviewHistoryList'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchReviewList, selectReviewList, selectReviewListStatus } from '../store/review.slice'

export default function ReviewHistoryPage() {
  const dispatch = useAppDispatch()
  const reviewList = useAppSelector(selectReviewList)
  const status = useAppSelector(selectReviewListStatus)
  const error = useAppSelector((state) => state.review.error)

  useEffect(() => {
    dispatch(fetchReviewList())
  }, [dispatch])

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-(--page-padding)">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Review History</h1>
          <p className="text-sm text-text-muted">All your previous reviews.</p>
        </div>
        <Link
          to="/review/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          <Plus size={16} aria-hidden="true" />
          New review
        </Link>
      </header>
      <ReviewHistoryList
        reviewList={reviewList}
        loading={status === 'idle' || status === 'loading'}
        errorMessage={status === 'failed' ? error?.userMessage : undefined}
      />
    </main>
  )
}
