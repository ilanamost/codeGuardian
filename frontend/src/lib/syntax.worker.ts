import { createSyntaxChecker } from './syntaxEngine'
import type { SyntaxWorkerRequest, SyntaxWorkerResponse } from './syntaxCheck'

// Plan 032, QA F1: the syntax check's Web Worker. It loads the tree-sitter runtime and a grammar
// from the app's origin the first time that language is checked (cached in the worker), parses
// the code off the main thread and posts the marks back. Requests are answered in order.
type WorkerScope = {
  onmessage: ((event: MessageEvent<SyntaxWorkerRequest>) => void) | null
  postMessage: (response: SyntaxWorkerResponse) => void
}

const check = createSyntaxChecker()
const scope = self as unknown as WorkerScope

scope.onmessage = async (event) => {
  const { id, language, code } = event.data
  let response: SyntaxWorkerResponse
  try {
    response = { id, ok: true, markList: await check(language, code) }
  } catch {
    response = { id, ok: false }
  }
  scope.postMessage(response)
}
