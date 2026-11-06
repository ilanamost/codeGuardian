import { describe, expect, it } from 'vitest'
import { createAnalyzer } from '../src/analyzer/create-analyzer.js'
import type { ClaudeClient } from '../src/analyzer/claude-client.js'
import { loadConfig } from '../src/config.js'
import { captureLog, createFakeClaude, replyOf, validAnalysis } from './helper/fake-claude.js'

const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }
const input = { reviewId: 'r', title: 't', language: 'TypeScript', content: 'a' }

describe('createAnalyzer (plan 039, Open Question 2)', () => {
  it('with a key it builds the provider client with that key and returns the Claude analyzer', async () => {
    const keyList: string[] = []
    const fake = createFakeClaude(() => replyOf(validAnalysis))
    const analyzer = createAnalyzer(loadConfig({ ...required, ANTHROPIC_API_KEY: ' key-value ' }), {
      createClient: (key): ClaudeClient => { keyList.push(key); return fake },
      logger: captureLog()
    })

    expect(analyzer.kind).toBe('claude')
    expect(keyList).toEqual(['key-value'])
    await analyzer.analyze(input)
    expect(fake.requestList[0]?.model).toBe('claude-sonnet-5-5')
  })

  it('uses ANTHROPIC_MODEL when set', async () => {
    const fake = createFakeClaude(() => replyOf(validAnalysis))
    const analyzer = createAnalyzer(loadConfig({ ...required, ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-opus-5-5' }), { createClient: () => fake, logger: captureLog() })

    await analyzer.analyze(input)

    expect(fake.requestList[0]?.model).toBe('claude-opus-5-5')
  })

  it('without a key (unset or blank) it returns the stub and never builds the provider client', () => {
    let built = 0
    const createClient = (): ClaudeClient => { built += 1; return createFakeClaude(() => replyOf(validAnalysis)) }

    for (const environment of [required, { ...required, ANTHROPIC_API_KEY: '' }, { ...required, ANTHROPIC_API_KEY: '   ' }]) {
      const analyzer = createAnalyzer(loadConfig(environment), { createClient })
      expect(analyzer.kind).toBe('stub')
    }
    expect(built).toBe(0)
  })
})
