import type { SyntaxChecker, SyntaxErrorMark } from './syntaxCheck'

// Plan 032: when the editor's syntax check runs, and which result it keeps. The check starts
// `delayMs` after the last change (each change cancels the wait), reads the code at that moment,
// and its result is applied only when the code has not changed since (`isCurrent`) and the wait
// was not cancelled: a result for an older version of the code is dropped.

export type SyntaxSnapshot = { language: string; code: string; version: number }

export type SyntaxScheduleOption = {
  delayMs: number
  // The code to check, read when the wait ends; null when there is nothing to check any more.
  read: () => SyntaxSnapshot | null
  check: SyntaxChecker
  isCurrent: (version: number) => boolean
  apply: (markList: SyntaxErrorMark[]) => void
  fail: (error: unknown) => void
}

// Starts one wait; the returned function cancels it, and drops the result of a check under way.
export function scheduleSyntaxCheck(option: SyntaxScheduleOption): () => void {
  let active = true
  const timer = setTimeout(() => {
    const snapshot = option.read()
    if (!snapshot) return
    option.check(snapshot.language, snapshot.code).then(
      (markList) => {
        if (active && option.isCurrent(snapshot.version)) option.apply(markList)
      },
      (error: unknown) => {
        if (active) option.fail(error)
      }
    )
  }, option.delayMs)
  return () => {
    active = false
    clearTimeout(timer)
  }
}

// True the first time only: the "syntax check unavailable" toast shows once per session.
export function createOnce(): () => boolean {
  let done = false
  return () => {
    if (done) return false
    done = true
    return true
  }
}

export const syntaxFailureOnce = createOnce()
