// At most `max` tasks run at once; the rest wait in a FIFO (plan 039). One backend instance
// (plan 022), so a counter in memory is enough.

export type ConcurrencyLimiter = {
  // `queued` is true when the caller has to wait; `granted` resolves when it may run. The
  // caller MUST call `release` exactly once after it ran (or after it decided not to).
  acquire(): { queued: boolean, granted: Promise<void> }
  release(): void
  // For tests and logs: running and waiting counts.
  count(): { active: number, waiting: number }
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  let active = 0
  const waiting: Array<() => void> = []

  return {
    acquire() {
      if (active < max) {
        active += 1
        return { queued: false, granted: Promise.resolve() }
      }
      const granted = new Promise<void>((resolve) => {
        waiting.push(() => {
          active += 1
          resolve()
        })
      })
      return { queued: true, granted }
    },

    release() {
      active = Math.max(0, active - 1)
      waiting.shift()?.()
    },

    count() {
      return { active, waiting: waiting.length }
    }
  }
}
