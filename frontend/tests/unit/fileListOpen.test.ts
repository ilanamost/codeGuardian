import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileListStorageKey, readFileListOpen, writeFileListOpen } from '../../src/lib/fileListOpen'
import { createStorageService } from '../../src/services/storage.service'

// Plan 038: the remembered open or closed choice of the imported files list.

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readFileListOpen', () => {
  it('is open by default when nothing is stored', () => {
    expect(readFileListOpen()).toBe(true)
  })

  it('reads the stored choice', () => {
    window.localStorage.setItem(fileListStorageKey, JSON.stringify('closed'))
    expect(readFileListOpen()).toBe(false)
    window.localStorage.setItem(fileListStorageKey, JSON.stringify('open'))
    expect(readFileListOpen()).toBe(true)
  })

  it('falls back to open for an old or malformed value', () => {
    for (const raw of ['true', 'false', '"hidden"', '{not json', '0']) {
      window.localStorage.setItem(fileListStorageKey, raw)
      expect(readFileListOpen()).toBe(true)
    }
  })

  it('falls back to open when storage throws or is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readFileListOpen()).toBe(true)
    expect(readFileListOpen(createStorageService(() => undefined))).toBe(true)
  })
})

describe('writeFileListOpen', () => {
  it('stores only the two valid values', () => {
    writeFileListOpen(false)
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"closed"')
    writeFileListOpen(true)
    expect(window.localStorage.getItem(fileListStorageKey)).toBe('"open"')
  })

  it('does not throw when storage is blocked or unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writeFileListOpen(false)).not.toThrow()
    expect(() => writeFileListOpen(false, createStorageService(() => undefined))).not.toThrow()
  })
})
