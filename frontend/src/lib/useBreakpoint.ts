import { useEffect, useState } from 'react'

export const breakpointPx = { xs: 480, md: 768, lg: 1024, xl: 1280 } as const

export type Breakpoint = keyof typeof breakpointPx

function matches(breakpoint: Breakpoint, fallback: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback
  return window.matchMedia(`(min-width: ${breakpointPx[breakpoint]}px)`).matches
}

/**
 * True when the viewport is at least the given breakpoint wide. `fallback` (false by default) where
 * matchMedia is unavailable (jsdom).
 */
export function useBreakpoint(breakpoint: Breakpoint, fallback = false): boolean {
  const [isUp, setIsUp] = useState(() => matches(breakpoint, fallback))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(min-width: ${breakpointPx[breakpoint]}px)`)
    const onChange = () => setIsUp(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [breakpoint])

  return isUp
}
