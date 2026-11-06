import { describe, expect, it } from 'vitest'
import { ignoreMonacoCancel, isMonacoCancel, MONACO_CANCELED } from '../../src/lib/ignoreMonacoCancel'

function monacoCancel() {
  const error = new Error(MONACO_CANCELED)
  error.name = MONACO_CANCELED
  return error
}

function dispatchRejection(reason: unknown) {
  const event = new Event('unhandledrejection', { cancelable: true }) as Event & { reason: unknown }
  Object.defineProperty(event, 'reason', { value: reason })
  window.dispatchEvent(event)
  return event
}

describe('ignoreMonacoCancel', () => {
  it('recognises only Monaco\'s own cancellation error', () => {
    expect(isMonacoCancel(monacoCancel())).toBe(true)
    expect(isMonacoCancel(new Error(MONACO_CANCELED))).toBe(false)
    expect(isMonacoCancel(new Error('Something else'))).toBe(false)
    expect(isMonacoCancel(MONACO_CANCELED)).toBe(false)
    expect(isMonacoCancel(undefined)).toBe(false)
  })

  it('silences the Monaco cancellation and leaves every other rejection alone', () => {
    ignoreMonacoCancel(window)

    expect(dispatchRejection(monacoCancel()).defaultPrevented).toBe(true)
    expect(dispatchRejection(new Error('real failure')).defaultPrevented).toBe(false)
  })
})
