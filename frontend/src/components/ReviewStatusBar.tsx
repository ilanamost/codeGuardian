import type { ReactNode } from 'react'
import { CircleCheck, Clock, Star } from 'lucide-react'
import type { ReviewStatus } from '../types'
import { statusMeta } from '../lib/statusMeta'

type Props = {
  status: ReviewStatus
  language: string
  analyzedAgo: string
  qualityScore: number
}

function Field({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-3 shadow-card md:p-4">
      {icon}
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  )
}

export default function ReviewStatusBar({ status, language, analyzedAgo, qualityScore }: Props) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Field
        label="Overall Status"
        value={statusMeta[status].label}
        icon={<CircleCheck size={32} className="text-success" aria-hidden="true" />}
      />
      <Field
        label="Language"
        value={language}
        icon={<span className="flex size-8 items-center justify-center rounded-sm bg-primary-soft text-xs font-bold text-primary">TS</span>}
      />
      <Field label="Analyzed" value={analyzedAgo} icon={<Clock size={32} className="text-text-muted" aria-hidden="true" />} />
      <Field
        label="Quality Score"
        value={`${qualityScore} / 100`}
        icon={<Star size={32} className="text-warning" aria-hidden="true" />}
      />
    </div>
  )
}
