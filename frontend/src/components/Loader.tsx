import { LoaderCircle } from 'lucide-react'
import { LOADER_TEXT } from '../lib/loader.constants'
import { useReducedMotion } from '../lib/useReducedMotion'

export type LoaderSize = 'sm' | 'md' | 'lg'

const iconSizeBy: Record<LoaderSize, number> = { sm: 16, md: 24, lg: 32 }

const textClassBy: Record<LoaderSize, string> = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }

type Props = {
  // The accessible name, also shown next to the spinner unless `labelHidden`.
  label?: string
  labelHidden?: boolean
  // Centred in its area (default), or at the start of the line.
  align?: 'center' | 'start'
  size?: LoaderSize
  // Layout of the area it fills, such as padding or a minimum height.
  className?: string
  // False for a page's other loaders while one of them is announced (plan 037 Risks: one live
  // region at a time): the label stays visible and readable, but it is not a live region.
  announce?: boolean
}

// Plan 037: the one loader of the app, shown in an area while its data loads. A spinner
// (LoaderCircle) with a label, announced politely; under prefers-reduced-motion the spinner
// stands still and the label says it.
export default function Loader({ label = LOADER_TEXT.loading, labelHidden = false, align = 'center', size = 'md', className = '', announce = true }: Props) {
  const reducedMotion = useReducedMotion()
  return (
    <div
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      aria-label={announce ? label : undefined}
      data-testid="loader"
      data-size={size}
      className={`flex items-center ${align === 'start' ? 'justify-start' : 'justify-center'} gap-2 text-text-muted ${textClassBy[size]} ${className}`}
    >
      <LoaderCircle
        size={iconSizeBy[size]}
        aria-hidden="true"
        data-testid="loader-icon"
        className={`shrink-0 text-primary ${reducedMotion ? '' : 'animate-spin motion-reduce:animate-none'}`}
      />
      <span className={labelHidden ? 'sr-only' : ''}>{label}</span>
    </div>
  )
}
