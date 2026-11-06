import { describe, expect, it } from 'vitest'
import { createStubAnalyzer } from '../src/analyzer/stub-analyzer.js'
import { formatTimeAgo } from '../src/lib/time-ago.js'

const input = { reviewId: 'abc', title: 'Payment API', language: 'TypeScript', content: '' }

describe('stub analyzer', () => {
  it('finds rule hits with their line numbers and scores the code', async () => {
    const content = [
      'const result = eval(input)',
      "const password = 'hunter2'",
      '// TODO: tidy',
      'x'.repeat(121)
    ].join('\n')

    const result = await createStubAnalyzer().analyze({ ...input, content })

    expect(result.finding.map((item) => [item.severity, item.line_start])).toEqual([
      ['critical', 1], ['high', 2], ['low', 3], ['low', 4]
    ])
    expect(result.findingCount).toEqual([
      { severity: 'critical', count: 1 }, { severity: 'high', count: 1 }, { severity: 'medium', count: 0 }, { severity: 'low', count: 2 }
    ])
    expect(result.finding.map((item) => item.category)).toEqual(['security', 'security', 'maintainability', 'readability'])
    expect(result.qualityScore).toBe(100 - 25 - 15 - 3 - 3)
    expect(result.suggestion).toHaveLength(4)
  })

  it('is deterministic and gives clean code a full score', async () => {
    const analyzer = createStubAnalyzer()
    const clean = { ...input, content: 'export const sum = (a: number, b: number) => a + b\n' }

    const first = await analyzer.analyze(clean)
    const second = await analyzer.analyze(clean)

    expect(first).toEqual(second)
    expect(first.qualityScore).toBe(100)
    expect(first.generatedTest[0]).toMatchObject({ sourceFile: 'payment-api.ts', testFile: 'payment-api.test.ts' })
  })

  it('caps findings at 50 and the score at 0', async () => {
    const result = await createStubAnalyzer().analyze({ ...input, content: 'eval(x)\n'.repeat(80) })

    expect(result.finding).toHaveLength(50)
    expect(result.qualityScore).toBe(0)
  })

  it('swaps code and altCode on regenerate, and back again', async () => {
    const analyzer = createStubAnalyzer()
    const file = { id: 't', sourceFile: 'a.ts', testFile: 'a.test.ts', language: 'TypeScript', code: 'one', altCode: 'two' }

    const once = await analyzer.regenerateTest([file])
    const twice = await analyzer.regenerateTest(once)

    expect(once[0]?.code).toBe('two')
    expect(twice[0]).toEqual(file)
  })
})

describe('formatTimeAgo', () => {
  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 minute ago'],
    [2 * 3_600_000, '2 hours ago'],
    [3 * 86_400_000, '3 days ago']
  ])('formats %d ms as %s', (elapsed, expected) => {
    expect(formatTimeAgo(0, elapsed)).toBe(expected)
  })
})
