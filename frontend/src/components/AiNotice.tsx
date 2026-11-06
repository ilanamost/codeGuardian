import { useEffect } from 'react'
import { Info } from 'lucide-react'
import { AI_NOTICE_TEXT } from '../lib/review.constants'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchAnalyzer, selectAnalyzer } from '../store/review.slice'

// Plan 039 (Open Questions 2 and 8): under Run review / Save review. Code is sent to Anthropic
// only when the backend's analyzer is `claude`; with the stub a note says findings are rule-based.
// Nothing is shown while the analyzer is unknown.
export default function AiNotice() {
  const dispatch = useAppDispatch()
  const analyzer = useAppSelector(selectAnalyzer)

  useEffect(() => {
    void dispatch(fetchAnalyzer())
  }, [dispatch])

  if (analyzer === null) return null
  return (
    <p data-testid={`ai-notice-${analyzer}`} className="flex items-start gap-1.5 text-xs text-text-muted md:max-w-sm md:justify-end">
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      {AI_NOTICE_TEXT[analyzer]}
    </p>
  )
}
