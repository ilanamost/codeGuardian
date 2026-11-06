import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyntaxErrorMark } from '../../src/lib/syntaxCheck'
import { createOnce, scheduleSyntaxCheck, type SyntaxScheduleOption } from '../../src/lib/syntaxSchedule'

// Plan 032: the syntax check's debounce and the drop of results for older code.
const mark: SyntaxErrorMark = { startLine: 1, startColumn: 5, endLine: 1, endColumn: 6, message: 'Unexpected `)`' }

type Model = { code: string; version: number }

function setup(model: Model, check: SyntaxScheduleOption['check'] = vi.fn(async () => [mark])) {
  const apply = vi.fn()
  const fail = vi.fn()
  const option: SyntaxScheduleOption = {
    delayMs: 400,
    read: () => ({ language: 'Python', code: model.code, version: model.version }),
    check,
    isCurrent: (version) => version === model.version,
    apply,
    fail
  }
  return { option, apply, fail, check }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleSyntaxCheck', () => {
  it('checks the code once the delay has passed and applies the result', async () => {
    const { option, apply, check } = setup({ code: 'x = )', version: 1 })
    scheduleSyntaxCheck(option)
    await vi.advanceTimersByTimeAsync(399)
    expect(check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledWith('Python', 'x = )')
    expect(apply).toHaveBeenCalledWith([mark])
  })

  it('applies an empty list for valid code, so old markers go', async () => {
    const { option, apply } = setup({ code: 'x = 1', version: 1 }, vi.fn(async () => []))
    scheduleSyntaxCheck(option)
    await vi.advanceTimersByTimeAsync(400)
    expect(apply).toHaveBeenCalledWith([])
  })

  it('never checks while each change cancels the wait (typing faster than the delay)', async () => {
    const model = { code: 'x', version: 1 }
    const { option, check, apply } = setup(model)
    let cancel = scheduleSyntaxCheck(option)
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(300)
      cancel()
      model.code += ')'
      model.version += 1
      cancel = scheduleSyntaxCheck(option)
    }
    expect(check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('Python', 'x)))))')
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('drops a result when the code changed while the check ran', async () => {
    const model = { code: 'x = )', version: 1 }
    let finish: (value: SyntaxErrorMark[]) => void = () => {}
    const { option, apply } = setup(model, () => new Promise((resolve) => (finish = resolve)))
    scheduleSyntaxCheck(option)
    await vi.advanceTimersByTimeAsync(400)
    model.version = 2
    finish([mark])
    await vi.advanceTimersByTimeAsync(0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('drops a result when the wait was cancelled after the check started', async () => {
    let finish: (value: SyntaxErrorMark[]) => void = () => {}
    const { option, apply } = setup({ code: 'x = )', version: 1 }, () => new Promise((resolve) => (finish = resolve)))
    const cancel = scheduleSyntaxCheck(option)
    await vi.advanceTimersByTimeAsync(400)
    cancel()
    finish([mark])
    await vi.advanceTimersByTimeAsync(0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('reports a checker failure and applies nothing', async () => {
    const error = new Error('wasm blocked')
    const { option, apply, fail } = setup({ code: 'x = )', version: 1 }, vi.fn(async () => Promise.reject(error)))
    scheduleSyntaxCheck(option)
    await vi.advanceTimersByTimeAsync(400)
    expect(fail).toHaveBeenCalledWith(error)
    expect(apply).not.toHaveBeenCalled()
  })

  it('does nothing when there is no code to read any more', async () => {
    const { option, check } = setup({ code: 'x', version: 1 })
    scheduleSyntaxCheck({ ...option, read: () => null })
    await vi.advanceTimersByTimeAsync(400)
    expect(check).not.toHaveBeenCalled()
  })
})

describe('createOnce', () => {
  it('is true the first time only', () => {
    const once = createOnce()
    expect([once(), once(), once()]).toEqual([true, false, false])
  })
})
