import { FlaskConical, Lightbulb, ScanSearch, type LucideIcon } from 'lucide-react'
import { reviewPlaceholderTestId, type ReviewPlaceholderTab } from '../lib/review.constants'
import { reviewPlaceholderFor } from '../lib/reviewPlaceholder'
import { useSettings } from '../lib/useSettings'
import type { ReviewStatus } from '../types'
import EmptyState from './EmptyState'

// One icon per concept: Lightbulb is the suggestion icon of SuggestionBadge.
const iconByTab: Record<ReviewPlaceholderTab, LucideIcon> = {
  finding: ScanSearch,
  suggestion: Lightbulb,
  generated_test: FlaskConical
}

type Props = {
  tab: ReviewPlaceholderTab
  status: ReviewStatus
  isNew: boolean
}

// What a review tab shows while its list is empty; the text depends on the review's state.
export default function TabPlaceholder({ tab, status, isNew }: Props) {
  const { settings } = useSettings()
  const { title, detail, hint } = reviewPlaceholderFor(tab, status, isNew, settings.generatedTest)

  return (
    <EmptyState
      Icon={iconByTab[tab]}
      title={title}
      detail={detail}
      testId={reviewPlaceholderTestId(tab)}
      action={hint && <p className="text-xs text-text-muted">{hint}</p>}
    />
  )
}
