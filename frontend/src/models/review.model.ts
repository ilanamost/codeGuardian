import { ERROR_CODE } from '../utils/error-messages'
import { AppError } from './app-error'
import type {
  AnalyzerKind,
  CountedSeverity,
  FailureReason,
  FindingCategory,
  FindingCountDto,
  FindingDto,
  GeneratedTestFileDto,
  ReviewDto,
  ReviewStatus,
  ReviewSummaryDto,
  SavedReviewDto,
  Severity,
  SuggestionDto,
  TestConfigDto,
  TestFramework,
  TestTypeId
} from './dto'
import { hasFields, isArrayOf, isNumber, isOneOf, isOptional, isRecord, isString, type Guard } from './guard'

export const severityList: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical']
export const reviewStatusList: readonly ReviewStatus[] = ['pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled']
export const reviewNameMaxLength = 80

// Every finding category by name (contract FindingCategory), in the contract's order.
export const FINDING_CATEGORY = {
  security: 'security',
  bug: 'bug',
  performance: 'performance',
  readability: 'readability',
  maintainability: 'maintainability'
} as const satisfies Record<string, FindingCategory>

export const findingCategoryList: readonly FindingCategory[] = Object.values(FINDING_CATEGORY)

// The severities the dashboard counts, always all four (contract Dashboard.severityCountList).
export const countedSeverityList: readonly CountedSeverity[] = ['critical', 'high', 'medium', 'low']

// Every review status by name, so code never spells a status literal.
export const REVIEW_STATUS = {
  pending: 'pending',
  queued: 'queued',
  inProgress: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled'
} as const satisfies Record<string, ReviewStatus>

// The analysis is still running: the Review page keeps fetching the review.
export const unfinishedStatusList: readonly ReviewStatus[] = [REVIEW_STATUS.pending, REVIEW_STATUS.queued, REVIEW_STATUS.inProgress]

const isSeverity = isOneOf(severityList)
const isStatus = isOneOf(reviewStatusList)

export const isFindingDto: Guard<FindingDto> = (value): value is FindingDto =>
  hasFields(value, {
    id: isString,
    severity: isSeverity,
    category: isOneOf(findingCategoryList),
    message: isString,
    detail: isString,
    line_start: isNumber
  })

const isFindingCountDto: Guard<FindingCountDto> = (value): value is FindingCountDto =>
  hasFields(value, { severity: isSeverity, count: isNumber }) && value.severity !== 'info'

export const isSuggestionDto: Guard<SuggestionDto> = (value): value is SuggestionDto =>
  hasFields(value, { id: isString, title: isString, detail: isString })

export const isGeneratedTestFileDto: Guard<GeneratedTestFileDto> = (value): value is GeneratedTestFileDto =>
  hasFields(value, {
    id: isString,
    sourceFile: isString,
    testFile: isString,
    language: isString,
    repo: isOptional(isString),
    code: isString,
    altCode: isString
  })

// The test configuration (contract 0.13.0, TestConfig): the frameworks and test kinds in the
// contract's order, and the default a review without a stored one reads as.
export const testFrameworkList: readonly TestFramework[] = ['Jest', 'Vitest', 'Mocha']
export const testTypeIdList: readonly TestTypeId[] = ['unit', 'edge', 'error']

export const DEFAULT_TEST_CONFIG: TestConfigDto = { framework: 'Jest', testTypeIdList: [...testTypeIdList] }

const isTestTypeId = isOneOf(testTypeIdList)

// One to three distinct kinds, as the contract's TestConfig.
export const isTestConfigDto: Guard<TestConfigDto> = (value): value is TestConfigDto =>
  hasFields(value, { framework: isOneOf(testFrameworkList), testTypeIdList: isArrayOf(isTestTypeId) }) &&
  Object.keys(value).length === 2 &&
  (value.testTypeIdList as unknown[]).length > 0 &&
  new Set(value.testTypeIdList as unknown[]).size === (value.testTypeIdList as unknown[]).length

// The kinds in the contract's order, whatever order they were picked in.
export function orderedTestTypeIdList(list: readonly TestTypeId[]): TestTypeId[] {
  return testTypeIdList.filter((id) => list.includes(id))
}

// The review's stored configuration (the same object, so a selector keeps its reference), or the
// default for a review that has none.
export function testConfigOf(review: Pick<ReviewDto, 'testConfig'> | null | undefined): TestConfigDto {
  return review?.testConfig ?? DEFAULT_TEST_CONFIG
}

// Contract 0.14.0: why a review failed, in the contract's order.
export const failureReasonList: readonly FailureReason[] = [
  'ai_not_configured',
  'ai_unavailable',
  'ai_rate_limited',
  'ai_timeout',
  'ai_invalid_output',
  'ai_refused',
  'ai_quota_exceeded',
  'internal'
]

export const isFailureReason = isOneOf(failureReasonList)

// GET /api/health `analyzer`; a client that gets no (or an unknown) value reads it as `stub`.
export const analyzerKindList: readonly AnalyzerKind[] = ['claude', 'stub']

export function analyzerKindOf(value: unknown): AnalyzerKind {
  return isRecord(value) && value.analyzer === 'claude' ? 'claude' : 'stub'
}

// The reason a failed review shows: its own, or `internal` when the payload has none or one this
// client does not know. Null for a review that did not fail.
export function failureReasonOf(review: Pick<ReviewDto, 'status' | 'failureReason'> | null | undefined): FailureReason | null {
  if (review?.status !== 'failed') return null
  return isFailureReason(review.failureReason) ? review.failureReason : 'internal'
}

// null, or any string (an unknown reason is read as `internal`, not rejected).
const isNullableString: Guard<string | null> = (value): value is string | null => value === null || isString(value)

export const isReviewDto: Guard<ReviewDto> = (value): value is ReviewDto =>
  hasFields(value, {
    title: isString,
    status: isStatus,
    language: isString,
    analyzedAgo: isString,
    qualityScore: isNumber,
    content: isString,
    findingCount: isArrayOf(isFindingCountDto),
    finding: isArrayOf(isFindingDto),
    suggestion: isArrayOf(isSuggestionDto),
    generatedTest: isArrayOf(isGeneratedTestFileDto),
    testConfig: isOptional(isTestConfigDto),
    failureReason: isOptional(isNullableString)
  })

export const isReviewSummaryDto: Guard<ReviewSummaryDto> = (value): value is ReviewSummaryDto =>
  hasFields(value, {
    id: isString,
    title: isString,
    language: isString,
    timeAgo: isString,
    status: isStatus,
    high: isNumber,
    medium: isNumber,
    low: isNumber
  })

// `savedAt` is required (contract SavedReview). An older stored record without it fails this
// guard, so that review is treated as not saved instead of crashing.
export const isSavedReviewDto: Guard<SavedReviewDto> = (value): value is SavedReviewDto =>
  isRecord(value) && isString(value.language) && isString(value.code) && isOptional(isString)(value.name) && isString(value.savedAt)

// Throws a parse AppError so a malformed payload never reaches the store.
export function parseDto<T>(value: unknown, guard: Guard<T>): T {
  if (!guard(value)) throw new AppError({ code: ERROR_CODE.parse, kind: 'parse', message: 'Malformed payload' })
  return value
}

// Returns the trimmed name, or undefined when it is empty or longer than the limit.
export function normalizeReviewName(value: string): string | undefined {
  const name = value.trim()
  return name.length >= 1 && name.length <= reviewNameMaxLength ? name : undefined
}

export class Finding {
  readonly id: string
  readonly severity: Severity
  readonly category: FindingCategory
  readonly message: string
  readonly detail: string
  readonly lineStart: number

  constructor(dto: FindingDto) {
    this.id = dto.id
    this.severity = dto.severity
    this.category = dto.category
    this.message = dto.message
    this.detail = dto.detail
    this.lineStart = dto.line_start
  }

  get isCritical(): boolean {
    return this.severity === 'critical'
  }

  toDto(): FindingDto {
    return { id: this.id, severity: this.severity, category: this.category, message: this.message, detail: this.detail, line_start: this.lineStart }
  }
}

export class Suggestion {
  readonly id: string
  readonly title: string
  readonly detail: string

  constructor(dto: SuggestionDto) {
    this.id = dto.id
    this.title = dto.title
    this.detail = dto.detail
  }

  toDto(): SuggestionDto {
    return { id: this.id, title: this.title, detail: this.detail }
  }
}

export class GeneratedTestFile {
  readonly id: string
  readonly sourceFile: string
  readonly testFile: string
  readonly language: string
  readonly repo?: string
  readonly code: string
  readonly altCode: string

  constructor(dto: GeneratedTestFileDto) {
    this.id = dto.id
    this.sourceFile = dto.sourceFile
    this.testFile = dto.testFile
    this.language = dto.language
    this.repo = dto.repo
    this.code = dto.code
    this.altCode = dto.altCode
  }

  // The source of the original or the regenerated variant.
  codeFor(regenerated: boolean): string {
    return regenerated ? this.altCode : this.code
  }

  toDto(): GeneratedTestFileDto {
    const dto: GeneratedTestFileDto = {
      id: this.id,
      sourceFile: this.sourceFile,
      testFile: this.testFile,
      language: this.language,
      code: this.code,
      altCode: this.altCode
    }
    if (this.repo !== undefined) dto.repo = this.repo
    return dto
  }
}

export class ReviewSummary {
  readonly id: string
  readonly title: string
  readonly language: string
  readonly timeAgo: string
  readonly status: ReviewStatus
  readonly high: number
  readonly medium: number
  readonly low: number

  constructor(dto: ReviewSummaryDto) {
    this.id = dto.id
    this.title = dto.title
    this.language = dto.language
    this.timeAgo = dto.timeAgo
    this.status = dto.status
    this.high = dto.high
    this.medium = dto.medium
    this.low = dto.low
  }

  static fromDto(value: unknown): ReviewSummary {
    return new ReviewSummary(parseDto(value, isReviewSummaryDto))
  }

  get findingTotal(): number {
    return this.high + this.medium + this.low
  }

  // A saved name replaces the title in lists.
  withName(name: string | undefined): ReviewSummary {
    return name ? new ReviewSummary({ ...this.toDto(), title: name }) : this
  }

  toDto(): ReviewSummaryDto {
    return {
      id: this.id,
      title: this.title,
      language: this.language,
      timeAgo: this.timeAgo,
      status: this.status,
      high: this.high,
      medium: this.medium,
      low: this.low
    }
  }
}

export class Review {
  readonly title: string
  readonly status: ReviewStatus
  readonly language: string
  readonly analyzedAgo: string
  readonly qualityScore: number
  readonly content: string
  readonly findingCount: FindingCountDto[]
  readonly finding: Finding[]
  readonly suggestion: Suggestion[]
  readonly generatedTest: GeneratedTestFile[]
  // Contract 0.13.0: always set (the default when the payload has none).
  readonly testConfig: TestConfigDto
  private readonly hasStoredTestConfig: boolean
  // Contract 0.14.0: as sent (undefined when the payload had none), so toDto keeps its shape.
  private readonly storedFailureReason: ReviewDto['failureReason']

  constructor(dto: ReviewDto) {
    this.title = dto.title
    this.status = dto.status
    this.language = dto.language
    this.analyzedAgo = dto.analyzedAgo
    this.qualityScore = dto.qualityScore
    this.content = dto.content
    this.findingCount = dto.findingCount.map((item) => ({ ...item }))
    this.finding = dto.finding.map((item) => new Finding(item))
    this.suggestion = dto.suggestion.map((item) => new Suggestion(item))
    this.generatedTest = dto.generatedTest.map((item) => new GeneratedTestFile(item))
    this.hasStoredTestConfig = dto.testConfig !== undefined
    this.storedFailureReason = dto.failureReason
    const testConfig = testConfigOf(dto)
    this.testConfig = { framework: testConfig.framework, testTypeIdList: [...testConfig.testTypeIdList] }
  }

  // Validates an unknown payload (API or storage) and builds the class.
  static fromDto(value: unknown): Review {
    return new Review(parseDto(value, isReviewDto))
  }

  // Why this review failed; null unless it did.
  get failureReason(): FailureReason | null {
    return failureReasonOf({ status: this.status, failureReason: this.storedFailureReason })
  }

  countOf(severity: CountedSeverity): number {
    return this.findingCount.find((item) => item.severity === severity)?.count ?? 0
  }

  get findingTotal(): number {
    return this.findingCount.reduce((total, item) => total + item.count, 0)
  }

  get hasCriticalFinding(): boolean {
    return this.countOf('critical') > 0 || this.finding.some((item) => item.isCritical)
  }

  get isFinished(): boolean {
    return !unfinishedStatusList.includes(this.status)
  }

  toSummary(id: string, timeAgo = this.analyzedAgo): ReviewSummary {
    return new ReviewSummary({
      id,
      title: this.title,
      language: this.language,
      timeAgo,
      status: this.status,
      // Critical is folded into high, as on the severity dots.
      high: this.countOf('critical') + this.countOf('high'),
      medium: this.countOf('medium'),
      low: this.countOf('low')
    })
  }

  toDto(): ReviewDto {
    return {
      title: this.title,
      status: this.status,
      language: this.language,
      analyzedAgo: this.analyzedAgo,
      qualityScore: this.qualityScore,
      content: this.content,
      findingCount: this.findingCount.map((item) => ({ ...item })),
      finding: this.finding.map((item) => item.toDto()),
      suggestion: this.suggestion.map((item) => item.toDto()),
      generatedTest: this.generatedTest.map((item) => item.toDto()),
      // Only when the payload had one, so a review keeps its own shape (the default is implied).
      ...(this.storedFailureReason !== undefined ? { failureReason: this.storedFailureReason } : {}),
      ...(this.hasStoredTestConfig ? { testConfig: { framework: this.testConfig.framework, testTypeIdList: [...this.testConfig.testTypeIdList] } } : {})
    }
  }
}
