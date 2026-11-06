import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { env } from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'

// Plan 042 build check: `vite build` with VITE_BASE_PATH emits asset URLs under the base path and
// copies public/404.html with its segment count filled in.
const root = resolve(__dirname, '../..')
const outDir = mkdtempSync(join(tmpdir(), 'base-path-build-'))

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe('vite build with VITE_BASE_PATH', () => {
  it('emits asset URLs under the base path and copies 404.html', () => {
    const previous = env.VITE_BASE_PATH
    env.VITE_BASE_PATH = '/ai-code-reviewer/'
    try {
      execSync(`npx vite build --outDir "${outDir}" --emptyOutDir`, { cwd: root, stdio: 'pipe' })
    } finally {
      if (previous === undefined) delete env.VITE_BASE_PATH
      else env.VITE_BASE_PATH = previous
    }

    const index = readFileSync(join(outDir, 'index.html'), 'utf8')
    const assetUrls = [...index.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1])
    expect(assetUrls.length).toBeGreaterThan(0)
    for (const url of assetUrls) expect(url.startsWith('/ai-code-reviewer/assets/')).toBe(true)
    expect(index).toContain('href="/ai-code-reviewer/favicon.svg"')

    expect(existsSync(join(outDir, '404.html'))).toBe(true)
    const notFound = readFileSync(join(outDir, '404.html'), 'utf8')
    expect(notFound).toContain('var pathSegmentsToKeep = 1')
    expect(notFound).not.toContain('__PATH_SEGMENTS_TO_KEEP__')
  }, 180_000)
})
