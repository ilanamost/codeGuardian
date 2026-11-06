import { useId } from 'react'

export type DotKind = 'high' | 'medium' | 'low' | 'none'

const dotMeta: Record<DotKind, { label: string; color: string }> = {
  high: { label: 'High severity findings', color: 'bg-critical' },
  medium: { label: 'Medium severity findings', color: 'bg-medium' },
  low: { label: 'Low severity findings', color: 'bg-low' },
  none: { label: 'No findings', color: 'bg-success' }
}

export default function SeverityDot({ kind, count }: { kind: DotKind; count: number }) {
  const tooltipId = useId()
  const { label, color } = dotMeta[kind]
  return (
    <span
      tabIndex={0}
      aria-describedby={tooltipId}
      data-testid={`dot-${kind}`}
      className="group relative inline-flex items-center gap-1 text-xs text-text-muted outline-none"
    >
      <span className={`size-2 rounded-full ${color}`} aria-hidden="true" />
      {count}
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-sm bg-sidebar-bg px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block group-focus:block"
      >
        {kind === 'none' ? label : `${label}: ${count}`}
      </span>
    </span>
  )
}
