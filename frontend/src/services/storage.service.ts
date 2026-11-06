import { AppError } from '../models/app-error'
import type { Guard } from '../models/guard'
import { ERROR_CODE } from '../utils/error-messages'

// The only module that touches window.localStorage. Reads never throw (a missing, blocked or
// corrupt value reads as undefined); writes throw an AppError with kind `storage` so the caller
// can report it. Values are JSON; every read is checked with a guard.
export interface StorageService {
  get<T>(key: string, guard: Guard<T>): T | undefined
  getOr<T>(key: string, guard: Guard<T>, fallback: T): T
  set(key: string, value: unknown): void
  remove(key: string): void
  has(key: string): boolean
}

export type StorageProvider = () => Storage | undefined

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    // Some browsers throw on access when storage is disabled.
    return undefined
  }
}

function storageError(cause: unknown, message: string): AppError {
  return new AppError({ code: ERROR_CODE.storage, kind: 'storage', message, cause })
}

export function createStorageService(provider: StorageProvider = browserStorage): StorageService {
  function readRaw(key: string): string | null {
    try {
      return provider()?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  function get<T>(key: string, guard: Guard<T>): T | undefined {
    const raw = readRaw(key)
    if (raw === null) return undefined
    try {
      const parsed: unknown = JSON.parse(raw)
      return guard(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  return {
    get,
    getOr(key, guard, fallback) {
      return get(key, guard) ?? fallback
    },
    set(key, value) {
      const storage = provider()
      if (!storage) throw storageError(undefined, 'Storage unavailable')
      let text: string
      try {
        text = JSON.stringify(value)
      } catch (error) {
        throw storageError(error, 'Value is not serializable')
      }
      try {
        storage.setItem(key, text)
      } catch (error) {
        // Quota exceeded, private mode or blocked by the browser.
        throw storageError(error, 'Storage write failed')
      }
    },
    remove(key) {
      const storage = provider()
      if (!storage) throw storageError(undefined, 'Storage unavailable')
      try {
        storage.removeItem(key)
      } catch (error) {
        throw storageError(error, 'Storage remove failed')
      }
    },
    has(key) {
      return readRaw(key) !== null
    }
  }
}
