import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { isRecord } from '../../src/models/guard'
import { createStorageService } from '../../src/services/storage.service'
import { ERROR_CODE } from '../../src/utils/error-messages'

const isNumberList = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === 'number')

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function expectStorageError(run: () => void) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).kind).toBe('storage')
    expect((error as AppError).code).toBe(ERROR_CODE.storage)
    return
  }
  throw new Error('expected a storage AppError')
}

describe('storage.service', () => {
  it('writes JSON and reads it back through a guard', () => {
    const storage = createStorageService()
    storage.set('list', [1, 2])

    expect(window.localStorage.getItem('list')).toBe('[1,2]')
    expect(storage.get('list', isNumberList)).toEqual([1, 2])
    expect(storage.has('list')).toBe(true)
  })

  it('reads undefined for a missing key and the fallback with getOr', () => {
    const storage = createStorageService()

    expect(storage.get('missing', isRecord)).toBeUndefined()
    expect(storage.getOr('missing', isRecord, { a: 1 })).toEqual({ a: 1 })
    expect(storage.has('missing')).toBe(false)
  })

  it('reads undefined for corrupt JSON', () => {
    window.localStorage.setItem('bad', '{not json')

    expect(createStorageService().get('bad', isRecord)).toBeUndefined()
  })

  it('reads undefined when the stored value fails the guard', () => {
    window.localStorage.setItem('list', '["a"]')

    expect(createStorageService().get('list', isNumberList)).toBeUndefined()
  })

  it('reads undefined when the browser blocks reading', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(createStorageService().get('x', isRecord)).toBeUndefined()
    expect(createStorageService().has('x')).toBe(false)
  })

  it('throws a storage AppError when writing fails (full or blocked)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expectStorageError(() => createStorageService().set('x', 1))
  })

  it('throws a storage AppError for a value that cannot be serialized', () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expectStorageError(() => createStorageService().set('x', value))
  })

  it('removes a key and reports removal failures', () => {
    const storage = createStorageService()
    storage.set('x', 1)
    storage.remove('x')
    expect(storage.has('x')).toBe(false)

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expectStorageError(() => storage.remove('x'))
  })

  it('throws on write and reads nothing when storage is unavailable', () => {
    const storage = createStorageService(() => undefined)

    expect(storage.get('x', isRecord)).toBeUndefined()
    expectStorageError(() => storage.set('x', 1))
    expectStorageError(() => storage.remove('x'))
  })
})
