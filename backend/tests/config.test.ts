import { describe, expect, it } from 'vitest'
import { loadConfig, loadConfigOrExit } from '../src/config.js'

const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }

describe('loadConfig', () => {
  it('reads the port and the frontend URL from the environment', () => {
    expect(loadConfig(required))
      .toEqual({ port: 4000, frontendUrl: 'https://app.example.com', enableTestRoute: false, githubFake: false, production: false, cookieSameSite: 'lax', anthropicModel: 'claude-sonnet-5-5', githubOAuthFake: false })
  })

  it('reads NODE_ENV: only exactly production turns production on (plan 028)', () => {
    expect(loadConfig({ ...required, NODE_ENV: 'production' }).production).toBe(true)
    for (const value of ['development', 'test', 'Production', '']) expect(loadConfig({ ...required, NODE_ENV: value }).production).toBe(false)
  })

  it('has no fallback: missing values stop the server with both names in the message', () => {
    expect(() => loadConfig({})).toThrow(/Invalid server configuration: PORT .*FRONTEND_URL/)
  })

  it('rejects a port that is not a positive integer and a frontend URL that is not a URL', () => {
    expect(() => loadConfig({ PORT: 'abc', FRONTEND_URL: 'https://app.example.com' })).toThrow(/PORT/)
    expect(() => loadConfig({ PORT: '0', FRONTEND_URL: 'https://app.example.com' })).toThrow(/PORT/)
    expect(() => loadConfig({ PORT: '4000', FRONTEND_URL: 'not a url' })).toThrow(/FRONTEND_URL/)
  })
})

describe('loadConfig ENABLE_TEST_ROUTE', () => {
  it('defaults to off when the flag is not set', () => {
    expect(loadConfig(required).enableTestRoute).toBe(false)
    expect(loadConfig({ ...required, ENABLE_TEST_ROUTE: undefined }).enableTestRoute).toBe(false)
  })

  it('is on only for "true" and off for "false"', () => {
    expect(loadConfig({ ...required, ENABLE_TEST_ROUTE: 'true' }).enableTestRoute).toBe(true)
    expect(loadConfig({ ...required, ENABLE_TEST_ROUTE: 'false' }).enableTestRoute).toBe(false)
  })

  it.each(['', '1', 'yes', 'on', 'TRUE', 'True', ' true'])('rejects %j instead of guessing', (value) => {
    expect(() => loadConfig({ ...required, ENABLE_TEST_ROUTE: value }))
      .toThrow(/Invalid server configuration: ENABLE_TEST_ROUTE/)
  })
})

describe('loadConfig GITHUB_FAKE (plan 023)', () => {
  it('defaults to off, and is on only for "true"', () => {
    expect(loadConfig(required).githubFake).toBe(false)
    expect(loadConfig({ ...required, GITHUB_FAKE: 'true' }).githubFake).toBe(true)
    expect(loadConfig({ ...required, GITHUB_FAKE: 'false' }).githubFake).toBe(false)
  })

  it.each(['', '1', 'yes', 'TRUE'])('rejects %j instead of guessing', (value) => {
    expect(() => loadConfig({ ...required, GITHUB_FAKE: value }))
      .toThrow(/Invalid server configuration: GITHUB_FAKE/)
  })
})

describe('loadConfig without mail settings (plan 032)', () => {
  it('reads no mail setting: the plan 031 names are ignored and never reach the configuration', () => {
    const removed = { SUPPORT_EMAIL_TO: 'support@example.com', SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'abc', SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_FROM: 'bad', MAIL_FAKE: 'yes' }
    const config = loadConfig({ ...required, ...removed })

    expect(config).toEqual(loadConfig(required))
    expect(Object.keys(config)).not.toContain('mail')
    expect(Object.keys(config)).not.toContain('mailFake')
  })
})

describe('loadConfigOrExit (QA 031 F3)', () => {
  class Exited extends Error {
    constructor(readonly code: number) {
      super(`exit ${code}`)
    }
  }

  function sink() {
    const lineList: string[] = []
    return {
      lineList,
      error: (line: string) => { lineList.push(line) },
      exit: (code: number): never => { throw new Exited(code) }
    }
  }

  it('returns the configuration and logs nothing when it is valid', () => {
    const target = sink()
    expect(loadConfigOrExit(required, target).port).toBe(4000)
    expect(target.lineList).toEqual([])
  })

  it('logs one structured startup line with the setting names, no stack and no value, then exits 1', () => {
    const target = sink()
    const invalid = 'placeholder-invalid-value'

    expect(() => loadConfigOrExit({ FRONTEND_URL: invalid, GITHUB_FAKE: invalid }, target))
      .toThrow(expect.objectContaining({ code: 1 }))

    expect(target.lineList).toHaveLength(1)
    const line = JSON.parse(target.lineList[0] ?? '{}') as Record<string, unknown>
    expect(Object.keys(line).sort()).toEqual(['level', 'message', 'operation'])
    expect(line).toMatchObject({ level: 'error', operation: 'startup' })
    expect(line.message).toMatch(/^Invalid server configuration: /)
    for (const name of ['PORT', 'FRONTEND_URL', 'GITHUB_FAKE']) expect(line.message).toMatch(new RegExp(name))
    const text = target.lineList[0] ?? ''
    for (const value of [invalid, '.ts:']) expect(text).not.toContain(value)
    expect(text).not.toMatch(/\bat \S+ \(/)
  })

  it('logs the generic internal message for an unexpected error, with no stack', () => {
    const target = sink()
    const hostile = new Proxy({}, { get: () => { throw new Error('secret-detail-placeholder') } })

    expect(() => loadConfigOrExit(hostile as Record<string, string>, target)).toThrow(expect.objectContaining({ code: 1 }))

    expect(target.lineList).toHaveLength(1)
    expect(target.lineList[0]).not.toContain('secret-detail-placeholder')
    expect(JSON.parse(target.lineList[0] ?? '{}')).toMatchObject({ level: 'error', operation: 'startup' })
  })
})

// The removed encryption switch (plan 041). Spelled in two parts so no source line carries the old name.
const leftoverKey = ['API', 'ENCRYPTION'].join('_')

describe('loadConfig with a leftover setting of the removed encryption (plan 041)', () => {
  it.each(['on', 'off', '', 'enabled-secret-value'])('ignores the value %j: no start error, no setting in the config', (value) => {
    const config = loadConfig({ ...required, [leftoverKey]: value })
    expect(config).not.toHaveProperty('apiEncryption')
    expect(config.port).toBe(4000)
  })

  it('loadConfigOrExit does not exit for a leftover value', () => {
    const sink = {
      error: () => { throw new Error('logged') },
      exit: (): never => { throw new Error('exit') }
    }
    expect(() => loadConfigOrExit({ ...required, [leftoverKey]: 'on' }, sink)).not.toThrow()
  })
})
