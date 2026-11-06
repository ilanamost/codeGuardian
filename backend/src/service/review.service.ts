import type { Analyzer, AnalyzerInput, AnalyzerResult, RegenerateContext } from '../analyzer/analyzer.js'
import { AnalyzerError } from '../analyzer/analyzer-error.js'
import { createConcurrencyLimiter, type ConcurrencyLimiter } from '../lib/concurrency-limiter.js'
import { analysisQuotaError, conflictError, notFoundError, rateLimitedError, upstreamError, upstreamTimeoutError } from '../lib/error.js'
import { createRateLimiter, type RateLimiter } from '../lib/rate-limit.js'
import { formatTimeAgo } from '../lib/time-ago.js'
import type { AnalyzedReview, FailureReason as FailureReasonValue, FindingCount, GeneratedTestFile, ReviewSummary, ReviewWithConfig, SavedReview, TestConfig } from '../model/dto.js'
import type { NewReviewInput, SaveReviewInput } from '../schema/review.schema.js'
import type { ReviewRecord, Store } from '../store/store.js'
import { LOG_OPERATION, LogLevel, REVIEW_DEFAULT, TEST_CONFIG_DEFAULT, TIME_AGO_TEXT } from '../utils/constants.js'
import { AnalyzerKind, FailureReason, ImportLimit, ReviewStatus, Severity } from '../utils/domain.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

export type ReviewService = ReturnType<typeof createReviewService>

// A run is refused while an analysis is still unfinished (contract 0.6.0, 409). Reviews left in
// one of these on shutdown are re-analyzed on start (plan 022).
export const unfinishedStatusList: readonly string[] = [ReviewStatus.Pending, ReviewStatus.Queued, ReviewStatus.InProgress]

// The configuration a review reads as (plan 034): its stored one, or the default.
function testConfigOf(record: ReviewRecord): TestConfig {
  return structuredClone(record.testConfig ?? { framework: TEST_CONFIG_DEFAULT.framework, testTypeIdList: [...TEST_CONFIG_DEFAULT.testTypeIdList] })
}

function countOf(findingCount: FindingCount[], severity: Severity): number {
  return findingCount.find((item) => item.severity === severity)?.count ?? 0
}

// The analysis quota and the provider concurrency cap (plan 039). Both are shared by every user
// of the service, and only apply to an analyzer of kind `claude` (the stub costs nothing). A
// caller that builds a second service over the same store passes the same instances.
export type ReviewServiceOption = { quota?: RateLimiter, limiter?: ConcurrencyLimiter }

// The failure reason a review shows: the stored one, `internal` for a failed review from before.
function failureReasonOf(record: ReviewRecord): FailureReasonValue | null {
  return record.review.status === ReviewStatus.Failed ? record.failureReason ?? FailureReason.Internal : null
}

export function createReviewService(store: Store, analyzer: Analyzer, now: () => number, option: ReviewServiceOption = {}) {
  const metered = analyzer.kind === AnalyzerKind.Claude
  const quota = option.quota ?? createRateLimiter({ ...LIMIT.analyzer.quotaOrg, now })
  const limiter = option.limiter ?? createConcurrencyLimiter(LIMIT.analyzer.concurrentCall)

  // 429 when the org has used its analyses of the hour. Checked before anything changes, so a
  // refused request creates, re-runs and regenerates nothing.
  function checkQuota(orgId: string): void {
    if (!metered) return
    const retryAfterSecond = quota.retryAfter(orgId)
    if (retryAfterSecond === undefined) return
    throw analysisQuotaError(new Date(now() + retryAfterSecond * 1000).toISOString(), retryAfterSecond)
  }

  function chargeQuota(orgId: string): void {
    if (metered) quota.hit(orgId)
  }

  async function findOrThrow(orgId: string, id: string): Promise<ReviewRecord> {
    const record = await store.findReview(orgId, id)
    if (!record) throw notFoundError(ERROR_MESSAGE.reviewNotFound(id))
    return record
  }

  function logAnalyzeError(id: string, error: unknown, reason?: FailureReasonValue): void {
    console.error(JSON.stringify({
      level: LogLevel.Error,
      operation: LOG_OPERATION.analyzeReview,
      reviewId: id,
      ...(reason ? { failureReason: reason } : {}),
      message: error instanceof Error ? error.message : String(error)
    }))
  }

  // Runs one analysis. With the Claude analyzer it waits for a free provider slot (the review
  // shows `queued` meanwhile), then shows `in_progress`; a review whose run is gone by then
  // (deleted, or taken over by a newer run) is skipped without a provider call (undefined).
  async function analyzeInSlot(orgId: string, id: string, run: number, input: AnalyzerInput): Promise<AnalyzerResult | undefined> {
    if (!metered) return analyzer.analyze(input)
    const slot = limiter.acquire()
    if (slot.queued) await store.markReviewStatus(orgId, id, run, ReviewStatus.Queued, unfinishedStatusList).catch(() => false)
    await slot.granted
    try {
      if (!(await store.markReviewStatus(orgId, id, run, ReviewStatus.InProgress, unfinishedStatusList))) return undefined
      return await analyzer.analyze(input)
    } finally {
      limiter.release()
    }
  }

  async function regenerateInSlot(fileList: GeneratedTestFile[], config: TestConfig | undefined, context: RegenerateContext): Promise<GeneratedTestFile[]> {
    if (!metered) return analyzer.regenerateTest(fileList, config, context)
    const slot = limiter.acquire()
    await slot.granted
    try {
      return await analyzer.regenerateTest(fileList, config, context)
    } finally {
      limiter.release()
    }
  }

  // An analyzer failure inside the synchronous regenerate call becomes the route's standard
  // error: 429 (the provider's rate limit), 504 (deadline) or 502 (anything else of the
  // provider's). Any other error is a bug and stays a 500.
  function httpErrorOf(error: unknown): unknown {
    if (!(error instanceof AnalyzerError)) return error
    if (error.reason === FailureReason.AiRateLimited) return rateLimitedError(ERROR_MESSAGE.aiRateLimited)
    if (error.reason === FailureReason.AiTimeout) {
      return upstreamTimeoutError(ERROR_MESSAGE.aiTimeout(LIMIT.analyzer.regenerateDeadlineMs), { limit: ImportLimit.TotalTimeout, maxMs: LIMIT.analyzer.regenerateDeadlineMs })
    }
    return upstreamError(ERROR_MESSAGE.aiUpstream)
  }

  // Runs after the 202 is sent (and on start for unfinished reviews), always in the review's own
  // org. A review deleted meanwhile is left alone, and so is a review that a newer run has taken
  // over: the store writes the result only while the review is still on `run` (a conditional
  // update), so a late result is discarded. The account's saved AI preferences are read here,
  // when the analysis starts (plan 028, Scope 19).
  //
  // `counted` is false for a review resumed on start: its analysis was not charged to the quota
  // by a request, so it is checked and charged here, and fails with `ai_quota_exceeded` when the
  // org has used its analyses (plan 039, Open Question 7).
  async function complete(orgId: string, id: string, run: number, counted = true): Promise<void> {
    try {
      const record = await store.findReview(orgId, id)
      if (record?.run !== run) return
      if (metered && !counted) {
        if (quota.retryAfter(orgId) !== undefined) {
          await store.failReview(orgId, id, run, FailureReason.AiQuotaExceeded)
          logAnalyzeError(id, new AnalyzerError(FailureReason.AiQuotaExceeded), FailureReason.AiQuotaExceeded)
          return
        }
        quota.hit(orgId)
      }
      const settings = await store.getSettings(orgId)
      let result
      try {
        result = await analyzeInSlot(orgId, id, run, {
          reviewId: id,
          orgId,
          title: record.review.title,
          language: record.review.language,
          content: record.review.content,
          preference: {
            reviewFocus: settings.reviewFocus,
            strictness: settings.strictness,
            explanation: settings.explanation,
            generatedTest: settings.generatedTest
          },
          // Plan 034: the first tests of a run use the stored configuration; none, the original.
          ...(record.testConfig ? { testConfig: record.testConfig } : {})
        })
      } catch (error) {
        const reason = error instanceof AnalyzerError ? error.reason : FailureReason.Internal
        await store.failReview(orgId, id, run, reason)
        logAnalyzeError(id, error, reason)
        return
      }
      if (!result) return
      await store.completeReview(orgId, id, run, result)
    } catch (error) {
      // A store failure in the background has no request to answer; it is only logged.
      logAnalyzeError(id, error)
    }
  }

  // `analyzedContent` / `analyzedLanguage` come from the analyzed review, before the saved edit
  // replaces `content` / `language`.
  async function get(orgId: string, id: string): Promise<AnalyzedReview> {
    const record = await findOrThrow(orgId, id)
    const review = record.review
    const saved = record.saved
    return {
      ...review,
      analyzedAgo: formatTimeAgo(record.analyzedAt, now()),
      analyzedContent: review.content,
      analyzedLanguage: review.language,
      ...(saved ? { title: saved.name ?? review.title, language: saved.language, content: saved.code } : {}),
      savedAt: saved?.savedAt ?? null,
      testConfig: testConfigOf(record),
      failureReason: failureReasonOf(record)
    }
  }

  function savedOf(record: ReviewRecord, input: SaveReviewInput): SavedReview {
    const name = input.name ?? record.saved?.name
    return {
      ...(name === undefined ? {} : { name }),
      language: input.language,
      code: input.code,
      savedAt: new Date(now()).toISOString()
    }
  }

  async function save(orgId: string, id: string, input: SaveReviewInput): Promise<SavedReview> {
    const saved = savedOf(await findOrThrow(orgId, id), input)
    if (!(await store.saveReview(orgId, id, saved))) throw notFoundError(ERROR_MESSAGE.reviewNotFound(id))
    return { ...saved }
  }

  return {
    async list(orgId: string): Promise<ReviewSummary[]> {
      const summaryList = await store.listReviewSummary(orgId)
      return summaryList.map((summary) => ({
        id: summary.id,
        title: summary.title,
        language: summary.language,
        timeAgo: formatTimeAgo(summary.createdAt, now()),
        status: summary.status,
        high: countOf(summary.findingCount, Severity.Critical) + countOf(summary.findingCount, Severity.High),
        medium: countOf(summary.findingCount, Severity.Medium),
        low: countOf(summary.findingCount, Severity.Low)
      }))
    },

    get,

    async create(orgId: string, input: NewReviewInput): Promise<ReviewWithConfig & { id: string }> {
      checkQuota(orgId)
      const id = crypto.randomUUID()
      const createdAt = now()
      const record: ReviewRecord = {
        id,
        createdAt,
        analyzedAt: createdAt,
        run: 0,
        saved: null,
        deleted: false,
        review: {
          title: input.title || REVIEW_DEFAULT.title,
          status: ReviewStatus.Pending,
          language: input.language,
          analyzedAgo: TIME_AGO_TEXT.justNow,
          qualityScore: REVIEW_DEFAULT.initialQualityScore,
          content: input.content,
          findingCount: [],
          finding: [],
          suggestion: [],
          generatedTest: []
        }
      }
      await store.createReview(orgId, record)
      chargeQuota(orgId)
      const snapshot = { id, ...structuredClone(record.review), testConfig: testConfigOf(record), failureReason: null }
      void complete(orgId, id, record.run)
      return snapshot
    },

    save,

    // Saves the edit like `save`, then re-analyzes the same id with that code and language
    // (contract 0.6.0, POST /api/review/{id}/run). `createdAt` is kept, `analyzedAt` restarts.
    async run(orgId: string, id: string, input: SaveReviewInput): Promise<AnalyzedReview & { id: string }> {
      const record = await findOrThrow(orgId, id)
      if (unfinishedStatusList.includes(record.review.status)) {
        throw conflictError(ERROR_MESSAGE.reviewUnfinished(id, record.review.status))
      }
      checkQuota(orgId)
      const result = await store.restartReview(orgId, id, {
        saved: savedOf(record, input),
        language: input.language,
        content: input.code,
        analyzedAt: now()
      }, unfinishedStatusList)
      if (!result.ok) {
        if (result.reason === 'unfinished') throw conflictError(ERROR_MESSAGE.reviewUnfinished(id, result.status))
        throw notFoundError(ERROR_MESSAGE.reviewNotFound(id))
      }
      chargeQuota(orgId)
      const snapshot = { id, ...(await get(orgId, id)) }
      void complete(orgId, id, result.run)
      return snapshot
    },

    async rename(orgId: string, id: string, name: string): Promise<SavedReview> {
      const record = await findOrThrow(orgId, id)
      if (!record.saved) throw notFoundError(ERROR_MESSAGE.reviewNotSaved(id))
      const saved = { ...record.saved, name, savedAt: new Date(now()).toISOString() }
      if (!(await store.saveReview(orgId, id, saved))) throw notFoundError(ERROR_MESSAGE.reviewNotFound(id))
      return { ...saved }
    },

    async remove(orgId: string, id: string): Promise<void> {
      if (!(await store.deleteReview(orgId, id))) throw notFoundError(ERROR_MESSAGE.reviewNotFound(id))
    },

    // Plan 034: a sent configuration is stored with the new files (in one store step) and used
    // for them; without one the stored configuration is used, and a review without any
    // regenerates as before.
    async regenerateTest(orgId: string, id: string, testConfig?: TestConfig): Promise<GeneratedTestFile[]> {
      const record = await findOrThrow(orgId, id)
      if (record.review.status !== ReviewStatus.Completed) {
        throw conflictError(ERROR_MESSAGE.reviewNotCompleted(id, record.review.status))
      }
      checkQuota(orgId)
      const config = testConfig ?? record.testConfig ?? undefined
      // Counted when the call starts: a call that fails may still have cost money.
      chargeQuota(orgId)
      const context = { reviewId: id, orgId, title: record.review.title, language: record.review.language, content: record.review.content }
      let fileList: GeneratedTestFile[]
      try {
        fileList = await regenerateInSlot(record.review.generatedTest, config, context)
      } catch (error) {
        throw httpErrorOf(error)
      }
      if (!(await store.replaceGeneratedTest(orgId, id, fileList, testConfig))) throw notFoundError(ERROR_MESSAGE.reviewNotFound(id))
      return structuredClone(fileList)
    },

    // Plan 022: reviews whose analysis had not finished when the backend stopped are analyzed
    // again on start, each on its current run and in its own org (plan 028). Returns how many
    // were started.
    async resumeUnfinished(): Promise<number> {
      const unfinishedList = await store.listUnfinishedReview(unfinishedStatusList)
      for (const { orgId, id, run } of unfinishedList) void complete(orgId, id, run, false)
      return unfinishedList.length
    },

    // The test-only reset starts the analysis quota again.
    reset(): void {
      quota.reset()
    }
  }
}
