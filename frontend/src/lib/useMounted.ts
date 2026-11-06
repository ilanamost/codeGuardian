import { useEffect, useRef } from 'react'

// A ref that is true while the component is mounted, for work that finishes after an await
// (navigate only if the user is still on the page that started it).
export function useMounted() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}
