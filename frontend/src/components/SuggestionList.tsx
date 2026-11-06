import type { Suggestion } from '../types'
import SuggestionBadge from './SuggestionBadge'

export default function SuggestionList({ suggestion }: { suggestion: Suggestion[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Suggested Refactors</h2>
      <ul className="flex flex-col gap-3">
        {suggestion.map((item) => (
          <li key={item.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left">
            <SuggestionBadge />
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-text-muted">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
