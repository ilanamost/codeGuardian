// Plan 037: the shared loader (components/Loader.tsx) and the global loader in the app shell.
export const LOADER_TEXT = {
  // The default accessible name and visible label of a Loader.
  loading: 'Loading...'
} as const

// Open Question 2A: a loader appears only after a short delay (no flicker for fast calls), and
// once shown it stays at least a minimum time.
export const LOADER_TIMING = {
  showDelayMs: 200,
  minVisibleMs: 400
} as const
