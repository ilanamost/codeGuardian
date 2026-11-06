// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createSyntaxChecker } from '../../src/lib/syntaxCheck'

// Plan 032: web-tree-sitter keeps its runtime once loaded, so this file runs on its own (a fresh
// module copy) with a runtime that cannot load. Every grammar language then rejects, and the
// caller shows no marker (CodeEditor shows one toast).
const grammar = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../node_modules', path)))

it('rejects for every language when the runtime cannot load', async () => {
  const check = createSyntaxChecker({
    runtime: new Uint8Array([0, 1, 2, 3]),
    grammar: {
      Python: grammar('tree-sitter-python/tree-sitter-python.wasm'),
      Go: grammar('tree-sitter-go/tree-sitter-go.wasm'),
      Java: grammar('tree-sitter-java/tree-sitter-java.wasm')
    }
  })
  await expect(check('Python', 'x = 1\n')).rejects.toBeDefined()
  await expect(check('Java', 'class A {}\n')).rejects.toBeDefined()
  // Languages without a grammar never load anything.
  expect(await check('TypeScript', 'const x = 1')).toEqual([])
})
