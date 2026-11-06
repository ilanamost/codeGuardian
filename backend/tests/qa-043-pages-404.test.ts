import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// QA of plan 043: the Pages 404.html redirect plus the index.html restore script keep a query
// string such as ?auth_error=... Both scripts are run against a fake location (no browser).

const publicDir = resolve(__dirname, '../../frontend')
const script = (file: string): string => /<script>([\s\S]*?)<\/script>/.exec(readFileSync(resolve(publicDir, file), 'utf8'))?.[1] ?? ''

function redirectedTo(pathname: string, search: string, hash: string, segments: number): { search: string, pathname: string, hash: string } {
  let target = ''
  const location = { protocol: 'https:', hostname: 'user.github.io', port: '', pathname, search, hash, replace: (value: string) => { target = value } }
  new Function('window', script('public/404.html').replace('__PATH_SEGMENTS_TO_KEEP__', String(segments)).replace(/window\.location/g, 'window.location'))({ location })
  const url = new URL(target)
  return { pathname: url.pathname, search: url.search, hash: url.hash }
}

function restored(location: { pathname: string, search: string, hash: string }): string {
  let result = ''
  const window = { location, history: { replaceState: (_a: unknown, _b: unknown, url: string) => { result = url } } }
  new Function('window', script('index.html'))(window)
  return result || `${location.pathname}${location.search}${location.hash}`
}

describe('Pages 404 redirect and restore', () => {
  it.each([
    ['/repo/login', '?auth_error=invalid_state', '', '/repo/login?auth_error=invalid_state'],
    ['/repo/settings', '?section=account&auth_error=access_denied', '', '/repo/settings?section=account&auth_error=access_denied'],
    ['/repo/review', '?x=1&y=2', '#frag', '/repo/review?x=1&y=2#frag'],
    ['/repo/a/b', '', '', '/repo/a/b'],
    ['/repo/login', '?auth_error=a~and~b', '', '/repo/login?auth_error=a~and~b']
  ])('%s%s keeps its path and query', (pathname, search, hash, expected) => {
    const hop = redirectedTo(pathname, search, hash, 1)
    expect(hop.pathname).toBe('/repo/')
    const url = restored(hop)
    // The literal text ~and~ in a user value is the one known ambiguity of the technique.
    if (expected.includes('~and~')) expect(url).not.toBe(expected)
    else expect(url).toBe(expected)
  })

  it('a root site (0 segments) keeps the query too', () => {
    const hop = redirectedTo('/login', '?auth_error=denied', '', 0)
    expect(hop.pathname).toBe('/')
    expect(restored(hop)).toBe('/login?auth_error=denied')
  })
})
