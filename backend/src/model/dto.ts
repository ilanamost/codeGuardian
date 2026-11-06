// Response and storage shapes from `.orchestrate/api-contract.yaml` (0.8.0). They mirror the
// frontend DTOs (camelCase, except Finding.line_start). Request bodies are typed by the zod
// schemas in `src/schema/`.

import type {
  ActivityRange, EditorFontSize, Explanation, FindingCategory as FindingCategoryValue, HistoryDensity, ImportLanguage, ReviewFocus, ReviewStatus as ReviewStatusValue, SignInMethod,
  FailureReason as FailureReasonValue, Severity as SeverityValue, SkipReason, StatId, Strictness, TestFramework, TestType, Theme
} from '../utils/domain.js'

// Each union is the string values of its enum in `utils/domain.ts`, so plain strings from the
// seed JSON and the enum members are both accepted.
export type Severity = `${SeverityValue}`
export type CountedSeverity = Exclude<Severity, `${SeverityValue.Info}`>
export type ReviewStatus = `${ReviewStatusValue}`
export type FindingCategory = `${FindingCategoryValue}`
export type FailureReason = `${FailureReasonValue}`

export type Finding = {
  id: string
  severity: Severity
  category: FindingCategory
  message: string
  detail: string
  line_start: number
}
export type FindingCount = { severity: CountedSeverity, count: number }
export type Suggestion = { id: string, title: string, detail: string }

export type GeneratedTestFile = {
  id: string
  sourceFile: string
  testFile: string
  language: string
  repo?: string
  code: string
  altCode: string
}

export type Review = {
  title: string
  status: ReviewStatus
  language: string
  analyzedAgo: string
  qualityScore: number
  content: string
  findingCount: FindingCount[]
  finding: Finding[]
  suggestion: Suggestion[]
  generatedTest: GeneratedTestFile[]
}

// The test configuration of a review (contract 0.13.0, plan 034). A review without one reads
// as `TEST_CONFIG_DEFAULT` (utils/constants.ts).
export type TestConfig = { framework: `${TestFramework}`, testTypeIdList: `${TestType}`[] }

// Every review the API returns carries its test configuration (0.13.0).
export type ReviewWithConfig = Review & { testConfig: TestConfig }
  & { failureReason: FailureReason | null }

export type ReviewWithSavedAt = ReviewWithConfig & { savedAt: string | null }

// GET /api/review/{id} (contract 0.6.0): the code and language the current findings belong to.
export type AnalyzedReview = ReviewWithSavedAt & { analyzedContent: string, analyzedLanguage: string }

export type ReviewSummary = {
  id: string
  title: string
  language: string
  timeAgo: string
  status: ReviewStatus
  high: number
  medium: number
  low: number
}

export type SavedReview = { name?: string, language: string, code: string, savedAt: string }

export type Dashboard = {
  statList: { id: `${StatId}`, label: string, value: number, suffix?: string, trend: number }[]
  severityCountList: { severity: CountedSeverity, label: string, count: number }[]
  categoryCountList: { id: FindingCategory, label: string, count: number }[]
  activityByRange: Record<`${ActivityRange}`, { date: string, count: number }[]>
}

// The wizard (contract 0.9.0, plan 030): the connected public GitHub user and its repositories.
export type GithubAccount = { login: string, name: string | null }
// `id` is the repository name.
export type GithubRepo = { id: string, name: string, description: string }
export type GithubRepoList = { items: GithubRepo[], truncated: boolean }
// `id` is the base64url of the path.
export type GithubFile = { id: string, path: string, language: `${ImportLanguage}` }
export type GithubFileList = { items: GithubFile[], truncated: boolean }
export type GithubFileContent = GithubFile & { content: string }

// POST /api/github/import (contract 0.7.0, plan 023).
export type GithubImportFile = { path: string, language: `${ImportLanguage}`, size: number }
export type GithubSkippedFile = { path: string, reason: `${SkipReason}` }
// The code of one imported file, unchanged (contract 0.13.0, plan 034).
export type GithubImportFileContent = { path: string, language: `${ImportLanguage}`, content: string }
export type GithubImport = {
  name: string
  language: `${ImportLanguage}`
  content: string
  fileList: GithubImportFile[]
  skippedList: GithubSkippedFile[]
  fileContentList: GithubImportFileContent[]
}

export type Settings = {
  notification: { reviewCompleted: boolean, reviewFailed: boolean, criticalFinding: boolean, email: boolean }
  theme: `${Theme}`
  editorFontSize: `${EditorFontSize}`
  historyDensity: `${HistoryDensity}`
  reviewFocus: `${ReviewFocus}`
  strictness: `${Strictness}`
  explanation: `${Explanation}`
  generatedTest: boolean
  language: string
}

// `avatarUrl` is a relative API path (`/api/account/avatar?v=<digest prefix>`) or null (0.8.0).
// `signInMethod` and `githubLogin` (contract 0.15.0, plan 040) are always sent: `github` has no password.
export type Account = {
  username: string
  fullName: string
  email: string
  avatarUrl: string | null
  memberSince: string
  signInMethod: `${SignInMethod}`
  githubLogin: string | null
}

// GET /api/session (contract 0.8.0).
export type Session = { account: Account, expiresAt: string }
