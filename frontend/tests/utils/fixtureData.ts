import dashboardJson from '../fixtures/dashboard.json'
import githubAccountJson from '../fixtures/github-account.json'
import githubFileContentJson from '../fixtures/github-file-content.json'
import githubJson from '../fixtures/github.json'
import githubImportJson from '../fixtures/github-import.json'
import reviewJson from '../fixtures/review.json'
import settingsJson from '../fixtures/settings.json'
import { isAccountDto } from '../../src/models/account.model'
import { isDashboardDto } from '../../src/models/dashboard.model'
import type { AccountDto, DashboardDto, GithubAccountDto, GithubFileDto, GithubImportDto, GithubRepoDto, ReviewDto, ReviewSummaryDto } from '../../src/models/dto'
import { isGithubAccountDto, isGithubFileDto, isGithubImportDto, isGithubRepoDto } from '../../src/models/github.model'
import { hasFields, isArrayOf, isNumber, isOptional, isRecord, isRecordOf, isString, type Guard } from '../../src/models/guard'
import { isReviewDto, isReviewSummaryDto, parseDto, REVIEW_STATUS } from '../../src/models/review.model'

// Test only (plan 035): the data in tests/fixtures/*.json, checked once with the model guards
// (never cast): imported JSON loses literal union types such as 'completed' or 'high'. Served by
// the fake backend (fixtureDataSource.ts) and read by tests as sample data.
// An error answer of the fake GitHub link import, in the standard error shape.
export interface GithubImportErrorData {
  status: number
  code: string
  message: string
  details?: Record<string, unknown>
}

const isGithubImportErrorData: Guard<GithubImportErrorData> = (value): value is GithubImportErrorData =>
  hasFields(value, { status: isNumber, code: isString, message: isString, details: isOptional(isRecord) })

export interface FixtureData {
  // The base of every listed review, and the results a review created in this session gets.
  reviewTemplate: ReviewDto
  reviewById: Record<string, ReviewDto>
  reviewSummaryList: ReviewSummaryDto[]
  dashboard: DashboardDto
  githubAccount: GithubAccountDto
  githubRepoList: GithubRepoDto[]
  githubFileListByRepo: Record<string, GithubFileDto[]>
  // File content by file id (wizard Import).
  githubFileContentById: Record<string, string>
  // POST /api/github/import (plan 023): the backend's fake GitHub links (backend/src/lib/github-fake.ts),
  // by link key (models/github.model.ts githubLinkKey), and the errors by link key or repository.
  githubImportByLink: Record<string, GithubImportDto>
  githubImportErrorByLink: Record<string, GithubImportErrorData>
  githubImportErrorByRepo: Record<string, GithubImportErrorData>
  account: AccountDto
  // The fixture account's current password (test data, never sent anywhere).
  password: string
}

function loadReview(): Pick<FixtureData, 'reviewTemplate' | 'reviewById'> {
  const reviewTemplate = parseDto({ ...reviewJson.template, generatedTest: reviewJson.generatedTestList }, isReviewDto)
  // Every listed review opens the template content with its own title, status, language and age.
  // A review that is unfinished, failed or cancelled has no results yet (as on the backend), so its
  // tabs show their placeholders.
  const reviewById = Object.fromEntries(
    Object.entries(reviewJson.reviewById).map(([id, item]) => {
      const base = { ...reviewTemplate, title: item.title, status: item.status, language: item.language, analyzedAgo: item.analyzedAgo }
      const result = item.status === REVIEW_STATUS.completed ? {} : { findingCount: [], finding: [], suggestion: [], generatedTest: [] }
      return [id, parseDto({ ...base, ...result }, isReviewDto)]
    })
  )
  return { reviewTemplate, reviewById }
}

export function loadFixtureData(): FixtureData {
  const { recentReviewList, ...dashboard } = dashboardJson
  return {
    ...loadReview(),
    reviewSummaryList: parseDto(recentReviewList, isArrayOf(isReviewSummaryDto)),
    dashboard: parseDto(dashboard, isDashboardDto),
    // Plan 030: the fixture GitHub account in the contract 0.9.0 shape (login, name).
    githubAccount: parseDto(githubAccountJson, isGithubAccountDto),
    githubRepoList: parseDto(githubJson.repoList, isArrayOf(isGithubRepoDto)),
    githubFileListByRepo: parseDto(githubJson.fileListByRepo, isRecordOf(isArrayOf(isGithubFileDto))),
    githubFileContentById: parseDto(githubFileContentJson, isRecordOf(isString)),
    githubImportByLink: parseDto(githubImportJson.importByLink, isRecordOf(isGithubImportDto)),
    githubImportErrorByLink: parseDto(githubImportJson.errorByLink, isRecordOf(isGithubImportErrorData)),
    githubImportErrorByRepo: parseDto(githubImportJson.errorByRepo, isRecordOf(isGithubImportErrorData)),
    // The seed has no photo, as in the backend (`avatarUrl` is null until one is uploaded).
    account: parseDto(
      {
        username: settingsJson.account.username,
        fullName: settingsJson.account.fullName,
        email: settingsJson.account.email,
        avatarUrl: null,
        memberSince: settingsJson.account.memberSince
      },
      isAccountDto
    ),
    password: parseDto(settingsJson.password, isString)
  }
}

export const fixtureData: FixtureData = loadFixtureData()
