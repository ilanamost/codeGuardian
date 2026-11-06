import { AlertTriangle, Bug, CircleAlert, Info, ShieldAlert } from 'lucide-react'
import type { Severity } from '../types'

const styleBySeverity: Record<Severity, string> = {
  critical: 'bg-critical-soft text-critical',
  high: 'bg-high-soft text-high',
  medium: 'bg-medium-soft text-medium',
  low: 'bg-low-soft text-low',
  info: 'bg-low-soft text-low'
}

const iconBySeverity = {
  critical: ShieldAlert,
  high: AlertTriangle,
  medium: CircleAlert,
  low: Bug,
  info: Info
}

export default function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = iconBySeverity[severity]
  return (
    <span
      data-testid={`severity-${severity}`}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full ${styleBySeverity[severity]}`}
    >
      <Icon size={16} aria-hidden="true" />
    </span>
  )
}
