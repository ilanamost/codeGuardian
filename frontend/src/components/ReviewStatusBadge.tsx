import { statusMeta } from '../lib/statusMeta'
import type { ReviewStatus } from '../types'

export default function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const { label, meaning, style } = statusMeta[status]
  return (
    <span
      data-testid={`status-${status}`}
      title={meaning}
      className={`inline-flex rounded-sm px-2 py-1 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  )
}
