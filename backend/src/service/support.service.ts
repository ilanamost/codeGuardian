import { tooManyAttemptError } from '../lib/error.js'
import type { RateLimiter } from '../lib/rate-limit.js'
import type { SupportRequestInput } from '../schema/support.schema.js'
import type { Store } from '../store/store.js'

export type SupportService = ReturnType<typeof createSupportService>

export type SupportServiceOption = {
  // Support requests per org (plan 031, Open Question 5; kept by plan 032).
  limiter: RateLimiter
}

export function createSupportService(store: Store, now: () => number, option: SupportServiceOption) {
  return {
    // Checks the org's limit, then keeps the request in the store and returns its ticket (format
    // in `TICKET`). The app sends no email (plan 032): the frontend opens the user's mail app.
    async create(orgId: string, input: SupportRequestInput): Promise<{ ticket: string }> {
      const wait = option.limiter.retryAfter(orgId)
      if (wait !== undefined) throw tooManyAttemptError(wait)
      // Counted before the store call, so parallel requests cannot pass the limit together.
      option.limiter.hit(orgId)
      const ticket = await store.createSupportRequest(orgId, { ...input, createdAt: new Date(now()).toISOString() })
      return { ticket }
    }
  }
}
