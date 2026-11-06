import { SYNTAX_LIMIT } from './review.constants'
import { hasSyntaxGrammar, type SyntaxChecker, type SyntaxErrorMark } from './syntaxEngine'

// Plan 032: the editor's syntax check, `checkSyntax(language, code)`. Python, Go and Java are parsed
// with their tree-sitter grammars by lib/syntaxEngine.ts (the only module that uses
// web-tree-sitter). In the app that engine runs in a Web Worker (lib/syntax.worker.ts), so a slow
// parse of a large broken file never blocks typing or painting (QA F1). The worker is created
// the first time code of a checked language is checked, and it loads the runtime and each grammar
// from the app's own origin once. TypeScript and JavaScript, blank code and code over the review
// limit get no result and start nothing. The code is parsed, never run, and never leaves the
// browser.

export {
  createSyntaxChecker,
  hasSyntaxGrammar,
  type GrammarLanguage,
  type SyntaxChecker,
  type SyntaxErrorMark,
  type SyntaxWasmSource,
  type WasmFile
} from './syntaxEngine'

export type SyntaxWorkerRequest = { id: number; language: string; code: string }
export type SyntaxWorkerResponse = { id: number; ok: true; markList: SyntaxErrorMark[] } | { id: number; ok: false }

// The part of a Worker the client uses (a fake one in unit tests).
export type SyntaxWorker = {
  postMessage: (request: SyntaxWorkerRequest) => void
  addEventListener: (type: 'message' | 'error' | 'messageerror', listener: (event: Event) => void) => void
}

function needsCheck(language: string, code: string) {
  return hasSyntaxGrammar(language) && code.length <= SYNTAX_LIMIT.contentMax && code.trim() !== ''
}

// A checker that sends each check to a worker made by `createWorker` (created on first need). A
// check rejects when the worker reports that the runtime or the grammar could not load, and every
// check rejects once the worker itself fails (its script did not load): no new worker is made for
// the rest of the session, as a failed grammar load is not retried either.
export function createWorkerChecker(createWorker: () => SyntaxWorker): SyntaxChecker {
  let worker: SyntaxWorker | null = null
  let broken = false
  let nextId = 0
  const pending = new Map<number, { resolve: (markList: SyntaxErrorMark[]) => void; reject: (error: unknown) => void }>()

  const fail = (error: unknown) => {
    broken = true
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }

  const start = (): SyntaxWorker => {
    const item = createWorker()
    item.addEventListener('message', (event) => {
      const response = (event as MessageEvent<SyntaxWorkerResponse>).data
      const request = pending.get(response.id)
      if (!request) return
      pending.delete(response.id)
      if (response.ok) request.resolve(response.markList)
      else request.reject(new Error('The syntax check could not load.'))
    })
    item.addEventListener('error', fail)
    item.addEventListener('messageerror', fail)
    return item
  }

  return (language, code) => {
    if (!needsCheck(language, code)) return Promise.resolve([])
    if (broken) return Promise.reject(new Error('The syntax check worker is not available.'))
    return new Promise<SyntaxErrorMark[]>((resolve, reject) => {
      try {
        worker ??= start()
      } catch (error) {
        broken = true
        reject(error)
        return
      }
      nextId += 1
      pending.set(nextId, { resolve, reject })
      worker.postMessage({ id: nextId, language, code })
    })
  }
}

// The app's checker: one worker per session, so the files load once.
export const checkSyntax: SyntaxChecker = createWorkerChecker(
  () => new Worker(new URL('./syntax.worker.ts', import.meta.url), { type: 'module', name: 'syntax-check' })
)
