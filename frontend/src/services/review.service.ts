import { API_PATH, SNIPPET_SOURCE_TYPE } from '../lib/api.constants'
import { AppError } from '../models/app-error'
import type { AnalyzerKind, GeneratedTestFileDto, NewReviewDto, ReviewDetailDto, ReviewSummaryDto, SaveReviewDto, SavedReviewDto, TestConfigDto } from '../models/dto'
import { isArrayOf, isRecord, isString } from '../models/guard'
import { analyzerKindOf, isGeneratedTestFileDto, isReviewSummaryDto, isSavedReviewDto, parseDto, Review } from '../models/review.model'
import { DEV_ERROR_MESSAGE, ERROR_CODE } from '../utils/error-messages'
import { del, get, patch, post, put, type DataSource } from './data-source'

export interface ReadOption {
  signal?: AbortSignal
  // Plan 037: the review status poll, which never shows the global loader.
  background?: boolean
}

export interface ReviewService {
  // History and Dashboard rows: deleted reviews are hidden and a saved name replaces the title.
  list(option?: ReadOption): Promise<ReviewSummaryDto[]>
  // The review plus the user's saved edits; null when there is no such review (or it was deleted).
  get(id: string, option?: ReadOption): Promise<ReviewDetailDto | null>
  create(input: NewReviewDto): Promise<ReviewDetailDto>
  save(id: string, input: SaveReviewDto): Promise<SavedReviewDto>
  // Run review on an existing review (POST /api/review/{id}/run): saves the edit and re-analyzes
  // the same id. Resolves with the review in status pending.
  run(id: string, input: SaveReviewDto): Promise<ReviewDetailDto>
  rename(id: string, name: string): Promise<SavedReviewDto>
  delete(id: string): Promise<void>
  // Generated Tests "Regenerate": the new files, which the next get() also returns. Plan 034: the
  // test configuration is sent as the body, and the server stores it with the review.
  regenerateTest(id: string, testConfig?: TestConfigDto): Promise<GeneratedTestFileDto[]>
  // Plan 039: GET /api/health `analyzer`, which analyzer reviews use (a missing value is `stub`).
  analyzer(): Promise<AnalyzerKind>
}

// GET /api/review/{id} returns the review with the saved edits applied and a `savedAt` when the
// user has saved it, plus the code and language its findings belong to (`analyzedContent`,
// `analyzedLanguage`, required since contract 0.6.0 on GET and on the run answer). The create
// answer (POST /api/review) has no such fields: there the analyzed code is the sent one.
function toDetail(id: string, value: unknown, analyzedRequired: boolean): ReviewDetailDto {
  const review = Review.fromDto(value).toDto()
  const savedAt = isRecord(value) && isString(value.savedAt) ? value.savedAt : null
  const hasAnalyzed = isRecord(value) && isString(value.analyzedContent) && isString(value.analyzedLanguage)
  if (analyzedRequired && !hasAnalyzed) {
    throw new AppError({ code: ERROR_CODE.parse, kind: 'parse', message: DEV_ERROR_MESSAGE.missingAnalyzed })
  }
  return {
    id,
    review,
    saved: savedAt ? { name: review.title, language: review.language, code: review.content, savedAt } : null,
    analyzedContent: hasAnalyzed ? String(value.analyzedContent) : review.content,
    analyzedLanguage: hasAnalyzed ? String(value.analyzedLanguage) : review.language
  }
}

function idOf(value: unknown): string {
  const id = isRecord(value) && isString(value.id) ? value.id : ''
  if (!id) throw new AppError({ code: ERROR_CODE.parse, kind: 'parse', message: DEV_ERROR_MESSAGE.missingReviewId })
  return id
}

export function createReviewService(source: DataSource): ReviewService {
  return {
    async list(option = {}) {
      return parseDto(await get<unknown>(source, API_PATH.review, { signal: option.signal }), isArrayOf(isReviewSummaryDto))
    },
    async get(id, option = {}) {
      try {
        return toDetail(id, await get<unknown>(source, API_PATH.reviewById(id), { signal: option.signal, background: option.background }), true)
      } catch (error) {
        // An unknown or deleted id is the "Review not found" page, not an error toast.
        if (AppError.is(error) && error.code === ERROR_CODE.notFound) return null
        throw error
      }
    },
    async create(input) {
      const value = await post<unknown>(source, API_PATH.review, { source_type: SNIPPET_SOURCE_TYPE, ...input })
      return toDetail(idOf(value), value, false)
    },
    async run(id, input) {
      const value = await post<unknown>(source, API_PATH.reviewRun(id), input)
      return toDetail(idOf(value), value, true)
    },
    async save(id, input) {
      return parseDto(await put<unknown>(source, API_PATH.reviewById(id), input), isSavedReviewDto)
    },
    async rename(id, name) {
      return parseDto(await patch<unknown>(source, API_PATH.reviewById(id), { name }), isSavedReviewDto)
    },
    async delete(id) {
      await del(source, API_PATH.reviewById(id))
    },
    async analyzer() {
      return analyzerKindOf(await get<unknown>(source, API_PATH.health, { background: true }))
    },
    async regenerateTest(id, testConfig) {
      const body = testConfig ? { framework: testConfig.framework, testTypeIdList: [...testConfig.testTypeIdList] } : undefined
      return parseDto(await post<unknown>(source, API_PATH.generatedTest(id), body), isArrayOf(isGeneratedTestFileDto))
    }
  }
}
