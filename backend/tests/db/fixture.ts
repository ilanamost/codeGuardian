import type { AnalyzerResult } from '../../src/analyzer/analyzer.js'
import type { CountedSeverity, Finding, Review, TestConfig } from '../../src/model/dto.js'
import type { ReviewRecord } from '../../src/store/store.js'

export const fixedNow = Date.parse('2026-10-22T10:00:00.000Z')
export const msPerDay = 86_400_000
export const frontendUrl = 'http://localhost:5173'

const countedSeverityList: CountedSeverity[] = ['critical', 'high', 'medium', 'low']

// Finding counts consistent with the findings, as the analyzer produces them.
export function findingCountOf(findingList: Finding[]) {
  return countedSeverityList.map((severity) => ({ severity, count: findingList.filter((finding) => finding.severity === severity).length }))
}

export function analyzerResult(override: Partial<AnalyzerResult> = {}): AnalyzerResult {
  const finding: Finding[] = override.finding ?? [
    { id: 'f1', severity: 'critical', category: 'security', message: 'Injection', detail: 'Line 1', line_start: 1 },
    { id: 'f2', severity: 'high', category: 'bug', message: 'No error check', detail: 'Line 2', line_start: 2 },
    { id: 'f3', severity: 'medium', category: 'maintainability', message: 'Untyped', detail: 'Line 3', line_start: 3 },
    { id: 'f4', severity: 'info', category: 'readability', message: 'Note', detail: 'Line 4', line_start: 4 }
  ]
  return {
    qualityScore: 72,
    findingCount: findingCountOf(finding),
    finding,
    suggestion: [{ id: 's1', title: 'Type the value', detail: 'Replace any' }],
    generatedTest: [
      { id: 't1', sourceFile: 'a.ts', testFile: 'a.test.ts', language: 'TypeScript', code: 'first a', altCode: 'second a' },
      { id: 't2', sourceFile: 'b.ts', testFile: 'b.test.ts', language: 'TypeScript', repo: 'acme/web', code: 'first b', altCode: 'second b' }
    ],
    ...override
  }
}

// A record as the services create it; `completed` fills it with an analyzer result.
export function reviewRecord(id: string, option: { createdAt?: number, status?: Review['status'], result?: AnalyzerResult, title?: string, content?: string, testConfig?: TestConfig | null } = {}): ReviewRecord {
  const createdAt = option.createdAt ?? fixedNow
  const status = option.status ?? 'completed'
  const result = status === 'completed' ? option.result ?? analyzerResult() : undefined
  return {
    id,
    createdAt,
    analyzedAt: createdAt,
    run: 0,
    saved: null,
    deleted: false,
    // Plan 034: none unless a test gives one (null is what the store reads back).
    testConfig: option.testConfig ?? null,
    review: {
      title: option.title ?? `Review ${id}`,
      status,
      language: 'TypeScript',
      analyzedAgo: 'just now',
      qualityScore: result?.qualityScore ?? 0,
      content: option.content ?? `const ${id.replaceAll('-', '_')} = 1\n`,
      findingCount: result?.findingCount ?? [],
      finding: result?.finding ?? [],
      suggestion: result?.suggestion ?? [],
      generatedTest: result?.generatedTest ?? []
    }
  }
}
