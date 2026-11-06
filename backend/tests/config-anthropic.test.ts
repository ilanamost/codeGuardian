import { describe, expect, it } from 'vitest'
import { loadConfig, loadConfigOrExit } from '../src/config.js'

const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }
const canary = 'TESTKEY-CONFIG-CANARY-123'

describe('loadConfig ANTHROPIC_API_KEY and ANTHROPIC_MODEL (plan 039)', () => {
  it('the key is optional: unset and blank both mean not configured', () => {
    expect(loadConfig(required).anthropicApiKey).toBeUndefined()
    expect(loadConfig({ ...required, ANTHROPIC_API_KEY: '' }).anthropicApiKey).toBeUndefined()
    expect(loadConfig({ ...required, ANTHROPIC_API_KEY: '   ' }).anthropicApiKey).toBeUndefined()
  })

  it('the key is trimmed', () => {
    expect(loadConfig({ ...required, ANTHROPIC_API_KEY: `  ${canary}\n` }).anthropicApiKey).toBe(canary)
  })

  it('the model defaults to claude-sonnet-5-5 and ANTHROPIC_MODEL overrides it', () => {
    expect(loadConfig(required).anthropicModel).toBe('claude-sonnet-5-5')
    expect(loadConfig({ ...required, ANTHROPIC_MODEL: '' }).anthropicModel).toBe('claude-sonnet-5-5')
    expect(loadConfig({ ...required, ANTHROPIC_MODEL: ' claude-opus-5-5 ' }).anthropicModel).toBe('claude-opus-5-5')
  })

  it('a model that is not a model id names the setting, never the value', () => {
    const bad = 'not a model; drop table'

    expect(() => loadConfig({ ...required, ANTHROPIC_MODEL: bad })).toThrow(/ANTHROPIC_MODEL must be a model id/)
    expect(() => loadConfig({ ...required, ANTHROPIC_MODEL: bad })).not.toThrow(/drop table/)
  })

  it('no config error contains the key', () => {
    for (const environment of [{ ANTHROPIC_API_KEY: canary }, { ...required, PORT: 'abc', ANTHROPIC_API_KEY: canary }, { ...required, ANTHROPIC_MODEL: '!', ANTHROPIC_API_KEY: canary }]) {
      let message = ''
      try {
        loadConfig(environment)
      } catch (error) {
        message = String(error)
      }
      expect(message).not.toBe('')
      expect(message).not.toContain(canary)
    }
  })

  it('the start-up log line for a bad configuration never contains the key', () => {
    const lineList: string[] = []

    expect(() => loadConfigOrExit({ ANTHROPIC_API_KEY: canary }, {
      error: (line) => { lineList.push(line) },
      exit: () => { throw new Error('exit') }
    })).toThrow('exit')

    expect(lineList).toHaveLength(1)
    expect(lineList[0]).not.toContain(canary)
  })
})
