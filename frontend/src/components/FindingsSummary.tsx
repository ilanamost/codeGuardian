import type { FindingCount } from '../types'

const dotBySeverity = {
  critical: 'bg-critical',
  high: 'bg-high',
  medium: 'bg-medium',
  low: 'bg-low'
}

const labelBySeverity = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

export default function FindingsSummary({ findingCount }: { findingCount: FindingCount[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Findings Summary</h2>
      <ul className="grid grid-cols-2 gap-3">
        {findingCount.map(({ severity, count }) => (
          <li key={severity} className="flex items-center justify-between rounded-md bg-page-bg px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${dotBySeverity[severity]}`} aria-hidden="true" />
              {labelBySeverity[severity]}
            </span>
            <span data-testid={`count-${severity}`} className="font-semibold">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
