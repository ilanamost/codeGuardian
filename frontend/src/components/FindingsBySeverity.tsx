import { ChartPie } from 'lucide-react'
import { Cell, Pie, PieChart } from 'recharts'
import { DASHBOARD_EMPTY_TEXT, DASHBOARD_LOADING_TEXT } from '../lib/dashboard.constants'
import type { Severity, SeverityCount } from '../types'
import EmptyState from './EmptyState'
import Loader from './Loader'

const colorBySeverity: Record<Severity, string> = {
  critical: 'var(--color-critical)',
  high: 'var(--color-high)',
  medium: 'var(--color-medium)',
  low: 'var(--color-low)',
  info: 'var(--color-low)'
}

const dotBySeverity: Record<Severity, string> = {
  critical: 'bg-critical',
  high: 'bg-high',
  medium: 'bg-medium',
  low: 'bg-low',
  info: 'bg-low'
}

const size = 160

// Plan 037 (Validation 6): the Loader, the empty state and the data share one body with a minimum
// height that covers each of them, so the block keeps its size when the data arrives. Below 20rem
// of block width the legend goes under the donut (160 + 24 + 104 px = min-h-72); wider, they
// sit side by side and min-h-50 covers the donut and the empty state.
const bodyClass = 'flex min-h-72 flex-col justify-center @min-[20rem]:min-h-50'

// `loading` (plan 037): the first load is in flight, so the Loader is shown instead of an empty state.
export default function FindingsBySeverity({ countList, loading = false }: { countList: SeverityCount[]; loading?: boolean }) {
  const total = countList.reduce((sum, item) => sum + item.count, 0)
  return (
    <section aria-labelledby="findings-severity-title" className="@container min-w-0 rounded-md border border-border bg-card p-4 shadow-card">
      <h2 id="findings-severity-title" className="mb-4 text-sm font-bold">
        Findings by Severity
      </h2>
      <div data-testid="severity-body" className={bodyClass}>
      {loading ? (
        <Loader label={DASHBOARD_LOADING_TEXT.severity} announce={false} />
      ) : total === 0 ? (
        <EmptyState
          testId="severity-empty"
          Icon={ChartPie}
          title={DASHBOARD_EMPTY_TEXT.severityTitle}
          detail={DASHBOARD_EMPTY_TEXT.severityDetail}
        />
      ) : (
      <div className="flex flex-col gap-6 @min-[20rem]:flex-row @min-[20rem]:items-center">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <PieChart width={size} height={size}>
            <Pie data={countList} dataKey="count" nameKey="label" innerRadius={50} outerRadius={78} stroke="none" isAnimationActive={false}>
              {countList.map((item) => (
                <Cell key={item.severity} fill={colorBySeverity[item.severity]} />
              ))}
            </Pie>
          </PieChart>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span data-testid="severity-total" className="text-xl font-semibold">
              {total}
            </span>
            <span className="text-xs text-text-muted">Total Findings</span>
          </div>
        </div>
        <ul className="flex flex-1 flex-col gap-2 text-sm">
          {countList.map((item) => (
            <li key={item.severity} data-testid={`legend-${item.severity}`} className="flex items-center gap-3">
              <span className={`size-2 rounded-full ${dotBySeverity[item.severity]}`} aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              <span className="text-text-muted">
                {item.count} ({total ? Math.round((item.count / total) * 100) : 0}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
      )}
      </div>
    </section>
  )
}
