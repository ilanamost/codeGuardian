import { useSyncExternalStore } from 'react'

// Plan 037: how many API requests are in flight, for the global loader (AppShell). The data
// source (services/api.service.ts) holds the count from just before a request is sent until it
// settles (success, failure, cancel or timeout), so the count always returns to zero. A
// background request (the review status poll, the silent settings load) is not counted, so it
// never shows the loader. Holds no request data and never logs.
export interface TrackOption {
  background?: boolean
}

export interface RequestTracker {
  // Counts one request; the returned release ends it and may be called any number of times.
  begin(option?: TrackOption): () => void
  // The requests counted now (background ones never are).
  pendingCount(): number
  subscribe(listener: () => void): () => void
}

const noRelease = () => {}

export function createRequestTracker(): RequestTracker {
  const pendingSet = new Set<symbol>()
  const listenerSet = new Set<() => void>()

  function emit() {
    for (const listener of [...listenerSet]) listener()
  }

  return {
    begin(option = {}) {
      if (option.background) return noRelease
      const token = Symbol('request')
      pendingSet.add(token)
      emit()
      return () => {
        if (pendingSet.delete(token)) emit()
      }
    },
    pendingCount: () => pendingSet.size,
    subscribe(listener) {
      listenerSet.add(listener)
      return () => {
        listenerSet.delete(listener)
      }
    }
  }
}

// The app's one tracker: the API data source counts on it and the global loader reads it.
export const requestTracker = createRequestTracker()

// True while at least one counted request is in flight.
export function useIsRequestPending(tracker: RequestTracker = requestTracker): boolean {
  return useSyncExternalStore(
    tracker.subscribe,
    () => tracker.pendingCount() > 0,
    () => false
  )
}
