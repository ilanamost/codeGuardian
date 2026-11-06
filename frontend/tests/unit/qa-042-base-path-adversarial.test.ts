import { describe, expect, it } from 'vitest'
import { normalizeBasePath } from '../../vite.config'
import { routerBasename } from '../../src/lib/basePath'

// QA plan 042: odd VITE_BASE_PATH values. Valid shapes are normalised; invalid ones stop the build (F6).
describe('qa-042: odd base paths', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['   ', '/'],
    ['/', '/'],
    ['//', '/'],
    ['ai-code-reviewer', '/ai-code-reviewer/'],
    ['/ai-code-reviewer', '/ai-code-reviewer/'],
    ['ai-code-reviewer/', '/ai-code-reviewer/'],
    ['///ai-code-reviewer///', '/ai-code-reviewer/'],
    ['  /ai-code-reviewer/  ', '/ai-code-reviewer/'],
    ['/a/b/', '/a/b/']
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeBasePath(input)).toBe(expected)
  })

  it('collapses repeated slashes inside the path', () => {
    expect(normalizeBasePath('a//b')).toBe('/a/b/')
    expect(normalizeBasePath('/a///b//')).toBe('/a/b/')
  })

  it.each(['x?y', 'x#z', 'x?y#z', 'a/../b', '..', '../x', 'a b', ' a b ', '"quote', '</script>', '%2e%2e', 'ünï', 'a\b', 'a	b'])(
    'rejects %j with a build error that does not echo it',
    (input) => {
      expect(() => normalizeBasePath(input)).toThrow(/VITE_BASE_PATH is invalid/)
      try {
        normalizeBasePath(input)
      } catch (error) {
        if (input.trim().length > 3) expect((error as Error).message).not.toContain(input.trim())
      }
    }
  )

  it('accepts dots, underscores, tildes and hyphens', () => {
    expect(normalizeBasePath('my_repo.name-1~x')).toBe('/my_repo.name-1~x/')
    expect(normalizeBasePath('user.github.io')).toBe('/user.github.io/')
  })

  it('the router basename never ends with a slash except for the root', () => {
    expect(routerBasename('/')).toBe('/')
    expect(routerBasename('/ai-code-reviewer/')).toBe('/ai-code-reviewer')
    expect(routerBasename('/a/b/')).toBe('/a/b')
  })
})
