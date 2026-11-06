import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import type { ClaudeClient, ClaudeReply, ClaudeRequest } from '../../src/analyzer/claude-client.js'
import type { AnalyzerLogger } from '../../src/analyzer/claude-analyzer.js'

// A fake of the one SDK call the Claude analyzer uses (plan 039). No test reaches the real API.

export const canaryKey = 'TESTKEY-CANARY-0000000000'
export const canaryCode = 'const CANARY_LINE_9f3a = "do-not-log-this-code"'

export type FakeHandler = (request: ClaudeRequest, signal: AbortSignal, call: number) => ClaudeReply | Promise<ClaudeReply>

export type FakeClaude = ClaudeClient & { requestList: ClaudeRequest[] }

export function createFakeClaude(handler: FakeHandler): FakeClaude {
  const requestList: ClaudeRequest[] = []
  return {
    requestList,
    async complete(request, { signal }) {
      requestList.push(request)
      return handler(request, signal, requestList.length)
    }
  }
}

export function replyOf(output: unknown, extra: Partial<ClaudeReply> = {}): ClaudeReply {
  return {
    stopReason: 'end_turn',
    text: typeof output === 'string' ? output : JSON.stringify(output),
    inputToken: 1200,
    outputToken: 340,
    cacheReadToken: 1000,
    requestId: 'req_test_123',
    ...extra
  }
}

export const validAnalysis = {
  finding: [
    { severity: 'critical', category: 'security', message: 'Use of eval', detail: 'eval runs arbitrary code.', line_start: 1 },
    { severity: 'medium', category: 'maintainability', message: 'Untyped value', detail: 'Type it.', line_start: 2 },
    { severity: 'low', category: 'readability', message: 'Long line', detail: 'Break it.', line_start: 2 }
  ],
  suggestion: [{ title: 'Replace eval', detail: 'Use a lookup table.' }],
  generatedTest: { code: "describe('x', () => { it('works', () => { expect(1).toBe(1) }) })\n" }
}

// A rejection that waits for the abort signal, like a provider call that never answers.
export function never(signal: AbortSignal): Promise<ClaudeReply> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new APIUserAbortError()))
  })
}

// SDK errors, built like the SDK builds them from an HTTP answer.
export function sdkError(status: number): APIError {
  return APIError.generate(status, { type: 'error', error: { type: 'x', message: `provider body ${canaryCode}` } }, `provider message ${canaryKey}`, new Headers())
}
export const connectionError = () => new APIConnectionError({ message: 'connection refused' })
export const connectionTimeout = () => new APIConnectionTimeoutError()

export type LogCapture = AnalyzerLogger & { lineList: string[] }

export function captureLog(): LogCapture {
  const lineList: string[] = []
  const push = (line: string) => { lineList.push(line) }
  return { lineList, info: push, warn: push, error: push }
}
