// Small shape checks for data read from the API or browser storage. They reject malformed
// payloads instead of letting them reach Redux state (.rule/security-rules.md: validate on read).

export type Guard<T> = (value: unknown) => value is T

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isArrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard)
}

export function hasFields(value: unknown, field: Record<string, (value: unknown) => boolean>): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  return Object.entries(field).every(([key, guard]) => guard(value[key]))
}

export function isOneOf<T extends string>(list: readonly T[]): Guard<T> {
  return (value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)
}

export function isOptional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value: unknown): value is T | undefined => value === undefined || guard(value)
}

export function isRecordOf<T>(guard: Guard<T>): Guard<Record<string, T>> {
  return (value: unknown): value is Record<string, T> => isRecord(value) && Object.values(value).every(guard)
}
