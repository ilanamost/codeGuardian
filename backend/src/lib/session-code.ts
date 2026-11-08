import { createHash, randomBytes } from 'node:crypto'
import { GITHUB_SIGNIN, SESSION, SESSION_CODE } from '../utils/constants.js'

// The one-time sign-in code (authCode, plan 048). A successful GitHub sign-in swaps a session id
// for a short-lived code that travels in the redirect fragment; the exchange route swaps it back.
// Only the SHA-256 hash of the code is kept (a memory dump shows no usable code), a code is
// deleted on first use, and the map is capped. The code and the session id are never logged.

export type SessionCodeOption = {
  now: () => number
  ttlMs: number
  maxCount: number
}

type Entry = { sessionId: string, expiresAt: number }

export function hashSessionCode(code: string): string {
  return createHash(SESSION.hashAlgorithm).update(code).digest(SESSION.hashEncoding)
}

export type SessionCodeStore = ReturnType<typeof createSessionCodeStore>

export function createSessionCodeStore({ now, ttlMs, maxCount }: SessionCodeOption) {
  // A Map keeps insertion order, so the first key is the oldest code.
  const entryMap = new Map<string, Entry>()

  function dropExpired(): void {
    const current = now()
    for (const [hash, entry] of entryMap) {
      if (entry.expiresAt <= current) entryMap.delete(hash)
    }
  }

  return {
    // A new code for this raw session id; when full, expired codes go first, then the oldest.
    issue(sessionId: string): string {
      const code = randomBytes(GITHUB_SIGNIN.randomByteLength).toString(GITHUB_SIGNIN.randomEncoding)
      if (entryMap.size >= maxCount) dropExpired()
      while (entryMap.size >= maxCount) {
        const oldest = entryMap.keys().next()
        if (oldest.done) break
        entryMap.delete(oldest.value)
      }
      entryMap.set(hashSessionCode(code), { sessionId, expiresAt: now() + ttlMs })
      return code
    },

    // The session id of a valid code, and the code is gone. Unknown, expired, malformed and
    // non-string values all give undefined.
    consume(code: unknown): string | undefined {
      if (typeof code !== 'string' || !SESSION_CODE.pattern.test(code)) return undefined
      const hash = hashSessionCode(code)
      const entry = entryMap.get(hash)
      if (!entry) return undefined
      entryMap.delete(hash)
      return entry.expiresAt > now() ? entry.sessionId : undefined
    },

    reset(): void {
      entryMap.clear()
    },

    size(): number {
      return entryMap.size
    },

    holds(hash: string): boolean {
      return entryMap.has(hash)
    }
  }
}
