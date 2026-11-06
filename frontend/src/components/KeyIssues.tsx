import type { ReactNode } from 'react'
import type { Finding } from '../types'
import SeverityBadge from './SeverityBadge'

type Props = {
  finding: Finding[]
  limit?: number
  // Shown under the heading instead of the list when there is no finding.
  placeholder?: ReactNode
}

export default function KeyIssues({ finding, limit, placeholder }: Props) {
  const shown = limit === undefined ? finding : finding.slice(0, limit)

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Key Issues</h2>
      {shown.length === 0 && placeholder ? (
        placeholder
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
              <SeverityBadge severity={item.severity} />
              <div>
                <p className="text-sm font-medium">{item.message}</p>
                <p className="text-xs text-text-muted">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
