import Anthropic from '@anthropic-ai/sdk'
import type { OutputFormat } from '../schema/analyzer.schema.js'
import { LIMIT } from '../utils/limits.js'

// The one thing the Claude analyzer needs from the Anthropic SDK (plan 039): a single streamed
// Messages API call, collected into a final answer. Tests inject a fake of this interface, so no
// test ever reaches the real API.

export type ClaudeRequest = {
  model: string
  maxToken: number
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // Byte-stable, so it is prompt-cached.
  system: string
  user: string
  format: OutputFormat
}

export type ClaudeReply = {
  // `end_turn`, `max_tokens`, `refusal`, ...
  stopReason: string | null
  // The text blocks of the answer, joined.
  text: string
  inputToken: number
  outputToken: number
  cacheReadToken: number
  // The Anthropic `request-id` header, for support.
  requestId: string | null
}

export interface ClaudeClient {
  complete(request: ClaudeRequest, option: { signal: AbortSignal }): Promise<ClaudeReply>
}

export type AnthropicClientOption = {
  apiKey: string
  timeoutMs?: number
  maxRetry?: number
  // Only for tests of the SDK's own retries: a fake `fetch`, so nothing leaves the machine.
  fetch?: typeof globalThis.fetch
}

// The beta that turns on the server-side refusal fallback for models that support it (the
// request runs on the requested model alone on a model that does not).
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// The real client. The key is passed explicitly, so the SDK never falls back to other
// credentials on the machine; this is only ever built when a key is configured.
export function createAnthropicClient(option: AnthropicClientOption): ClaudeClient {
  const sdk = new Anthropic({
    apiKey: option.apiKey,
    timeout: option.timeoutMs ?? LIMIT.analyzer.callTimeoutMs,
    maxRetries: option.maxRetry ?? LIMIT.analyzer.maxRetry,
    ...(option.fetch ? { fetch: option.fetch } : {})
  })

  return {
    async complete(request, { signal }) {
      const stream = sdk.beta.messages.stream({
        model: request.model,
        max_tokens: request.maxToken,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.user }],
        output_config: { effort: request.effort, format: request.format },
        fallbacks: 'default',
        betas: [FALLBACK_BETA]
      }, { signal })
      const message = await stream.finalMessage()
      return {
        stopReason: message.stop_reason,
        text: message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
        inputToken: message.usage.input_tokens,
        outputToken: message.usage.output_tokens,
        cacheReadToken: message.usage.cache_read_input_tokens ?? 0,
        requestId: stream.request_id ?? null
      }
    }
  }
}
