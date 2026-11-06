import { LOADER_TIMING } from '../lib/loader.constants'
import { useIsRequestPending, type RequestTracker } from '../lib/requestTracker'
import { useDelayedFlag } from '../lib/useDelayedFlag'

type Props = {
  // The app's tracker by default; tests pass their own.
  tracker?: RequestTracker
}

// Plan 037: a thin bar at the top of the app while an API request is in flight (after 200 ms,
// and at least 400 ms once shown). It never blocks the screen and is silent for screen readers:
// the area loaders announce what loads.
export default function GlobalLoader({ tracker }: Props) {
  const pending = useIsRequestPending(tracker)
  const visible = useDelayedFlag(pending, LOADER_TIMING.showDelayMs, LOADER_TIMING.minVisibleMs)
  if (!visible) return null
  return (
    <div data-testid="global-loader" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-50 h-1 overflow-hidden bg-primary-soft">
      <div className="h-full w-full animate-pulse bg-primary motion-reduce:animate-none" />
    </div>
  )
}
