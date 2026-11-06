import type { AnalyzerKind } from '../utils/domain.js'
import type { Finding, FindingCount, GeneratedTestFile, Settings, Suggestion, TestConfig } from '../model/dto.js'

// The narrow interface between the review service and whatever analyzes code. Plan 018 ships
// a deterministic, rule-based stub (`stub-analyzer.ts`); plan 039 adds the Claude analyzer
// (`claude-analyzer.ts`), chosen at start by `create-analyzer.ts`, without changing routes.

// The account's saved AI preferences, read when the analysis starts (plan 028, Scope 19).
export type AnalyzerPreference = Pick<Settings, 'reviewFocus' | 'strictness' | 'explanation' | 'generatedTest'>

export type AnalyzerInput = {
  reviewId: string
  // The org of the review, for the log line only (plan 039).
  orgId?: string
  title: string
  language: string
  content: string
  // Optional so an analyzer called without preferences gives the default output.
  preference?: AnalyzerPreference
  // The review's stored test configuration (plan 034). Absent for a review that has none: the
  // generated tests are then the original output.
  testConfig?: TestConfig
}

export type AnalyzerResult = {
  qualityScore: number
  findingCount: FindingCount[]
  finding: Finding[]
  suggestion: Suggestion[]
  generatedTest: GeneratedTestFile[]
}

// What `regenerateTest` needs besides the files (plan 039): the code the tests are for, and the
// ids for the log line.
export type RegenerateContext = {
  reviewId?: string
  orgId?: string
  title?: string
  language?: string
  // The analyzed code of the review.
  content: string
}

export interface Analyzer {
  // `claude` costs money and is rate limited by the review service (quota, concurrency);
  // absent means the stub. Reported by GET /api/health.
  readonly kind?: `${AnalyzerKind}`
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>
  // A new variant of each generated test file, for the "Regenerate" button. With a test
  // configuration (plan 034) the files use that framework's syntax and only the chosen kinds of
  // tests; without one the result is the original variant swap.
  regenerateTest(fileList: GeneratedTestFile[], testConfig?: TestConfig, context?: RegenerateContext): Promise<GeneratedTestFile[]>
}
