import { useState } from 'react'
import { ChartArea } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { activityRangeList, DASHBOARD_EMPTY_TEXT, DASHBOARD_LOADING_TEXT } from '../lib/dashboard.constants'
import type { ActivityPoint, ActivityRange } from '../types'
import EmptyState from './EmptyState'
import Loader from './Loader'

type Props = {
  activityByRange: Record<ActivityRange, ActivityPoint[]>
  // Plan 037: the first load is in flight, so the Loader is shown instead of an empty state.
  loading?: boolean
}

// Plan 037 (Validation 6): the Loader, the empty state and the data share one body with a minimum
// height that covers each of them, so the block keeps its size when the data arrives.
const bodyClass = 'flex min-h-50 flex-col justify-center'

export default function ReviewActivity({ activityByRange, loading = false }: Props) {
  const [range, setRange] = useState<ActivityRange>('7d')
  const pointList = activityByRange[range] ?? []
  const isEmpty = pointList.every((point) => point.count === 0)

  return (
    <section aria-labelledby="review-activity-title" className="min-w-0 rounded-md border border-border bg-card p-4 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="review-activity-title" className="text-sm font-bold">
          Review Activity
        </h2>
        <select
          aria-label="Date range"
          value={range}
          onChange={(event) => setRange(event.target.value as ActivityRange)}
          className="rounded-sm border border-input-border bg-surface px-2 py-1 text-base sm:text-xs"
        >
          {activityRangeList.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <p data-testid="activity-count" className="sr-only">
        {pointList.length} days
      </p>
      <div data-testid="activity-body" className={bodyClass}>
      {loading ? (
        <Loader label={DASHBOARD_LOADING_TEXT.activity} announce={false} />
      ) : isEmpty ? (
        <EmptyState
          testId="activity-empty"
          Icon={ChartArea}
          title={DASHBOARD_EMPTY_TEXT.activityTitle}
          detail={DASHBOARD_EMPTY_TEXT.activityDetail}
        />
      ) : (
      <AreaChart data={pointList} width="100%" height={200} style={{ width: '100%' }} responsive>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis width={28} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
        <Area
          type="monotone"
          dataKey="count"
          stroke="var(--color-primary)"
          fill="var(--color-primary-soft)"
          strokeWidth={2}
          dot={{ r: 3, fill: 'var(--color-primary)' }}
          isAnimationActive={false}
        />
      </AreaChart>
      )}
      </div>
    </section>
  )
}
