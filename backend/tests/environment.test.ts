import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { loadConfig, loadConfigOrExit } from '../src/config.js'
import { loadEnvironment } from '../src/lib/env-file.js'
import { createFakeGithubSignInClient } from '../src/lib/github-signin-fake.js'
import { createMemoryStore } from '../src/store/memory-store.js'
import { demoPassword, demoUsername, frontendUrl, newAgent } from './helper/app.js'

// Plan 042: env file layering, COOKIE_SAMESITE validation and the cookie attributes. The env file
// tests use an in-memory file table and a neutral base name, so no real env file is touched.

const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }
const baseName = 'base-env-file'
const directory = '/backend'
const oauth = { clientId: 'test-client-id', clientSecret: 'canary-client-secret-7f3a', redirectUrl: 'http://localhost:3001/api/auth/github/callback' }
const quietLogger = { info: () => undefined, warn: () => undefined }

function files(table: Record<string, string>) {
  return (path: string) => table[path.replace(/\\/g, '/').replace(`${directory}/`, '')]
}

describe('loadEnvironment (plan 042)', () => {
  it('reads the base file alone when NODE_ENV is not set', () => {
    const result = loadEnvironment({ directory, baseName, environment: {}, read: files({ [baseName]: 'PORT=3001\nFRONTEND_URL=http://localhost:5173' }) })

    expect(result).toEqual({ PORT: '3001', FRONTEND_URL: 'http://localhost:5173' })
  })

  it('puts the NODE_ENV file on top of the base file', () => {
    const read = files({
      [baseName]: 'PORT=3001\nFRONTEND_URL=http://localhost:5173\nCOOKIE_SAMESITE=lax',
      [`${baseName}.production`]: 'FRONTEND_URL=https://user.github.io\nCOOKIE_SAMESITE=none'
    })

    const result = loadEnvironment({ directory, baseName, environment: { NODE_ENV: 'production' }, read })

    expect(result).toMatchObject({ PORT: '3001', FRONTEND_URL: 'https://user.github.io', COOKIE_SAMESITE: 'none', NODE_ENV: 'production' })
  })

  it('takes NODE_ENV from the base file when the process has none', () => {
    const read = files({ [baseName]: 'NODE_ENV=production\nPORT=1', [`${baseName}.production`]: 'PORT=2' })

    expect(loadEnvironment({ directory, baseName, environment: {}, read }).PORT).toBe('2')
  })

  it('lets real process variables win over both files, and skips undefined ones', () => {
    const read = files({ [baseName]: 'PORT=1\nFRONTEND_URL=http://a.example', [`${baseName}.production`]: 'PORT=2' })

    const result = loadEnvironment({ directory, baseName, environment: { NODE_ENV: 'production', PORT: '3', FRONTEND_URL: undefined }, read })

    expect(result.PORT).toBe('3')
    expect(result.FRONTEND_URL).toBe('http://a.example')
  })

  it('skips a missing file and ignores a NODE_ENV that is not a safe file name part', () => {
    const read = files({ [baseName]: 'PORT=1', [`${baseName}.../x`]: 'PORT=9' })

    expect(loadEnvironment({ directory, baseName, environment: { NODE_ENV: 'staging' }, read })).toEqual({ PORT: '1', NODE_ENV: 'staging' })
    expect(loadEnvironment({ directory, baseName, environment: { NODE_ENV: '../x' }, read }).PORT).toBe('1')
  })

  it('skips a missing file with the real reader', () => {
    expect(loadEnvironment({ directory: process.cwd(), baseName: 'no-such-env-file', environment: { PORT: '5' } })).toEqual({ PORT: '5' })
  })

  it('reports a read failure of the real reader as one startup line with a fixed message', () => {
    const lineList: string[] = []
    const sink = { error: (line: string) => void lineList.push(line), exit: (code: number): never => { throw new Error(`exit ${code}`) } }

    expect(() => loadConfigOrExit(() => loadEnvironment({ directory: process.cwd(), baseName: '', environment: {} }), sink)).toThrow('exit 1')
    expect(lineList).toHaveLength(1)
    expect(lineList[0]).toContain('A backend env file could not be read')
  })
})

describe('COOKIE_SAMESITE config (plan 042)', () => {
  it('defaults to lax when unset or blank', () => {
    expect(loadConfig(required).cookieSameSite).toBe('lax')
    expect(loadConfig({ ...required, COOKIE_SAMESITE: '  ' }).cookieSameSite).toBe('lax')
  })

  it('accepts lax and strict anywhere, and none in production', () => {
    expect(loadConfig({ ...required, COOKIE_SAMESITE: 'strict' }).cookieSameSite).toBe('strict')
    expect(loadConfig({ ...required, COOKIE_SAMESITE: 'lax', NODE_ENV: 'production' }).cookieSameSite).toBe('lax')
    expect(loadConfig({ ...required, COOKIE_SAMESITE: 'none', NODE_ENV: 'production' }).cookieSameSite).toBe('none')
  })

  it.each(['None', 'LAX', 'yes', 'lax; Secure', 'canary-value-91'])('rejects %j naming the variable and never the value', (value) => {
    let message = ''
    try {
      loadConfig({ ...required, COOKIE_SAMESITE: value })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/^Invalid server configuration: COOKIE_SAMESITE must be one of/)
    expect(message).not.toContain(value)
  })

  it.each([undefined, 'development', 'test', 'Production', ''])('refuses none when NODE_ENV is %j', (nodeEnv) => {
    expect(() => loadConfig({ ...required, COOKIE_SAMESITE: 'none', NODE_ENV: nodeEnv })).toThrow(/COOKIE_SAMESITE can use the none option only when NODE_ENV is production/)
  })

  it('stops the start with one line that names the variable', () => {
    const lineList: string[] = []
    const sink = { error: (line: string) => void lineList.push(line), exit: (code: number): never => { throw new Error(`exit ${code}`) } }

    expect(() => loadConfigOrExit({ ...required, COOKIE_SAMESITE: 'canary-value-91' }, sink)).toThrow('exit 1')
    expect(lineList).toHaveLength(1)
    expect(lineList[0]).toContain('COOKIE_SAMESITE')
    expect(lineList[0]).not.toContain('canary-value-91')
  })
})

describe('cookie attributes with COOKIE_SAMESITE (plan 042)', () => {
  function appWith(config: { production?: boolean, cookieSameSite?: 'lax' | 'strict' | 'none' }) {
    const table = { 'code-1': { id: '1', login: 'octocat', name: null, email: null, emailVerified: false } }
    return createApp(
      { frontendUrl, enableTestRoute: false, githubOAuth: oauth, ...config },
      { store: createMemoryStore(), securityLogger: quietLogger, githubSignInClient: createFakeGithubSignInClient(table) }
    )
  }

  async function cookieLines(app: ReturnType<typeof appWith>) {
    const session = await newAgent(app).post('/api/session').send({ username: demoUsername, password: demoPassword })
    const state = await request(app).get('/api/auth/github')
    return { session: (session.headers['set-cookie'] as unknown as string[])[0] ?? '', state: (state.headers['set-cookie'] as unknown as string[])[0] ?? '' }
  }

  it('production with none: SameSite=None; Secure; HttpOnly on the session and the sign-in state cookies', async () => {
    const { session, state } = await cookieLines(appWith({ production: true, cookieSameSite: 'none' }))

    expect(session).toMatch(/^__Host-cr_session=[A-Za-z0-9_-]{43}; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=None$/)
    expect(state).toMatch(/^__Host-cr_github_state=[A-Za-z0-9_-]+; Max-Age=600; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=None$/)
  })

  it('by default keeps the current attributes: SameSite=Lax, and Secure only in production', async () => {
    const development = await cookieLines(appWith({}))
    const production = await cookieLines(appWith({ production: true }))

    expect(development.session).toMatch(/; HttpOnly; SameSite=Lax$/)
    expect(development.state).toMatch(/; HttpOnly; SameSite=Lax$/)
    expect(development.session).not.toMatch(/Secure/)
    expect(production.session).toMatch(/; HttpOnly; Secure; SameSite=Lax$/)
    expect(production.state).toMatch(/; HttpOnly; Secure; SameSite=Lax$/)
  })

  it('strict is applied to both cookies', async () => {
    const { session, state } = await cookieLines(appWith({ cookieSameSite: 'strict' }))

    expect(session).toMatch(/SameSite=Strict$/)
    expect(state).toMatch(/SameSite=Strict$/)
  })

  it('keeps the Origin check against FRONTEND_URL when SameSite is none', async () => {
    const app = appWith({ production: true, cookieSameSite: 'none' })

    const response = await request(app).post('/api/session').set('Origin', 'https://evil.example').set('X-CSRF-Protection', '1').send({ username: demoUsername, password: demoPassword })

    expect(response.status).toBe(403)
    expect(response.headers['set-cookie']).toBeUndefined()
  })
})
