// Pure helpers shared by services and components. No I/O here.

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (maxLength <= 0) return ''
  if (text.length <= maxLength) return text
  if (maxLength <= suffix.length) return text.slice(0, maxLength)
  return text.slice(0, maxLength - suffix.length) + suffix
}

const timeUnitList: { unit: string; seconds: number }[] = [
  { unit: 'year', seconds: 365 * 24 * 3600 },
  { unit: 'month', seconds: 30 * 24 * 3600 },
  { unit: 'day', seconds: 24 * 3600 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 }
]

// "2 hours ago" style text, as used in the review lists.
export function formatTimeAgo(date: Date | string | number, now: Date | number = Date.now()): string {
  const then = new Date(date).getTime()
  const seconds = Math.max(0, Math.floor((new Date(now).getTime() - then) / 1000))
  for (const { unit, seconds: size } of timeUnitList) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

// Text with Windows line breaks (CR LF) turned into LF, so a pasted file is sent, and its length
// counted, the same on every system.
export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

// A short random id with an optional prefix. Not for security use.
export function createId(prefix = '', random: () => number = Math.random): string {
  const body = Math.floor(random() * 0x100000000)
    .toString(36)
    .padStart(7, '0')
  return prefix ? `${prefix}-${body}` : body
}

// A support ticket number in the SUP-1234 format.
export function createTicketNumber(random: () => number = Math.random): string {
  return `SUP-${Math.floor(1000 + random() * 9000)}`
}

export function groupBy<T, K extends PropertyKey>(list: readonly T[], keyOf: (item: T) => K): Record<K, T[]> {
  const group = {} as Record<K, T[]>
  for (const item of list) {
    const key = keyOf(item)
    ;(group[key] ??= []).push(item)
  }
  return group
}

// Case-insensitive "contains" match used by the repository search.
export function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase())
}

// Toggles an item in a list, keeping order (selected files, test types).
export function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item]
}
