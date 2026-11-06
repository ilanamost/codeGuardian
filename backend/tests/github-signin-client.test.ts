import { describe, expect, it } from 'vitest'
import { loadConfig, loadConfigOrExit } from '../src/config.js'
import type { FetchLike } from '../src/lib/github-fetch.js'
import { createGithubSignInClient, GithubSignInError } from '../src/lib/github-signin-client.js'
import { challengeOf, newSignIn, parseSignInState, safeReturnTo, SignInMode, stateMatches } from '../src/lib/github-signin-state.js'
import { jsonResponse } from './helper/github.js'

// Plan 040: the pieces under the routes. The client runs over an injected fetch (never the
// network), the state helpers are pure, and the config rules are the all-or-none rule.

const secret = 'canary-client-secret-7f3a'

function clientOf(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const callList: { url: string, init: RequestInit }[] = []
  const fetch: FetchLike = async (url, init) => {
    callList.push({ url, init })
    return handler(new URL(url), init)
  }
  const client = createGithubSignInClient({ fetch, clientId: 'cid', clientSecret: secret, redirectUrl: 'http://localhost:3001/api/auth/github/callback' })
  return { client, callList }
}

describe('GithubSignInClient.exchangeCode', () => {
  it('posts the code and the verifier to the fixed token URL, without following redirects, and returns the token', async () => {
    const { client, callList } = clientOf(() => jsonResponse({ access_token: 'tok-123', token_type: 'bearer', scope: 'read:user' }))

    const token = await client.exchangeCode('the-code', 'the-verifier')

    expect(token).toBe('tok-123')
    expect(callList).toHaveLength(1)
    expect(callList[0]?.url).toBe('https://github.com/login/oauth/access_token')
    expect(callList[0]?.init.method).toBe('POST')
    expect(callList[0]?.init.redirect).toBe('manual')
    expect(JSON.parse(String(callList[0]?.init.body))).toEqual({
      client_id: 'cid', client_secret: secret, code: 'the-code', redirect_uri: 'http://localhost:3001/api/auth/github/callback', code_verifier: 'the-verifier'
    })
  })

  it('fails with one fixed error for a GitHub error answer, a redirect, a non-JSON body, a bad status, an oversize body or a network failure', async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => jsonResponse({ error: 'bad_verification_code', error_description: 'tok-leak' }),
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
      () => new Response('<html>no</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => jsonResponse({ access_token: 'x' }, 500),
      () => jsonResponse({ access_token: 'x'.repeat(300_000) }),
      () => jsonResponse({ access_token: '' }),
      () => { throw new TypeError(`connect ECONNREFUSED ${secret}`) }
    ]

    for (const answer of answers) {
      const { client } = clientOf(answer)
      const error = await client.exchangeCode('c', 'v').then(() => undefined, (reason: unknown) => reason)
      expect(error).toBeInstanceOf(GithubSignInError)
      expect(String((error as Error).message)).toBe('GitHub sign-in failed.')
    }
  })
})

describe('GithubSignInClient.fetchProfile', () => {
  const emailAnswer = (list: unknown) => (url: URL) => url.pathname === '/user/emails' ? jsonResponse(list) : jsonResponse({ id: 583231, login: 'octocat', name: 'The Octocat', email: 'public@example.com', avatar_url: 'https://x' })

  it('reads the user and the emails with the bearer token, and keeps only the verified primary email', async () => {
    const { client, callList } = clientOf(emailAnswer([
      { email: 'old@example.com', primary: false, verified: true },
      { email: 'main@example.com', primary: true, verified: true }
    ]))

    const profile = await client.fetchProfile('tok-123')

    expect(profile).toEqual({ id: '583231', login: 'octocat', name: 'The Octocat', email: 'main@example.com', emailVerified: true })
    expect(callList.map((call) => call.url)).toEqual(['https://api.github.com/user', 'https://api.github.com/user/emails'])
    for (const call of callList) expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer tok-123')
  })

  it('an unverified primary email is no email: emailVerified false, and the public profile email is never used', async () => {
    const { client } = clientOf(emailAnswer([{ email: 'main@example.com', primary: true, verified: false }]))

    expect(await client.fetchProfile('t')).toEqual({ id: '583231', login: 'octocat', name: 'The Octocat', email: null, emailVerified: false })
  })

  it('rejects a user with a bad id or login, and any failed call', async () => {
    const bad: (() => Response)[] = [
      () => jsonResponse({ id: 'abc', login: 'octocat' }),
      () => jsonResponse({ id: 1.5, login: 'octocat' }),
      () => jsonResponse({ id: 5, login: 'bad login!' }),
      () => jsonResponse({ id: 5, login: '../../x' }),
      () => jsonResponse({ message: 'Bad credentials' }, 401)
    ]
    for (const answer of bad) {
      const { client } = clientOf(answer)
      await expect(client.fetchProfile('t')).rejects.toBeInstanceOf(GithubSignInError)
    }
    const failedEmail = clientOf((url) => url.pathname === '/user/emails' ? jsonResponse({ message: 'forbidden' }, 403) : jsonResponse({ id: 5, login: 'octocat' }))
    await expect(failedEmail.client.fetchProfile('t')).rejects.toBeInstanceOf(GithubSignInError)
  })

  it('never puts the token in an error message', async () => {
    const { client } = clientOf(() => { throw new TypeError('socket hang up tok-secret-token') })

    const error = await client.fetchProfile('tok-secret-token').then(() => undefined, (reason: unknown) => reason)

    expect((error as Error).message).not.toContain('tok-secret-token')
  })
})

describe('state and PKCE helpers', () => {
  it('make random state and verifier, and the challenge is S256 of the verifier', () => {
    const first = newSignIn(SignInMode.SignIn, undefined)
    const second = newSignIn(SignInMode.SignIn, undefined)
    const parsed = parseSignInState(first.cookieValue)

    expect(first.state).not.toBe(second.state)
    expect(parsed?.state).toBe(first.state)
    expect(parsed?.mode).toBe('signin')
    expect(first.challenge).toBe(challengeOf(parsed?.verifier ?? ''))
    // The RFC 7636 example: verifier dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk gives E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM.
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('compares the state in constant time and without throwing on a different length', () => {
    expect(stateMatches('abc', 'abc')).toBe(true)
    expect(stateMatches('abc', 'abd')).toBe(false)
    expect(stateMatches('abc', 'abcd')).toBe(false)
    expect(stateMatches('abc', undefined)).toBe(false)
    expect(stateMatches('abc', '')).toBe(false)
  })

  it('refuses a cookie that is not exactly what newSignIn makes', () => {
    const good = Buffer.from(JSON.stringify({ s: 'A'.repeat(43), v: 'B'.repeat(43), m: 'link' })).toString('base64url')
    const bad = [undefined, '', 'x', 'x'.repeat(5000), Buffer.from('[]').toString('base64url'),
      Buffer.from(JSON.stringify({ s: 'short', v: 'B'.repeat(43), m: 'link' })).toString('base64url'),
      Buffer.from(JSON.stringify({ s: 'A'.repeat(43), v: 'B'.repeat(43), m: 'admin' })).toString('base64url')]

    expect(parseSignInState(good)?.mode).toBe('link')
    for (const value of bad) expect(parseSignInState(value), String(value)).toBeUndefined()
  })

  it('returnTo: only a relative app path survives', () => {
    for (const value of ['/', '/history', '/review/abc-1?tab=2#x']) expect(safeReturnTo(value)).toBe(value)
    for (const value of [undefined, null, 5, '', 'history', '//evil.example', '/\\evil.example', 'https://evil.example', '/a\tb', '/a\u0000b', '/a b', ` /x`, `/${'a'.repeat(512)}`]) {
      expect(safeReturnTo(value), String(value)).toBeUndefined()
    }
  })
})

describe('GITHUB_OAUTH_* settings (config)', () => {
  const required = { PORT: '4000', FRONTEND_URL: 'https://app.example.com' }
  const full = { GITHUB_OAUTH_CLIENT_ID: 'cid', GITHUB_OAUTH_CLIENT_SECRET: secret, GITHUB_OAUTH_REDIRECT_URL: 'http://localhost:3001/api/auth/github/callback' }

  it('all three blank or unset means the feature is off', () => {
    expect(loadConfig(required).githubOAuth).toBeUndefined()
    expect(loadConfig({ ...required, GITHUB_OAUTH_CLIENT_ID: '', GITHUB_OAUTH_CLIENT_SECRET: '  ', GITHUB_OAUTH_REDIRECT_URL: '' }).githubOAuth).toBeUndefined()
  })

  it('all three set means configured, trimmed', () => {
    expect(loadConfig({ ...required, ...full, GITHUB_OAUTH_CLIENT_ID: ' cid ' }).githubOAuth).toEqual({ clientId: 'cid', clientSecret: secret, redirectUrl: full.GITHUB_OAUTH_REDIRECT_URL })
  })

  it('one or two set stops the server; the message names the settings and holds no value', () => {
    const subsets = [['GITHUB_OAUTH_CLIENT_ID'], ['GITHUB_OAUTH_CLIENT_SECRET'], ['GITHUB_OAUTH_REDIRECT_URL'], ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET']]
    for (const names of subsets) {
      const environment = { ...required, ...Object.fromEntries(names.map((name) => [name, full[name as keyof typeof full]])) }
      let message = ''
      try {
        loadConfig(environment)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message, names.join()).toMatch(/GITHUB_OAUTH_CLIENT_ID.*GITHUB_OAUTH_CLIENT_SECRET.*GITHUB_OAUTH_REDIRECT_URL/)
      expect(message).not.toContain(secret)
      expect(message).not.toContain('localhost:3001')
    }
  })

  it('the startup line for a partial setting names the settings and never a value', () => {
    const lines: string[] = []
    const sink = { error: (line: string) => void lines.push(line), exit: (code: number): never => { throw new Error(`exit ${code}`) } }

    expect(() => loadConfigOrExit({ ...required, GITHUB_OAUTH_CLIENT_SECRET: secret }, sink)).toThrow('exit 1')

    expect(lines.join()).toContain('GITHUB_OAUTH_CLIENT_ID')
    expect(lines.join()).not.toContain(secret)
  })

  it('a redirect URL that is not http or https stops the server without echoing it', () => {
    for (const url of ['not a url', 'javascript:alert(1)', 'ftp://example.com/cb']) {
      let message = ''
      try {
        loadConfig({ ...required, ...full, GITHUB_OAUTH_REDIRECT_URL: url })
      } catch (error) {
        message = (error as Error).message
      }
      expect(message, url).toMatch(/GITHUB_OAUTH_REDIRECT_URL must be an http or https URL/)
      expect(message).not.toContain(url)
      expect(message).not.toContain(secret)
    }
  })

  it('GITHUB_OAUTH_FAKE is a strict test-only flag, off by default', () => {
    expect(loadConfig(required).githubOAuthFake).toBe(false)
    expect(loadConfig({ ...required, GITHUB_OAUTH_FAKE: 'true' }).githubOAuthFake).toBe(true)
    expect(() => loadConfig({ ...required, GITHUB_OAUTH_FAKE: 'yes' })).toThrow(/GITHUB_OAUTH_FAKE/)
  })
})
