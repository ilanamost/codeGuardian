import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Props = {
  Icon: LucideIcon
  title: string
  detail: string
  // An optional next step, such as a link to start a review.
  action?: ReactNode
  testId?: string
}

// What a dashboard block or a list shows when it has no data yet (instead of an empty chart).
export default function EmptyState({ Icon, title, detail, action, testId }: Props) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon size={32} className="text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-text-muted">{detail}</p>
      {action}
    </div>
  )
}
