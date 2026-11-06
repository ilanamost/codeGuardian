import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import type { ReviewSummary } from '../types'
import ReviewStatusBadge from './ReviewStatusBadge'
import SeverityDot, { type DotKind } from './SeverityDot'

function dotList(review: ReviewSummary): { kind: DotKind; count: number }[] {
  if (review.high + review.medium + review.low === 0) return [{ kind: 'none', count: 0 }]
  return [
    { kind: 'high', count: review.high },
    { kind: 'medium', count: review.medium },
    { kind: 'low', count: review.low }
  ]
}

type Props = {
  review: ReviewSummary
  compact?: boolean
  onDelete?: (id: string) => void
}

export default function ReviewRow({ review, compact = false, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (onDelete && confirming) {
    return (
      <li data-testid="review-row" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-page-bg px-2 py-2">
        <p className="text-sm">Delete this review? This cannot be undone.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium hover:bg-page-bg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onDelete(review.id)}
            className="rounded-md bg-critical px-3 py-1 text-sm font-medium text-white hover:opacity-90"
          >
            Delete
          </button>
        </div>
      </li>
    )
  }

  return (
    <li data-testid="review-row" className="flex items-center gap-1">
      <Link
        to={`/review/${review.id}`}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 rounded-md hover:bg-page-bg ${compact ? 'gap-y-1 px-1 py-0.5' : 'gap-y-2 px-2 py-2'}`}
      >
        <div className="min-w-0 basis-full xs:basis-0 xs:flex-1">
          <p className="truncate text-sm font-medium">{review.title}</p>
          <p className="text-xs text-text-muted">
            {review.language} - Created {review.timeAgo}
          </p>
        </div>
        <div className="flex w-28 shrink-0 justify-start">
          <ReviewStatusBadge status={review.status} />
        </div>
        <div className="flex w-28 shrink-0 items-center gap-3">
          {dotList(review).map((dot) => (
            <SeverityDot key={dot.kind} kind={dot.kind} count={dot.count} />
          ))}
        </div>
      </Link>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete review ${review.title}`}
          onClick={() => setConfirming(true)}
          className="shrink-0 rounded-md p-2 text-text-muted hover:bg-page-bg hover:text-critical"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
    </li>
  )
}
