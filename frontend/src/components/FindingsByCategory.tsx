import { ChartBar } from 'lucide-react'
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { DASHBOARD_EMPTY_TEXT, DASHBOARD_LOADING_TEXT } from '../lib/dashboard.constants'
import type { CategoryCount } from '../types'
import EmptyState from './EmptyState'
import Loader from './Loader'

const colorList = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)']

const labelWidth = 90

// Recharts right-aligns Y-axis labels against the axis line; start them at the chart's left edge (x = 0) instead.
function LeftAlignedTick({ y, payload }: { y?: string | number; payload?: { value: string } }) {
  return (
    <text x={0} y={y} dy={4} textAnchor="start" fontSize={12} fill="var(--color-text-muted)">
      {payload?.value}
    </text>
  )
}

// Plan 037 (Validation 6): the Loader, the empty state and the data share one body with a minimum
// height that covers each of them, so the block keeps its size when the data arrives.
const bodyClass = 'flex min-h-50 flex-col justify-center'

// `loading` (plan 037): the first load is in flight, so the Loader is shown instead of an empty state.
export default function FindingsByCategory({ countList, loading = false }: { countList: CategoryCount[]; loading?: boolean }) {
  return (
    <section aria-labelledby="findings-category-title" className="min-w-0 rounded-md border border-border bg-card p-4 shadow-card">
      <h2 id="findings-category-title" className="mb-4 text-sm font-bold">
        Findings by Category
      </h2>
      {/* Only categories with at least one finding are listed (contract 0.5.0), so none means no findings. */}
      <div data-testid="category-body" className={bodyClass}>
      {loading ? (
        <Loader label={DASHBOARD_LOADING_TEXT.category} announce={false} />
      ) : countList.length === 0 ? (
        <EmptyState
          testId="category-empty"
          Icon={ChartBar}
          title={DASHBOARD_EMPTY_TEXT.categoryTitle}
          detail={DASHBOARD_EMPTY_TEXT.categoryDetail}
        />
      ) : (
      <BarChart
        data={countList}
        layout="vertical"
        width="100%"
        height={countList.length * 36}
        margin={{ top: 0, right: 24, bottom: 0, left: 0 }}
        style={{ width: '100%' }}
        responsive
      >
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={labelWidth} axisLine={false} tickLine={false} tick={LeftAlignedTick} />
        <Bar dataKey="count" barSize={6} radius={3} isAnimationActive={false}>
          {countList.map((item, index) => (
            <Cell key={item.id} fill={colorList[index % colorList.length]} />
          ))}
          <LabelList dataKey="count" position="right" fontSize={12} fill="var(--color-text-muted)" />
        </Bar>
      </BarChart>
      )}
      </div>
    </section>
  )
}
