import type { ThemeMode } from '../types'

const darkQuery = '(prefers-color-scheme: dark)'

function getQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(darkQuery)
}

/** Resolves a theme setting to the concrete theme. "system" follows the OS; light where matchMedia is unavailable (jsdom). */
export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return getQuery()?.matches ? 'dark' : 'light'
}

/** Calls onChange when the OS appearance changes. Returns the unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = getQuery()
  if (!query) return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
