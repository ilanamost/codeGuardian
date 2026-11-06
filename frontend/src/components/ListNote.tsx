import { Info } from 'lucide-react'

// A short note above a list, such as "Showing the first 100 repositories" (plan 030).
export default function ListNote({ children }: { children: string }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md bg-page-bg px-3 py-2 text-xs text-text-muted">
      <Info size={14} aria-hidden="true" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}
