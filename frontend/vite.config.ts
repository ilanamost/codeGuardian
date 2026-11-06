/// <reference types="vitest/config" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Plan 042: VITE_BASE_PATH is the sub-path the app is served from (default '/'). A leading and a
// trailing slash are enforced, so 'ai-code-reviewer' and '/ai-code-reviewer' both give '/ai-code-reviewer/'.
// Repeated slashes are collapsed ('a//b' gives '/a/b/'). Anything that is not a letter, digit, dot,
// underscore, tilde, hyphen or slash (so `?`, `#`, whitespace inside, quotes) and any `..` stops the
// build with a clear error; the message never echoes the value.
export const normalizeBasePath = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim().replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9._~/-]*$/.test(trimmed) || trimmed.includes('..')) {
    throw new Error('VITE_BASE_PATH is invalid: use only letters, digits, dot, underscore, tilde, hyphen and slash, without "..", for example /ai-code-reviewer/')
  }
  return trimmed === '' ? '/' : `/${trimmed}/`
}

// Fills the segment count of the base path into the built 404.html (copied from public/).
const notFoundPage = (base: string): Plugin => {
  let outDir = 'dist'
  return {
    name: 'not-found-page-base',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const file = resolve(outDir, '404.html')
      if (!existsSync(file)) return
      const segments = base.split('/').filter(Boolean).length
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__PATH_SEGMENTS_TO_KEEP__', String(segments)))
    }
  }
}

export default defineConfig(({ mode }) => {
  const base = normalizeBasePath(loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH)
  return {
    base,
    define: { __APP_BASE_PATH__: JSON.stringify(base) },
    plugins: [react(), tailwindcss(), notFoundPage(base)],
    server: {
      port: 5173,
      strictPort: true
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      // e2e lives under tests/e2e and belongs to Playwright, not Vitest.
      include: ['tests/unit/**/*.test.{ts,tsx}']
    }
  }
})
