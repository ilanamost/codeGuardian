import { describe, expect, it } from 'vitest'
import { AnalyzerError } from '../src/analyzer/analyzer-error.js'
import type { AnalyzerInput } from '../src/analyzer/analyzer.js'
import { createClaudeAnalyzer } from '../src/analyzer/claude-analyzer.js'
import { createAnthropicClient } from '../src/analyzer/claude-client.js'
import { SYSTEM_PROMPT } from '../src/analyzer/claude-prompt.js'
import { createStubAnalyzer } from '../src/analyzer/stub-analyzer.js'
import type { GeneratedTestFile } from '../src/model/dto.js'
import {
  canaryCode, canaryKey, captureLog, connectionError, connectionTimeout, createFakeClaude, never, replyOf, sdkError, validAnalysis, type FakeHandler
} from './helper/fake-claude.js'

const input: AnalyzerInput = {
  reviewId: 'rev-1',
  orgId: 'org-1',
  title: 'My Service',
  language: 'TypeScript',
  content: 'const out = eval(input)\nconst value: any = 1\n'
}

function build(handler: FakeHandler, limit: Parameters<typeof createClaudeAnalyzer>[0]['limit'] = undefined) {
  const client = createFakeClaude(handler)
  const logger = captureLog()
  const analyzer = createClaudeAnalyzer({ client, model: 'claude-test-model', logger, ...(limit ? { limit } : {}) })
  return { client, logger, analyzer }
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AnalyzerError)
    return (error as AnalyzerError).reason
  }
  return expect.fail('The analysis should have failed.')
}

describe('Claude analyzer: a valid answer', () => {
  it('maps to the DTO shapes: ids, counts, quality score and the test file named like the stub', async () => {
    const { analyzer, client } = build(() => replyOf(validAnalysis))

    const result = await analyzer.analyze(input)

    expect(analyzer.kind).toBe('claude')
    expect(result.finding.map((item) => item.id)).toEqual(['f1', 'f2', 'f3'])
    expect(result.finding[0]).toEqual({ id: 'f1', severity: 'critical', category: 'security', message: 'Use of eval', detail: 'eval runs arbitrary code.', line_start: 1 })
    expect(result.suggestion).toEqual([{ id: 's1', title: 'Replace eval', detail: 'Use a lookup table.' }])
    expect(result.findingCount).toEqual([
      { severity: 'critical', count: 1 }, { severity: 'high', count: 0 }, { severity: 'medium', count: 1 }, { severity: 'low', count: 1 }
    ])
    // 100 - 25 (critical) - 8 (medium) - 3 (low), the stub's weights.
    expect(result.qualityScore).toBe(64)
    const stubTest = (await createStubAnalyzer().analyze(input)).generatedTest[0]
    expect(result.generatedTest).toHaveLength(1)
    const test = result.generatedTest[0] as GeneratedTestFile
    expect([test.id, test.sourceFile, test.testFile, test.language]).toEqual([stubTest?.id, stubTest?.sourceFile, stubTest?.testFile, stubTest?.language])
    expect(test.code).toBe(validAnalysis.generatedTest.code)
    expect(test.altCode).toBe(test.code)
    expect(client.requestList).toHaveLength(1)
  })

  it('asks for one structured, bounded call with the configured model', async () => {
    const { analyzer, client } = build(() => replyOf(validAnalysis))

    await analyzer.analyze(input)

    const request = client.requestList[0]
    expect(request?.model).toBe('claude-test-model')
    expect(request?.maxToken).toBe(16_000)
    expect(request?.effort).toBe('medium')
    expect(request?.system).toBe(SYSTEM_PROMPT)
    expect(request?.format.type).toBe('json_schema')
    expect(request?.format.schema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(request?.user).toContain('1| const out = eval(input)')
  })

  it('returns no generated test when the setting is off, or when the model sent none', async () => {
    const off = build(() => replyOf({ ...validAnalysis, generatedTest: null }))
    const preference = { reviewFocus: 'all', strictness: 'balanced', explanation: 'detailed', generatedTest: false } as const

    expect((await build(() => replyOf(validAnalysis)).analyzer.analyze({ ...input, preference })).generatedTest).toEqual([])
    expect((await off.analyzer.analyze(input)).generatedTest).toEqual([])
  })

  it('an empty answer is a valid review with a full score', async () => {
    const { analyzer } = build(() => replyOf({ finding: [], suggestion: [], generatedTest: null }))

    const result = await analyzer.analyze(input)

    expect(result.finding).toEqual([])
    expect(result.qualityScore).toBe(100)
    expect(result.findingCount.every((item) => item.count === 0)).toBe(true)
  })
})

describe('Claude analyzer: server-side drops', () => {
  const mixed = {
    finding: [
      { severity: 'high', category: 'bug', message: 'In range', detail: 'ok', line_start: 2 },
      { severity: 'high', category: 'bug', message: 'Far past the end', detail: 'x', line_start: 100 },
      { severity: 'critical', category: 'security', message: 'Past the end', detail: 'x', line_start: 3 },
      { severity: 'medium', category: 'security', message: 'Medium security', detail: 'x', line_start: 1 },
      { severity: 'low', category: 'readability', message: 'Readability', detail: 'x', line_start: 1 }
    ],
    suggestion: [],
    generatedTest: null
  }

  it('drops a line outside the code (the trailing line break is not a line) and keeps the rest', async () => {
    const { analyzer, logger } = build(() => replyOf(mixed))

    const result = await analyzer.analyze(input)

    expect(result.finding.map((item) => item.message)).toEqual(['In range', 'Medium security', 'Readability'])
    expect(result.finding.map((item) => item.id)).toEqual(['f1', 'f2', 'f3'])
    expect(logger.lineList.join('\n')).toContain('"droppedFinding":2')
  })

  it('drops a category outside the review focus', async () => {
    const { analyzer } = build(() => replyOf(mixed))
    const preference = { reviewFocus: 'security', strictness: 'balanced', explanation: 'detailed', generatedTest: true } as const

    const result = await analyzer.analyze({ ...input, preference })

    expect(result.finding.map((item) => item.message)).toEqual(['Medium security'])
  })

  it('maps the readability focus to readability and maintainability', async () => {
    const { analyzer } = build(() => replyOf({
      finding: [
        { severity: 'low', category: 'maintainability', message: 'M', detail: 'x', line_start: 1 },
        { severity: 'low', category: 'readability', message: 'R', detail: 'x', line_start: 1 },
        { severity: 'low', category: 'bug', message: 'B', detail: 'x', line_start: 1 }
      ],
      suggestion: [],
      generatedTest: null
    }))
    const preference = { reviewFocus: 'readability', strictness: 'balanced', explanation: 'detailed', generatedTest: true } as const

    expect((await analyzer.analyze({ ...input, preference })).finding.map((item) => item.message)).toEqual(['M', 'R'])
  })

  it('with high_confidence keeps only critical and high findings', async () => {
    const { analyzer } = build(() => replyOf(mixed))
    const preference = { reviewFocus: 'all', strictness: 'high_confidence', explanation: 'detailed', generatedTest: true } as const

    const result = await analyzer.analyze({ ...input, preference })

    expect(result.finding.map((item) => item.message)).toEqual(['In range'])
  })
})

describe('Claude analyzer: answers that are not usable', () => {
  it('a schema-invalid answer fails the whole analysis (ai_invalid_output)', async () => {
    const bad = { ...validAnalysis, finding: [{ ...validAnalysis.finding[0], severity: 'catastrophic' }] }

    expect(await failureOf(build(() => replyOf(bad)).analyzer.analyze(input))).toBe('ai_invalid_output')
    expect(await failureOf(build(() => replyOf({ finding: [] })).analyzer.analyze(input))).toBe('ai_invalid_output')
    expect(await failureOf(build(() => replyOf({ ...validAnalysis, finding: [{ ...validAnalysis.finding[0], line_start: 1.5 }] })).analyzer.analyze(input))).toBe('ai_invalid_output')
  })

  it('an answer that is not JSON fails (ai_invalid_output)', async () => {
    expect(await failureOf(build(() => replyOf('Sure! Here is the review.')).analyzer.analyze(input))).toBe('ai_invalid_output')
  })

  it('a cut-off answer (max_tokens) fails even when its JSON looks valid', async () => {
    const { analyzer } = build(() => replyOf(validAnalysis, { stopReason: 'max_tokens' }))

    expect(await failureOf(analyzer.analyze(input))).toBe('ai_invalid_output')
  })

  it('a refusal fails with ai_refused', async () => {
    const { analyzer } = build(() => replyOf('', { stopReason: 'refusal' }))

    expect(await failureOf(analyzer.analyze(input))).toBe('ai_refused')
  })

  it('any other stop reason is not trusted', async () => {
    const { analyzer } = build(() => replyOf(validAnalysis, { stopReason: 'pause_turn' }))

    expect(await failureOf(analyzer.analyze(input))).toBe('ai_invalid_output')
  })
})

describe('Claude analyzer: provider errors', () => {
  const cases: [string, () => Error, string][] = [
    ['RateLimitError (429)', () => sdkError(429), 'ai_rate_limited'],
    ['APIConnectionTimeoutError', connectionTimeout, 'ai_timeout'],
    ['InternalServerError (500)', () => sdkError(500), 'ai_unavailable'],
    ['InternalServerError (529 overloaded)', () => sdkError(529), 'ai_unavailable'],
    ['APIConnectionError', connectionError, 'ai_unavailable'],
    ['AuthenticationError (401)', () => sdkError(401), 'ai_unavailable'],
    ['PermissionDeniedError (403)', () => sdkError(403), 'ai_unavailable'],
    ['BadRequestError (400)', () => sdkError(400), 'internal'],
    ['NotFoundError (404)', () => sdkError(404), 'internal'],
    ['an unknown error', () => new TypeError('boom'), 'internal']
  ]

  for (const [name, make, reason] of cases) {
    it(`${name} -> ${reason}, one call, and the raw message never leaves`, async () => {
      const { analyzer, client, logger } = build(() => { throw make() })

      const error = await analyzer.analyze(input).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(AnalyzerError)
      expect((error as AnalyzerError).reason).toBe(reason)
      expect((error as AnalyzerError).message).toBe(reason)
      expect(client.requestList).toHaveLength(1)
      expect(logger.lineList.join('\n')).not.toContain(canaryKey)
      expect(logger.lineList.join('\n')).not.toContain(canaryCode)
    })
  }

  it('a rejected key logs one error line that says so and never the key', async () => {
    const { analyzer, logger } = build(() => { throw sdkError(401) })

    await failureOf(analyzer.analyze(input))

    const errorLine = logger.lineList.find((line) => line.includes('"level":"error"'))
    expect(errorLine).toContain('rejected the configured API key')
    expect(logger.lineList.join('\n')).not.toContain('sk-ant')
  })

  it('the overall deadline ends a stuck call as ai_timeout', async () => {
    const { analyzer } = build((_request, signal) => never(signal), { analysisDeadlineMs: 25 })

    expect(await failureOf(analyzer.analyze(input))).toBe('ai_timeout')
  })

  it('the deadline wins even when the call fails with another error after it', async () => {
    const { analyzer } = build((_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(sdkError(500)))
    }), { analysisDeadlineMs: 25 })

    expect(await failureOf(analyzer.analyze(input))).toBe('ai_timeout')
  })
})

describe('Claude analyzer: logging', () => {
  it('logs the review id, org, model, usage, request id and the failure reason, never the code, prompt, answer or key', async () => {
    const answerCanary = 'ANSWER_CANARY_77'
    const secretInput = { ...input, content: `${canaryCode}\nconst token = "${canaryKey}"\n` }
    const ok = build(() => replyOf({ ...validAnalysis, finding: [{ ...validAnalysis.finding[0], detail: answerCanary }] }))

    await ok.analyzer.analyze(secretInput)
    const failing = build(() => replyOf(`not json ${answerCanary} ${canaryCode}`))
    await failureOf(failing.analyzer.analyze(secretInput))
    const refused = build(() => { throw sdkError(429) })
    await failureOf(refused.analyzer.analyze(secretInput))

    const okText = ok.logger.lineList.join('\n')
    expect(okText).toContain('"operation":"review.analyze"')
    for (const expected of ['"reviewId":"rev-1"', '"org":"org-1"', '"model":"claude-test-model"', '"inputTokens":1200', '"outputTokens":340', '"cacheReadTokens":1000', '"requestId":"req_test_123"', '"stopReason":"end_turn"', '"durationMs"']) {
      expect(okText).toContain(expected)
    }
    expect(failing.logger.lineList.join('\n')).toContain('"failureReason":"ai_invalid_output"')
    expect(refused.logger.lineList.join('\n')).toContain('"failureReason":"ai_rate_limited"')

    const everything = [ok, failing, refused].flatMap((item) => item.logger.lineList).join('\n')
    expect(everything).not.toContain(canaryKey)
    expect(everything).not.toContain('CANARY_LINE_9f3a')
    expect(everything).not.toContain(answerCanary)
    expect(everything).not.toContain('senior code reviewer')
    expect(everything).not.toContain('numbered 1 to')
  })
})

describe('Claude analyzer: regenerateTest', () => {
  const file: GeneratedTestFile = {
    id: 'rev-1-t1', sourceFile: 'my-service.ts', testFile: 'my-service.test.ts', language: 'TypeScript', code: 'OLD TEST', altCode: 'OLDER TEST'
  }
  const context = { reviewId: 'rev-1', orgId: 'org-1', title: 'My Service', language: 'TypeScript', content: input.content }

  it('asks for a different test and keeps the previous one as altCode', async () => {
    const { analyzer, client } = build(() => replyOf({ code: 'NEW TEST' }))

    const [result] = await analyzer.regenerateTest([file], { framework: 'Mocha', testTypeIdList: ['edge'] }, context)

    expect(result).toEqual({ ...file, code: 'NEW TEST', altCode: 'OLD TEST' })
    const request = client.requestList[0]
    expect(request?.user).toContain('OLD TEST')
    expect(request?.user).toContain('Mocha')
    expect(request?.user).toContain('edge cases')
    expect(request?.user).not.toContain('unit tests')
    expect(request?.format.schema).toMatchObject({ type: 'object' })
  })

  it('makes one call per file', async () => {
    const { analyzer, client } = build((_request, _signal, call) => replyOf({ code: `NEW ${call}` }))

    const result = await analyzer.regenerateTest([file, { ...file, id: 'rev-1-t2' }], undefined, context)

    expect(result.map((item) => item.code)).toEqual(['NEW 1', 'NEW 2'])
    expect(client.requestList).toHaveLength(2)
  })

  it('maps provider failures, refusals, invalid answers and its own deadline', async () => {
    expect(await failureOf(build(() => { throw sdkError(429) }).analyzer.regenerateTest([file], undefined, context))).toBe('ai_rate_limited')
    expect(await failureOf(build(() => { throw sdkError(500) }).analyzer.regenerateTest([file], undefined, context))).toBe('ai_unavailable')
    expect(await failureOf(build(() => replyOf('', { stopReason: 'refusal' })).analyzer.regenerateTest([file], undefined, context))).toBe('ai_refused')
    expect(await failureOf(build(() => replyOf({ nope: 1 })).analyzer.regenerateTest([file], undefined, context))).toBe('ai_invalid_output')
    expect(await failureOf(build((_request, signal) => never(signal), { regenerateDeadlineMs: 25 }).analyzer.regenerateTest([file], undefined, context))).toBe('ai_timeout')
  })

  it('has no code to base a test on without a context', async () => {
    const { analyzer, client } = build(() => replyOf({ code: 'NEW' }))

    expect(await failureOf(analyzer.regenerateTest([file]))).toBe('internal')
    expect(client.requestList).toHaveLength(0)
  })
})

// The real SDK client over a fake `fetch`: its own retry loop and request, with no network.
describe('Anthropic SDK client (fake fetch)', () => {
  function jsonResponse(status: number): Response {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'x' } }), {
      status,
      headers: { 'content-type': 'application/json', 'retry-after-ms': '1', 'request-id': 'req_err' }
    })
  }

  function request() {
    return { model: 'claude-test-model', maxToken: 100, effort: 'medium' as const, system: 'S', user: 'U', format: { type: 'json_schema' as const, schema: { type: 'object' } } }
  }

  async function callsFor(status: number, maxRetry = 2) {
    let count = 0
    const client = createAnthropicClient({
      apiKey: canaryKey,
      maxRetry,
      fetch: (() => { count += 1; return Promise.resolve(jsonResponse(status)) }) as typeof fetch
    })
    const reason = await createClaudeAnalyzer({ client, model: 'm', logger: captureLog() }).analyze(input).catch((error: unknown) => (error as AnalyzerError).reason)
    return { count, reason }
  }

  it('retries transient errors (429, 500, 529) at most maxRetries times', async () => {
    expect(await callsFor(429)).toEqual({ count: 3, reason: 'ai_rate_limited' })
    expect(await callsFor(500)).toEqual({ count: 3, reason: 'ai_unavailable' })
    expect(await callsFor(529)).toEqual({ count: 3, reason: 'ai_unavailable' })
    expect(await callsFor(529, 0)).toEqual({ count: 1, reason: 'ai_unavailable' })
  })

  it('never retries 400, 401, 403 or 404', async () => {
    expect(await callsFor(400)).toEqual({ count: 1, reason: 'internal' })
    expect(await callsFor(401)).toEqual({ count: 1, reason: 'ai_unavailable' })
    expect(await callsFor(403)).toEqual({ count: 1, reason: 'ai_unavailable' })
    expect(await callsFor(404)).toEqual({ count: 1, reason: 'internal' })
  })

  it('streams one call with the system prompt cached and collects the final message', async () => {
    const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    const body = [
      event('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4 } } }),
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '{"a":' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '1}' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } }),
      event('message_stop', {})
    ].join('')
    let sent: { url: string, headers: Headers, body: Record<string, unknown> } | undefined
    const client = createAnthropicClient({
      apiKey: canaryKey,
      fetch: ((url: string, init: RequestInit) => {
        sent = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> }
        return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_ok' } }))
      }) as typeof fetch
    })

    const reply = await client.complete(request(), { signal: new AbortController().signal })

    expect(reply).toMatchObject({ stopReason: 'end_turn', text: '{"a":1}', inputToken: 10, outputToken: 7, cacheReadToken: 4, requestId: 'req_ok' })
    expect(sent?.url).toContain('/v1/messages')
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${canaryKey}`)
    expect(sent?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(sent?.body).toMatchObject({
      model: 'claude-test-model',
      max_tokens: 100,
      stream: true,
      fallbacks: 'default',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'U' }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } }
    })
  })
})
