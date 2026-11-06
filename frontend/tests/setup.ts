import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// The editor's Shiki highlighting loads in the browser only (plan 027): unit tests mock
// @monaco-editor/react, so the editor renders right away as highlighted (apply does nothing).
// tests/unit/useHighlight.test.ts tests the real hook.
vi.mock('../src/lib/useHighlight', () => ({ useHighlight: () => ({ status: 'ready', apply: () => {} }) }))
