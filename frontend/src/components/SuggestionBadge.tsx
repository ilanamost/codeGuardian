import { Lightbulb } from 'lucide-react'

export default function SuggestionBadge() {
  return (
    <span
      data-testid="suggestion-badge"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
    >
      <Lightbulb size={16} aria-hidden="true" />
    </span>
  )
}
