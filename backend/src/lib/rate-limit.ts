import { LIMIT } from '../utils/limits.js'
import { TIME } from '../utils/constants.js'

// A sliding-window counter per key (plan 028, Scope 8), in memory: one backend instance (plan
// 022), so the counts reset on restart and on the test reset. The clock is injected.

export type RateLimiter = {
  // Seconds to wait when `key` has used up the window, otherwise undefined.
  retryAfter(key: string): number | undefined
  hit(key: string): void
  reset(): void
}

export function createRateLimiter(option: { limit: number, windowMs: number, now: () => number }): RateLimiter {
  const hitMap = new Map<string, number[]>()

  function live(key: string, time: number): number[] {
    const list = (hitMap.get(key) ?? []).filter((at) => at > time - option.windowMs)
    if (list.length === 0) hitMap.delete(key)
    else hitMap.set(key, list)
    return list
  }

  // Keeps the map bounded: keys whose hits all left the window are dropped.
  function sweep(time: number): void {
    if (hitMap.size < LIMIT.rateLimit.sweepKeyCount) return
    for (const key of [...hitMap.keys()]) live(key, time)
  }

  return {
    retryAfter(key) {
      const time = option.now()
      const list = live(key, time)
      if (list.length < option.limit) return undefined
      const oldest = list[list.length - option.limit] ?? time
      return Math.max(1, Math.ceil((oldest + option.windowMs - time) / TIME.msPerSecond))
    },

    hit(key) {
      const time = option.now()
      sweep(time)
      hitMap.set(key, [...live(key, time), time])
    },

    reset() {
      hitMap.clear()
    }
  }
}

// The three limits of plan 028: failed sign-ins per user name, sign-in attempts per client IP,
// and sign-ups per client IP.
export type LoginLimiter = {
  userFailure: RateLimiter
  signInIp: RateLimiter
  signUpIp: RateLimiter
  reset(): void
}

export function createLoginLimiter(now: () => number): LoginLimiter {
  const userFailure = createRateLimiter({ ...LIMIT.rateLimit.signInUserFailure, now })
  const signInIp = createRateLimiter({ ...LIMIT.rateLimit.signInIp, now })
  const signUpIp = createRateLimiter({ ...LIMIT.rateLimit.signUpIp, now })
  return {
    userFailure,
    signInIp,
    signUpIp,
    reset() {
      userFailure.reset()
      signInIp.reset()
      signUpIp.reset()
    }
  }
}
