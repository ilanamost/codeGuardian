// API shapes (DTOs): plain data exactly as the services send and receive it, documented in
// .orchestrate/api-contract.yaml. Redux state only ever holds these plain shapes; the domain
// classes in this folder are built from them at the service boundary or in selectors.

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'

export type ReviewStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export type CountedSeverity = Exclude<Severity, 'info'>

// Contract FindingCategory (0.5.0); the values are FINDING_CATEGORY in models/review.model.ts.
export type FindingCategory = 'security' | 'bug' | 'performance' | 'readability' | 'maintainability'

export interface FindingDto {
  id: string
  severity: Severity
  category: FindingCategory
  message: string
  detail: string
  line_start: number
}

export interface FindingCountDto {
  severity: CountedSeverity
  count: number
}

export interface SuggestionDto {
  id: string
  title: string
  detail: string
}

export interface GeneratedTestFileDto {
  id: string
  sourceFile: string
  testFile: string
  language: string
  repo?: string
  code: string
  altCode: string
}

// The test configuration of a review (contract 0.13.0, plan 034): the framework whose syntax the
// generated tests use and the kinds of tests generated. The backend always sends it; a review
// without one reads as DEFAULT_TEST_CONFIG (models/review.model.ts).
export type TestFramework = 'Jest' | 'Vitest' | 'Mocha'
export type TestTypeId = 'unit' | 'edge' | 'error'

export interface TestConfigDto {
  framework: TestFramework
  testTypeIdList: TestTypeId[]
}

export interface ReviewDto {
  title: string
  status: ReviewStatus
  language: string
  analyzedAgo: string
  qualityScore: number
  content: string
  findingCount: FindingCountDto[]
  finding: FindingDto[]
  suggestion: SuggestionDto[]
  generatedTest: GeneratedTestFileDto[]
  // Contract 0.13.0; optional so older payloads still parse.
  testConfig?: TestConfigDto
  // Contract 0.14.0: null unless the status is failed. Optional so older payloads still parse;
  // a value this client does not know reads as `internal` (see failureReasonOf).
  failureReason?: FailureReason | null
}

// Contract 0.14.0, FailureReason: why a review failed.
export type FailureReason =
  | 'ai_not_configured'
  | 'ai_unavailable'
  | 'ai_rate_limited'
  | 'ai_timeout'
  | 'ai_invalid_output'
  | 'ai_refused'
  | 'ai_quota_exceeded'
  | 'internal'

// Contract 0.14.0, GET /api/health `analyzer`: which analyzer reviews use.
export type AnalyzerKind = 'claude' | 'stub'

export interface ReviewSummaryDto {
  id: string
  title: string
  language: string
  timeAgo: string
  status: ReviewStatus
  high: number
  medium: number
  low: number
}

// The user's edits to one review (name, language, code).
export interface SavedReviewDto {
  name?: string
  language: string
  code: string
  savedAt: string
}

export interface SaveReviewDto {
  name?: string
  language: string
  code: string
}

export interface NewReviewDto {
  title?: string
  language: string
  content: string
}

// A review as one page needs it: the review plus the user's saved edits, if any.
export interface ReviewDetailDto {
  id: string
  review: ReviewDto
  saved: SavedReviewDto | null
  // The code and language the current findings belong to (contract 0.6.0). They differ from the
  // review's content and language once an edit is saved without a run.
  analyzedContent: string
  analyzedLanguage: string
}

export interface DashboardStatDto {
  id: 'total' | 'completed' | 'failed' | 'quality'
  label: string
  value: number
  suffix?: string
  trend: number
}

export interface SeverityCountDto {
  severity: CountedSeverity
  label: string
  count: number
}

export interface CategoryCountDto {
  id: FindingCategory
  label: string
  count: number
}

export interface ActivityPointDto {
  date: string
  count: number
}

export type ActivityRange = '7d' | '14d' | '30d'

export interface DashboardDto {
  statList: DashboardStatDto[]
  severityCountList: SeverityCountDto[]
  categoryCountList: CategoryCountDto[]
  activityByRange: Record<ActivityRange, ActivityPointDto[]>
}

// The connected GitHub user (contract 0.9.0, plan 030): no email and no avatar, so the UI shows
// the user name and initials. `name` is the GitHub display name, null when the user has none.
export interface GithubAccountDto {
  login: string
  name: string | null
}

// POST /api/github/connect body (0.9.0).
export interface GithubConnectDto {
  username: string
}

// `id` is the repository name (0.9.0), the repoId of the file routes.
export interface GithubRepoDto {
  id: string
  name: string
  description: string
}

// `id` is the base64url of the path (0.9.0).
export interface GithubFileDto {
  id: string
  path: string
  language: string
}

// The two wizard lists (0.9.0): `truncated` when GitHub has more than the first page (100
// repositories) or the repository more than 500 files.
export interface GithubRepoListDto {
  items: GithubRepoDto[]
  truncated: boolean
}

export interface GithubFileListDto {
  items: GithubFileDto[]
  truncated: boolean
}

// One file with its content (wizard Import).
export interface GithubFileContentDto extends GithubFileDto {
  content: string
}

// POST /api/github/import (contract 0.7.0, plan 023): a public file or pull-request link's code.
export type GithubSkipReason = 'removed' | 'renamed' | 'binary' | 'symlink' | 'submodule' | 'folder' | 'unsupported_type' | 'invalid_path'

export interface GithubImportFileDto {
  path: string
  language: string
  // Characters of the file text.
  size: number
}

export interface GithubSkippedFileDto {
  path: string
  reason: GithubSkipReason
}

export interface GithubImportDto {
  // The file name for a file link, `<owner>/<repo>#<number>` for a pull request.
  name: string
  language: string
  // A pull request's files joined into one text, each after a header comment line.
  content: string
  fileList: GithubImportFileDto[]
  skippedList: GithubSkippedFileDto[]
  // Contract 0.13.0 (plan 034): each imported file's own code, in fileList order. Optional: a
  // client that gets none uses `content`.
  fileContentList?: GithubImportFileContentDto[]
}

export interface GithubImportFileContentDto {
  path: string
  language: string
  content: string
}

// Contract 0.15.0 (plan 040): how an account signs in. `github` has no password.
export type SignInMethod = 'password' | 'github' | 'both'

// The signed-in account's profile (Settings Account panel, the sidebar, Contact Support email).
export interface AccountDto {
  // The sign-in name (contract 0.8.0).
  username: string
  fullName: string
  email: string
  // The profile photo: a relative API path (`/api/account/avatar?v=<digest prefix>`); null when
  // there is none and the UI shows initials.
  avatarUrl: string | null
  memberSince: string
  // Contract 0.15.0: how the account signs in (a missing value reads as `password`), and the
  // linked GitHub login (null or missing: no link).
  signInMethod?: SignInMethod
  githubLogin?: string | null
}

// POST /api/session (contract 0.8.0).
export interface SignInDto {
  username: string
  password: string
}

// POST /api/account, registration (contract 0.8.0). Confirm password is never sent.
export interface RegistrationDto {
  username: string
  email: string
  password: string
}

// GET /api/session, session restore (contract 0.8.0).
export interface SessionDto {
  account: AccountDto
  expiresAt: string
}

// PUT /api/account (contract 0.13.0, plan 034): at least one of username and email, and the
// current password, which is required.
export interface AccountUpdateDto {
  username?: string
  email?: string
  currentPassword: string
}

export interface PasswordChangeDto {
  currentPassword: string
  newPassword: string
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type EditorFontSize = 'small' | 'medium' | 'large'
export type HistoryDensity = 'comfortable' | 'compact'
export type ReviewFocus = 'all' | 'bugs' | 'security' | 'performance' | 'readability'
export type ReviewStrictness = 'high_confidence' | 'balanced' | 'comprehensive'
export type ExplanationDetail = 'concise' | 'detailed'

export type NotificationType = 'reviewCompleted' | 'reviewFailed' | 'criticalFinding' | 'email'

export type NotificationPreference = Record<NotificationType, boolean>

export interface SettingsDto {
  notification: NotificationPreference
  theme: ThemeMode
  editorFontSize: EditorFontSize
  historyDensity: HistoryDensity
  reviewFocus: ReviewFocus
  strictness: ReviewStrictness
  explanation: ExplanationDetail
  generatedTest: boolean
  language: string
}

export type IssueType = 'review_failed' | 'upload' | 'github' | 'account' | 'other'
export type SupportPriority = 'low' | 'normal' | 'high'

export interface SupportRequestDto {
  issueType: IssueType | ''
  email: string
  reviewId: string
  priority: SupportPriority
  description: string
}

// Contract 0.11.0: the stored request's ticket (SUP-NNNN). No email is sent by the app.
export interface SupportTicketDto {
  ticket: string
}

// Standard error body from .rule/error-handling-rules.md.
export interface ApiErrorDto {
  error: { code: string; message: string; details?: unknown }
  requestId?: string
}
