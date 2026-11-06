// API shapes now live in src/models (DTO interfaces); these aliases keep every existing import
// of `../types` working. UI-only types stay defined here.
import type {
  ActivityPointDto,
  CategoryCountDto,
  DashboardStatDto,
  FindingCountDto,
  FindingDto,
  GeneratedTestFileDto,
  GithubAccountDto,
  GithubFileDto,
  GithubFileListDto,
  GithubRepoDto,
  GithubRepoListDto,
  ReviewSummaryDto,
  SavedReviewDto,
  SettingsDto,
  SeverityCountDto,
  SuggestionDto,
  SupportRequestDto,
  TestTypeId
} from '../models/dto'

export type {
  ActivityRange,
  EditorFontSize,
  ExplanationDetail,
  GithubImportDto,
  GithubImportFileDto,
  GithubSkippedFileDto,
  GithubSkipReason,
  HistoryDensity,
  IssueType,
  NotificationType,
  ReviewDto,
  ReviewFocus,
  ReviewStatus,
  ReviewStrictness,
  Severity,
  SupportPriority,
  TestConfigDto,
  TestFramework,
  TestTypeId,
  ThemeMode
} from '../models/dto'

export type Finding = FindingDto
export type FindingCount = FindingCountDto
export type Suggestion = SuggestionDto
export type GeneratedTestFile = GeneratedTestFileDto
export type ReviewSummary = ReviewSummaryDto
export type SavedReview = SavedReviewDto
export type DashboardStat = DashboardStatDto
export type SeverityCount = SeverityCountDto
export type CategoryCount = CategoryCountDto
export type ActivityPoint = ActivityPointDto
export type GithubAccount = GithubAccountDto
export type GithubRepo = GithubRepoDto
export type GithubFile = GithubFileDto
export type GithubRepoList = GithubRepoListDto
export type GithubFileList = GithubFileListDto
export type SettingsState = SettingsDto
export type SupportRequest = SupportRequestDto

export type ReviewTabId = 'summary' | 'findings' | 'suggestion' | 'generated_test'

export type TestType = {
  id: TestTypeId
  label: string
}

export type WizardStep = 'repo' | 'file'

export type SettingsSectionId = 'account' | 'security' | 'notifications' | 'appearance' | 'ai'

export type Account = {
  fullName: string
  email: string
  initials: string
  memberSince: string
}

export type HelpTopicId =
  | 'create-review'
  | 'view-results'
  | 'github'
  | 'account'
  | 'features'
  | 'common-issues'
  | 'error-messages'
  | 'contact'

export type HelpStep = { title: string; detail: string }

export type HelpGuide = {
  title: string
  subtitle: string
  step: HelpStep[]
  tip: string[]
}

export type HelpFeature = { title: string; detail: string }

export type HelpIssue = {
  id: string
  title: string
  summary: string
  whatHappened: string
  cause: string[]
  fix: string[]
}

export type ErrorEntry = { message: string; meaning: string; action: string }

export type SupportErrors = Partial<Record<keyof SupportRequest, string>>
