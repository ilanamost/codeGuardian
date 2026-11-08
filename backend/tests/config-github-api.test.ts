import { describe, expect, it } from 'vitest'
import { loadConfig, loadConfigOrExit } from '../src/config.js'

// Plan 049: GITHUB_API_TOKEN and TRUST_PROXY.

const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }
const canary = 'ghp_CONFIG_CANARY_TOKEN_049'

function message(environment: Record<string, string | undefined>): string {
  try {
    loadConfig(environment)
  } catch (error) {
    return String(error)
  }
  return ''
}

describe('loadConfig GITHUB_API_TOKEN (plan 049)', () => {
  it('is optional: unset, blank and whitespace all mean no token', () => {
    expect(loadConfig(required).githubApiToken).toBeUndefined()
    expect(loadConfig({ ...required, GITHUB_API_TOKEN: '' }).githubApiToken).toBeUndefined()
    expect(loadConfig({ ...required, GITHUB_API_TOKEN: ' \t\n ' }).githubApiToken).toBeUndefined()
  })

  it('is trimmed', () => {
    expect(loadConfig({ ...required, GITHUB_API_TOKEN: `  ${canary}\n` }).githubApiToken).toBe(canary)
  })

  it('never appears in a config error', () => {
    for (const environment of [
      { GITHUB_API_TOKEN: canary },
      { ...required, PORT: 'abc', GITHUB_API_TOKEN: canary },
      { ...required, TRUST_PROXY: 'abc', GITHUB_API_TOKEN: canary },
      { ...required, GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_API_TOKEN: canary }
    ]) {
      const text = message(environment)
      expect(text).not.toBe('')
      expect(text).not.toContain(canary)
    }
  })

  it('never appears in the start-up log line of a bad configuration', () => {
    const lineList: string[] = []

    expect(() => loadConfigOrExit({ ...required, TRUST_PROXY: 'abc', GITHUB_API_TOKEN: canary }, {
      error: (line) => { lineList.push(line) },
      exit: () => { throw new Error('exit') }
    })).toThrow('exit')

    expect(lineList).toHaveLength(1)
    expect(lineList[0]).toContain('TRUST_PROXY')
    expect(lineList[0]).not.toContain(canary)
  })
})

describe('loadConfig TRUST_PROXY (plan 049)', () => {
  it('is off when unset, blank or 0', () => {
    expect(loadConfig(required).trustProxy).toBe(0)
    expect(loadConfig({ ...required, TRUST_PROXY: '' }).trustProxy).toBe(0)
    expect(loadConfig({ ...required, TRUST_PROXY: '  ' }).trustProxy).toBe(0)
    expect(loadConfig({ ...required, TRUST_PROXY: '0' }).trustProxy).toBe(0)
  })

  it.each([['1', 1], ['2', 2], [' 1 ', 1]])('accepts %j as %d hops', (value, hops) => {
    expect(loadConfig({ ...required, TRUST_PROXY: value }).trustProxy).toBe(hops)
  })

  it.each(['-1', 'abc', '1.5', 'true', '1e1', '0x1', '+1', '1 2'])('rejects %j with a message that names the setting only', (value) => {
    const text = message({ ...required, TRUST_PROXY: value })

    expect(text).toContain('TRUST_PROXY')
    expect(text).toMatch(/whole number/)
    expect(text.replace('TRUST_PROXY', '')).not.toContain(value)
  })
})
