import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBreakpoint } from '../../src/lib/useBreakpoint'

function mockMatchMedia(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return { matches: width >= min, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  }) as unknown as typeof window.matchMedia
}

describe('useBreakpoint', () => {
  afterEach(() => {
    // @ts-expect-error restore jsdom default (no matchMedia)
    delete window.matchMedia
  })

  it('returns false when matchMedia is unavailable', () => {
    expect(renderHook(() => useBreakpoint('md')).result.current).toBe(false)
  })

  it('returns true at or above the breakpoint', () => {
    mockMatchMedia(768)
    expect(renderHook(() => useBreakpoint('md')).result.current).toBe(true)
  })

  it('returns false below the breakpoint', () => {
    mockMatchMedia(375)
    expect(renderHook(() => useBreakpoint('md')).result.current).toBe(false)
  })
})
