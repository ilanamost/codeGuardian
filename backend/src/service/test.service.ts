import type { Store } from '../store/store.js'

export type TestService = ReturnType<typeof createTestService>

// Anything with in-memory state the reset clears: the rate limiters.
export type Resettable = { reset(): void }

// Test-only operations, for the e2e suite. Mounted only when `enableTestRoute` is on.
export function createTestService(store: Store, resettableList: Resettable[]) {
  return {
    // Puts every record back to the seed (`src/data/*.json`), so each e2e spec starts clean:
    // every registered account, session and photo goes, only the demo account is left (plan
    // 028), and the rate-limit counters (sign in, sign up, support requests: plan 031) start
    // again. `PgStore` refuses unless its database name ends in `_test` (plan 022).
    async reset(): Promise<void> {
      await store.reset()
      for (const resettable of resettableList) resettable.reset()
    }
  }
}
