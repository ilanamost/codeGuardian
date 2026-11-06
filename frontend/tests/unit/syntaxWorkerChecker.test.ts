// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSyntaxChecker, createWorkerChecker, type SyntaxWorker, type SyntaxWorkerRequest, type SyntaxWorkerResponse } from '../../src/lib/syntaxCheck'
import { SYNTAX_LIMIT, SYNTAX_TEXT } from '../../src/lib/review.constants'

// Plan 032, QA F1: the app's checker sends each check to a Web Worker, so the parse never runs on
// the main thread. The fake worker here answers with the real engine (on the real grammars, read
// from node_modules), but on a later task, as a worker would.
const bytes = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../node_modules', path)))
const engine = createSyntaxChecker({
  runtime: bytes('web-tree-sitter/web-tree-sitter.wasm'),
  grammar: {
    Python: bytes('tree-sitter-python/tree-sitter-python.wasm'),
    Go: bytes('tree-sitter-go/tree-sitter-go.wasm'),
    Java: bytes('tree-sitter-java/tree-sitter-java.wasm')
  }
})

type Listener = (event: Event) => void

function fakeWorker(answer: (request: SyntaxWorkerRequest) => Promise<SyntaxWorkerResponse | null> = async (request) => ({ id: request.id, ok: true, markList: await engine(request.language, request.code) })) {
  const listener: Record<string, Listener[]> = { message: [], error: [], messageerror: [] }
  const requestList: SyntaxWorkerRequest[] = []
  const worker: SyntaxWorker = {
    postMessage: (request) => {
      requestList.push(request)
      // The parse happens on another task, never inside the caller's call.
      setTimeout(async () => {
        const response = await answer(request)
        if (response) for (const item of listener.message) item(new MessageEvent('message', { data: response }))
      }, 0)
    },
    addEventListener: (type, item) => listener[type].push(item)
  }
  const emit = (type: 'error' | 'messageerror') => {
    for (const item of listener[type]) item(new Event(type))
  }
  return { worker, requestList, emit }
}

// A 5 000-line Python file with an unclosed `(` on line 1: tree-sitter's error recovery makes this
// the slowest kind of parse (QA measured 163-185 ms on the main thread).
function largeBrokenPython() {
  let code = 'x = (1,\n'
  for (let index = 0; code.split('\n').length < 5000; index += 1) {
    code += `def f${index}(a, b):\n    if a > b:\n        return [x * 2 for x in range(a)]\n    return {"k": (a, b)}\n\n`
  }
  return code.slice(0, SYNTAX_LIMIT.contentMax)
}

describe('createWorkerChecker', () => {
  it('creates no worker for TypeScript, JavaScript, blank code or code over the limit', async () => {
    const createWorker = vi.fn(() => fakeWorker().worker)
    const check = createWorkerChecker(createWorker)
    expect(await check('TypeScript', 'const x = )')).toEqual([])
    expect(await check('JavaScript', 'let = ;')).toEqual([])
    expect(await check('Python', ' \n\t')).toEqual([])
    expect(await check('Python', `x = )\n${'#'.repeat(SYNTAX_LIMIT.contentMax)}`)).toEqual([])
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('checks in the worker and answers each check with its own result', async () => {
    const fake = fakeWorker()
    const createWorker = vi.fn(() => fake.worker)
    const check = createWorkerChecker(createWorker)
    const [python, java] = await Promise.all([check('Python', 'x = 1)\n'), check('Java', 'class A {\n}\n}\n')])
    expect(python).toMatchObject([{ startLine: 1, startColumn: 6, message: SYNTAX_TEXT.unexpected(')') }])
    expect(java).toMatchObject([{ startLine: 3, startColumn: 1, message: SYNTAX_TEXT.unexpected('}') }])
    expect(await check('Go', 'package main\n')).toEqual([])
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(fake.requestList.map((request) => request.id)).toEqual([1, 2, 3])
  })

  it('returns from the call at once: a 5 000-line file with an early error never parses on the calling task', async () => {
    const code = largeBrokenPython()
    expect(code.split('\n').length).toBeGreaterThanOrEqual(5000)
    const check = createWorkerChecker(() => fakeWorker().worker)
    await check('Python', 'x = 1')
    const start = performance.now()
    const result = check('Python', code)
    // The main thread only posts the code; the long task budget is 100 ms.
    expect(performance.now() - start).toBeLessThan(100)
    const [first] = await result
    expect(first).toMatchObject({ startLine: 1, startColumn: 5 })
  })

  it('rejects a check when the worker cannot load the grammar, and keeps working for the next one', async () => {
    const fake = fakeWorker(async (request) => (request.language === 'Go' ? { id: request.id, ok: false } : { id: request.id, ok: true, markList: [] }))
    const check = createWorkerChecker(() => fake.worker)
    await expect(check('Go', 'package main\n')).rejects.toBeDefined()
    expect(await check('Python', 'x = 1\n')).toEqual([])
  })

  it('rejects the pending and every later check when the worker itself fails, and makes no new worker', async () => {
    const fake = fakeWorker(async () => null)
    const createWorker = vi.fn(() => fake.worker)
    const check = createWorkerChecker(createWorker)
    const pending = check('Python', 'x = 1\n')
    fake.emit('error')
    await expect(pending).rejects.toBeDefined()
    await expect(check('Java', 'class A {}\n')).rejects.toBeDefined()
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('rejects when the worker cannot be created', async () => {
    const createWorker = vi.fn((): SyntaxWorker => {
      throw new Error('blocked')
    })
    const check = createWorkerChecker(createWorker)
    await expect(check('Python', 'x = 1\n')).rejects.toThrow('blocked')
    await expect(check('Python', 'x = 2\n')).rejects.toBeDefined()
    expect(createWorker).toHaveBeenCalledTimes(1)
  })
})
