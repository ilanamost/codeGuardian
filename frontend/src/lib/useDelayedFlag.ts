import { useEffect, useRef, useState } from 'react'

// Plan 037, Open Question 2A: true once `active` has stayed true for `delayMs` (a shorter
// activity never shows), and once true it stays true at least `minMs`, even when `active` ended
// sooner, so a loader never flickers.
export function useDelayedFlag(active: boolean, delayMs: number, minMs: number): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (active === shown) return
    if (active) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now()
        setShown(true)
      }, delayMs)
      return () => clearTimeout(timer)
    }
    const left = Math.max(0, minMs - (Date.now() - shownAt.current))
    const timer = setTimeout(() => setShown(false), left)
    return () => clearTimeout(timer)
  }, [active, shown, delayMs, minMs])

  return shown
}
