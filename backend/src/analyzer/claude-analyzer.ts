import {
  APIConnectionError, APIConnectionTimeoutError, APIUserAbortError, AuthenticationError, BadRequestError,
  InternalServerError, PermissionDeniedError, RateLimitError
} from '@anthropic-ai/sdk'
import type { z } from 'zod'
import type { CountedSeverity, Finding, GeneratedTestFile, Suggestion, TestConfig } from '../model/dto.js'
import { analysisOutputFormat, analysisSchema, regenerateOutputFormat, regenerateSchema, type OutputFormat } from '../schema/analyzer.schema.js'
import { LOG_MESSAGE, LOG_OPERATION, LogLevel, SEVERITY_WEIGHT } from '../utils/constants.js'
import { AnalyzerKind, FailureReason, Severity } from '../utils/domain.js'
import { LIMIT } from '../utils/limits.js'
import { AnalyzerError } from './analyzer-error.js'
import type { Analyzer, AnalyzerInput, AnalyzerResult, RegenerateContext } from './analyzer.js'
import type { ClaudeClient, ClaudeReply, ClaudeRequest } from './claude-client.js'
import { buildAnalysisPrompt, buildRegeneratePrompt, lineCountOf } from './claude-prompt.js'
import { categoryListOf, isHighOnly, HIGH_CONFIDENCE_SEVERITY_LIST, PREFERENCE_DEFAULT } from './preference.js'
import { testFileNameOf } from './test-file-name.js'

// THE CLAUDE ANALYZER (plan 039): one streamed Messages API call per analysis, a structured
// answer checked again on the server, and a mapping to the shapes the app already shows. It
// never logs the code, the prompt, the answer, the key or a provider error body.

export type AnalyzerLogger = { info(line: string): void, warn(line: string): void, error(line: string): void }

// The parts of `LIMIT.analyzer` the analyzer itself uses; the tests override the deadlines.
export type ClaudeAnalyzerLimit = {
  maxToken: number
  effort: ClaudeRequest['effort']
  analysisDeadlineMs: number
  regenerateDeadlineMs: number
  findingMax: number
}

export type ClaudeAnalyzerOption = {
  client: ClaudeClient
  model: string
  limit?: Partial<ClaudeAnalyzerLimit>
  now?: () => number
  logger?: AnalyzerLogger
}

type CallContext = { kind: 'analysis' | 'regenerate', reviewId?: string, orgId?: string }

const countedSeverityList: CountedSeverity[] = [Severity.Critical, Severity.High, Severity.Medium, Severity.Low]
const finishedStopReasonList: readonly (string | null)[] = ['end_turn', 'stop_sequence']

// SDK error classes, most specific first, never message matching. Everything not named here is
// `internal`, so a provider detail never decides what the user sees.
function failureReasonOf(error: unknown, timedOut: boolean): `${FailureReason}` {
  if (timedOut) return FailureReason.AiTimeout
  if (error instanceof AnalyzerError) return error.reason
  if (error instanceof APIConnectionTimeoutError) return FailureReason.AiTimeout
  if (error instanceof APIUserAbortError) return FailureReason.Internal
  if (error instanceof RateLimitError) return FailureReason.AiRateLimited
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) return FailureReason.AiUnavailable
  if (error instanceof InternalServerError) return FailureReason.AiUnavailable
  if (error instanceof APIConnectionError) return FailureReason.AiUnavailable
  if (error instanceof BadRequestError) return FailureReason.Internal
  return FailureReason.Internal
}

function isKeyRejected(error: unknown): boolean {
  return error instanceof AuthenticationError || error instanceof PermissionDeniedError
}

export function createClaudeAnalyzer(option: ClaudeAnalyzerOption): Analyzer {
  const limit: ClaudeAnalyzerLimit = { ...LIMIT.analyzer, ...option.limit }
  const now = option.now ?? Date.now
  const logger: AnalyzerLogger = option.logger ?? console

  function logLine(level: LogLevel, message: string, field: object): string {
    return JSON.stringify({ level, operation: LOG_OPERATION.analyzeReview, message, ...field })
  }

  function logCall(started: number, context: CallContext, reply: ClaudeReply, field: object = {}): void {
    logger.info(logLine(LogLevel.Info, LOG_MESSAGE.analyzerCall, {
      kind: context.kind,
      reviewId: context.reviewId,
      org: context.orgId,
      model: option.model,
      durationMs: now() - started,
      stopReason: reply.stopReason,
      inputTokens: reply.inputToken,
      outputTokens: reply.outputToken,
      cacheReadTokens: reply.cacheReadToken,
      requestId: reply.requestId,
      ...field
    }))
  }

  function logFailure(started: number, context: CallContext, reason: `${FailureReason}`, field: object = {}): void {
    logger.warn(logLine(LogLevel.Warn, LOG_MESSAGE.analyzerFailed, {
      kind: context.kind,
      reviewId: context.reviewId,
      org: context.orgId,
      model: option.model,
      durationMs: now() - started,
      failureReason: reason,
      ...field
    }))
  }

  // One overall deadline for a whole analysis or regenerate, retries included.
  function startDeadline(ms: number) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ms)
    return { signal: controller.signal, timedOut: () => timedOut, clear: () => clearTimeout(timer) }
  }

  // One provider call: error mapping, refusal and cut-off answers, JSON parse and schema check.
  async function ask<Schema extends z.ZodType>(
    prompt: { system: string, user: string },
    format: OutputFormat,
    schema: Schema,
    deadline: ReturnType<typeof startDeadline>,
    context: CallContext,
    started: number
  ): Promise<{ output: z.infer<Schema>, reply: ClaudeReply }> {
    let reply: ClaudeReply
    try {
      reply = await option.client.complete({
        model: option.model,
        maxToken: limit.maxToken,
        effort: limit.effort,
        system: prompt.system,
        user: prompt.user,
        format
      }, { signal: deadline.signal })
    } catch (error) {
      const reason = failureReasonOf(error, deadline.timedOut())
      if (isKeyRejected(error)) {
        logger.error(logLine(LogLevel.Error, LOG_MESSAGE.analyzerKeyRejected, { model: option.model }))
      }
      logFailure(started, context, reason)
      throw new AnalyzerError(reason)
    }

    if (reply.stopReason === 'refusal') {
      logCall(started, context, reply, { failureReason: FailureReason.AiRefused })
      throw new AnalyzerError(FailureReason.AiRefused)
    }
    if (!finishedStopReasonList.includes(reply.stopReason)) {
      // `max_tokens` (cut off) and anything else unexpected: the JSON cannot be trusted.
      logCall(started, context, reply, { failureReason: FailureReason.AiInvalidOutput })
      throw new AnalyzerError(FailureReason.AiInvalidOutput)
    }
    let json: unknown
    try {
      json = JSON.parse(reply.text)
    } catch {
      logCall(started, context, reply, { failureReason: FailureReason.AiInvalidOutput })
      throw new AnalyzerError(FailureReason.AiInvalidOutput)
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      logCall(started, context, reply, { failureReason: FailureReason.AiInvalidOutput })
      throw new AnalyzerError(FailureReason.AiInvalidOutput)
    }
    return { output: parsed.data as z.infer<Schema>, reply }
  }

  // The findings the server keeps: a line outside the code, a category outside the review focus
  // or a severity below the strictness is dropped (and counted in the log line).
  function keepFinding(input: AnalyzerInput, finding: z.infer<typeof analysisSchema>['finding']) {
    const preference = input.preference ?? PREFERENCE_DEFAULT
    const lineCount = lineCountOf(input.content)
    const categoryList = categoryListOf(preference)
    const highOnly = isHighOnly(preference)
    const kept = finding.filter((item) =>
      item.line_start >= 1 && item.line_start <= lineCount &&
      (!categoryList || categoryList.includes(item.category)) &&
      (!highOnly || HIGH_CONFIDENCE_SEVERITY_LIST.includes(item.severity)))
    return { kept: kept.slice(0, limit.findingMax), dropped: finding.length - kept.length }
  }

  return {
    kind: AnalyzerKind.Claude,

    async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
      const started = now()
      const context: CallContext = { kind: 'analysis', reviewId: input.reviewId, orgId: input.orgId }
      const deadline = startDeadline(limit.analysisDeadlineMs)
      try {
        const { output, reply } = await ask(buildAnalysisPrompt(input), analysisOutputFormat, analysisSchema, deadline, context, started)
        const { kept, dropped } = keepFinding(input, output.finding)

        const finding: Finding[] = kept.map((item, index) => ({ id: `f${index + 1}`, ...item }))
        const suggestion: Suggestion[] = output.suggestion.map((item, index) => ({ id: `s${index + 1}`, ...item }))
        const penalty = finding.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity], 0)
        const wantsTest = (input.preference ?? PREFERENCE_DEFAULT).generatedTest
        const file = testFileNameOf(input)

        logCall(started, context, reply, { droppedFinding: dropped, keptFinding: finding.length })
        return {
          qualityScore: Math.max(LIMIT.minQualityScore, LIMIT.fullQualityScore - penalty),
          findingCount: countedSeverityList.map((severity) => ({
            severity,
            count: finding.filter((item) => item.severity === severity).length
          })),
          finding,
          suggestion,
          generatedTest: wantsTest && output.generatedTest
            ? [{ id: file.id, sourceFile: file.sourceFile, testFile: file.testFile, language: file.language, code: output.generatedTest.code, altCode: output.generatedTest.code }]
            : []
        }
      } finally {
        deadline.clear()
      }
    },

    // A new test file per source file, written by the model; the previous test becomes `altCode`.
    async regenerateTest(fileList: GeneratedTestFile[], testConfig?: TestConfig, regenerate?: RegenerateContext): Promise<GeneratedTestFile[]> {
      const started = now()
      const context: CallContext = { kind: 'regenerate', reviewId: regenerate?.reviewId, orgId: regenerate?.orgId }
      if (!regenerate) throw new AnalyzerError(FailureReason.Internal)
      const deadline = startDeadline(limit.regenerateDeadlineMs)
      try {
        const result: GeneratedTestFile[] = []
        for (const file of fileList) {
          const prompt = buildRegeneratePrompt({
            title: regenerate.title ?? file.sourceFile,
            language: regenerate.language ?? file.language,
            content: regenerate.content,
            sourceFile: file.sourceFile,
            testFile: file.testFile,
            previousTest: file.code,
            ...(testConfig ? { testConfig } : {})
          })
          const { output, reply } = await ask(prompt, regenerateOutputFormat, regenerateSchema, deadline, context, started)
          logCall(started, context, reply)
          result.push({ ...file, code: output.code, altCode: file.code })
        }
        return result
      } finally {
        deadline.clear()
      }
    }
  }
}
