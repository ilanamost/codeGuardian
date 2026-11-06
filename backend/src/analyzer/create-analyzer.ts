import type { AppConfig } from '../config.js'
import type { Analyzer } from './analyzer.js'
import { createClaudeAnalyzer, type AnalyzerLogger } from './claude-analyzer.js'
import { createAnthropicClient, type ClaudeClient } from './claude-client.js'
import { createStubAnalyzer } from './stub-analyzer.js'

export type CreateAnalyzerOption = {
  // Builds the provider client; tests pass a fake that records whether it was called.
  createClient?: (apiKey: string) => ClaudeClient
  logger?: AnalyzerLogger
}

// Picks the analyzer at startup (plan 039, Open Question 2, answer A): the Claude analyzer when
// a key is configured, otherwise the stub. Without a key the SDK client is never constructed, so
// it can never fall back to other credentials on the machine.
export function createAnalyzer(config: Pick<AppConfig, 'anthropicApiKey' | 'anthropicModel'>, option: CreateAnalyzerOption = {}): Analyzer {
  const apiKey = config.anthropicApiKey
  if (!apiKey) return createStubAnalyzer()
  const client = (option.createClient ?? ((key) => createAnthropicClient({ apiKey: key })))(apiKey)
  return createClaudeAnalyzer({ client, model: config.anthropicModel, ...(option.logger ? { logger: option.logger } : {}) })
}
