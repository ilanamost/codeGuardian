import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, CircleCheck, CircleX, FileText, Star } from 'lucide-react'
import { DASHBOARD_LOADING_TEXT } from '../lib/dashboard.constants'
import type { DashboardStat } from '../types'
import Loader from './Loader'

const iconById: Record<DashboardStat['id'], ReactNode> = {
  total: <FileText size={32} className="text-primary" aria-hidden="true" />,
  completed: <CircleCheck size={32} className="text-success" aria-hidden="true" />,
  failed: <CircleX size={32} className="text-danger" aria-hidden="true" />,
  quality: <Star size={32} className="text-warning" aria-hidden="true" />
}

// Plan 037: one minimum height for a stat and its loading card, so the bar keeps its size when the
// data replaces the Loader.
const cardClass = 'flex min-h-26 items-center gap-2 rounded-md border border-border bg-card p-3 md:p-4 shadow-card'

function Stat({ stat }: { stat: DashboardStat }) {
  const isUp = stat.trend >= 0
  const TrendIcon = isUp ? ArrowUp : ArrowDown
  return (
    <div
      data-testid={`stat-${stat.id}`}
      className={`${cardClass} justify-between`}
    >
      <div>
        <p className="text-xs font-bold text-text-muted">{stat.label}</p>
        <p className="text-xl font-semibold">
          {stat.value}
          {stat.suffix ? <span className="text-sm font-normal">{stat.suffix}</span> : null}
        </p>
        <p className={`flex items-center gap-1 text-xs ${isUp ? 'text-success' : 'text-danger'}`}>
          <TrendIcon size={12} aria-hidden="true" />
          {Math.abs(stat.trend)}%
        </p>
      </div>
      {iconById[stat.id]}
    </div>
  )
}

type Props = {
  statList: DashboardStat[]
  // Plan 037: the first load is in flight (no data yet): one Loader across the bar, in a card of
  // the stat's height.
  loading?: boolean
}

export default function DashboardStatBar({ statList, loading = false }: Props) {
  return (
    <div data-testid="stat-bar" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {loading ? (
        <div className={`${cardClass} col-span-2 justify-center lg:col-span-4`}>
          <Loader label={DASHBOARD_LOADING_TEXT.stat} />
        </div>
      ) : (
        statList.map((stat) => <Stat key={stat.id} stat={stat} />)
      )}
    </div>
  )
}
