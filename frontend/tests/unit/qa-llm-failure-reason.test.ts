import { describe, expect, it } from 'vitest'
import { FAILURE_TEXT } from '../../src/lib/review.constants'
import { failureReasonOf } from '../../src/models/review.model'

// QA adversarial pass, plan 039: malformed or hostile failureReason values never leak or crash.
describe('QA: failureReasonOf with hostile values', () => {
  const hostile: unknown[] = ['', 'AI_TIMEOUT', '__proto__', 'constructor', '<script>x</script>', 42, {}, [], 'x'.repeat(10000)]
  it.each(hostile.map((value) => [String(value).slice(0, 20), value]))('reads %s on a failed review as internal', (_label, value) => {
    const reason = failureReasonOf({ status: 'failed', failureReason: value as never })
    expect(reason).toBe('internal')
    expect(FAILURE_TEXT[reason as keyof typeof FAILURE_TEXT]).toBeTruthy()
  })
  it('is null for a non-failed review even with a reason set', () => {
    expect(failureReasonOf({ status: 'completed', failureReason: 'ai_timeout' })).toBeNull()
    expect(failureReasonOf(null)).toBeNull()
  })
})
