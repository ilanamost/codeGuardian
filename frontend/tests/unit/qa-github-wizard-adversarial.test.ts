// @vitest-environment node
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { createApiService } from '../../src/services/api.service'
import { createGithubService, type GithubService } from '../../src/services/github.service'
import { createSessionService } from '../../src/services/session.service'
import { createBackendStore, createCookieJar, DEMO_PASSWORD, DEMO_USERNAME } from '../utils/backendHarness'

// QA adversarial pass, plan 030: the real backend app in process, behind the frontend's own
// GitHub service, with a HOSTILE recording `fetch` in place of api.github.com. No network: every
// GitHub call lands in `callList` and is answered by the handler of the test.

type Call = { url: string; init: RequestInit | undefined }
type Handler = (url: URL, index: number) => Response | Promise<Response>
type BackendModule = {
  createApp: (config: { frontendUrl: string; enableTestRoute: boolean }, option?: object) => { listen: (port: number, host: string, done: () => void) => Server }
}
type ClientModule = { createGithubClient: (option: { fetch: unknown; callTimeoutMs?: number }) => unknown }

const backendSrc = resolve(__dirname, '../../../backend/src')
const host = '127.0.0.1'
const apiOrigin = 'https://api.github.com'
const metadataUrl = 'http://169.254.169.254/latest/meta-data'

let server: Server | undefined

// The first test pays for importing the backend app and the demo sign-in.
vi.setConfig({ testTimeout: 30_000 })

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()))
  server = undefined
})

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers }
  })
}

function contents(text: string, size = Buffer.byteLength(text)) {
  return json({ type: 'file', size, encoding: 'base64', content: Buffer.from(text).toString('base64'), download_url: metadataUrl, html_url: metadataUrl })
}

async function start(handler: Handler): Promise<{ github: GithubService; callList: Call[] }> {
  const callList: Call[] = []
  const fetchFn = async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    callList.push({ url: url.href, init })
    return handler(url, callList.length - 1)
  }
  const { createApp } = (await import(/* @vite-ignore */ resolve(backendSrc, 'app.ts'))) as BackendModule
  const { createGithubClient } = (await import(/* @vite-ignore */ resolve(backendSrc, 'lib/github-fetch.ts'))) as ClientModule
  const store = await createBackendStore()
  const app = createApp({ frontendUrl: 'http://localhost', enableTestRoute: false }, {
    store,
    githubClient: createGithubClient({ fetch: fetchFn, callTimeoutMs: 200 })
  })
  await new Promise<void>((done) => {
    server = app.listen(0, host, done)
  })
  const { port } = server!.address() as AddressInfo
  const source = createApiService({ baseUrl: `http://${host}:${port}`, fetchFn: createCookieJar().fetchFn })
  await createSessionService(source).signIn({ username: DEMO_USERNAME, password: DEMO_PASSWORD })
  return { github: createGithubService(source), callList }
}

async function failure(run: () => Promise<unknown>): Promise<{ status?: number; code: string; causeCode?: string }> {
  try {
    await run()
  } catch (error) {
    if (!AppError.is(error)) throw error
    return { status: error.status, code: error.code, causeCode: error.causeCode }
  }
  throw new Error('expected a failure')
}

function expectOnlyApiGithub(callList: Call[]) {
  for (const call of callList) {
    expect(new URL(call.url).origin).toBe(apiOrigin)
    expect(call.init?.redirect).toBe('manual')
    const header = new Headers(call.init?.headers)
    expect(header.has('authorization')).toBe(false)
    expect(header.has('cookie')).toBe(false)
  }
}

describe('QA adversarial (plan 030): hostile GitHub answers, through the real backend', () => {
  it('a 302 from GET /users to the metadata address is refused, not followed, and nothing is connected', async () => {
    const { github, callList } = await start(() => new Response(null, { status: 302, headers: { location: metadataUrl } }))

    expect(await failure(() => github.connect('octocat'))).toMatchObject({ status: 502 })
    expect(callList).toHaveLength(1)
    expectOnlyApiGithub(callList)
    // Nothing was stored: the repository route is still "not connected" and makes no call.
    expect(await failure(() => github.searchRepo(''))).toMatchObject({ status: 409 })
    expect(callList).toHaveLength(1)
  })

  it('a tree path that LOOKS like an escape (%2e%2e) stays text: its contents call stays under /repos/{login}/{repo}/contents', async () => {
    const tree = [{ path: '%2e%2e/%2e%2e/evil.ts', type: 'blob', size: 10, url: metadataUrl }]
    const { github, callList } = await start((url) => {
      if (url.pathname === '/users/octocat') return json({ login: 'octocat', name: null, avatar_url: metadataUrl })
      if (url.pathname === '/users/octocat/repos') return json([{ name: 'demo', description: null, html_url: metadataUrl, clone_url: metadataUrl }])
      if (url.pathname.includes('/git/trees/')) return json({ tree, truncated: false })
      return contents('const a = 1\n')
    })

    await github.connect('octocat')
    const [file] = (await github.listFile('demo')).items
    expect(file?.path).toBe('%2e%2e/%2e%2e/evil.ts')
    const fetched = await github.getFile('demo', file!.id)

    expect(fetched.content).toBe('const a = 1\n')
    const last = new URL(callList.at(-1)!.url)
    expect(last.pathname).toBe('/repos/octocat/demo/contents/%252e%252e/%252e%252e/evil.ts')
    expectOnlyApiGithub(callList)
    // No URL from any answer (avatar_url, html_url, clone_url, url, download_url) was ever fetched.
    expect(callList.some((call) => call.url.includes('169.254'))).toBe(false)
  })

  it('a tree whose Content-Length is over the cap is a 502 without reading the body', async () => {
    const { github } = await start((url) => {
      if (url.pathname === '/users/octocat') return json({ login: 'octocat' })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(50_000_000) } })
    })

    await github.connect('octocat')
    expect(await failure(() => github.listFile('demo'))).toMatchObject({ status: 502 })
  })

  it('a contents answer that lies about size (10) but carries 50 001 chars is a 413', async () => {
    const { github } = await start((url) => {
      if (url.pathname === '/users/octocat') return json({ login: 'octocat' })
      return contents('x'.repeat(50_001), 10)
    })

    await github.connect('octocat')
    expect(await failure(() => github.getFile('demo', Buffer.from('a.ts').toString('base64url')))).toMatchObject({ status: 413 })
  })

  it('a display name with control and bidi characters and 10 000 characters is cleaned and cut', async () => {
    const hostileName = `‮evil\u0000\u0007${'n'.repeat(10_000)}`
    const { github } = await start(() => json({ login: 'octocat', name: hostileName }))

    const account = await github.connect('octocat')

    expect(account.login).toBe('octocat')
    expect(account.name?.length).toBeLessThanOrEqual(255)
    expect([...(account.name ?? '')].some((char) => char.charCodeAt(0) < 0x20)).toBe(false)
  })

  it('a repository description with a lone surrogate never breaks the list', async () => {
    const { github } = await start((url) => {
      if (url.pathname === '/users/octocat') return json({ login: 'octocat' })
      return json([{ name: 'ok', description: 'bad \uD800 text' }, { name: 'fine', description: 'x'.repeat(5000) }])
    })

    await github.connect('octocat')
    const list = await github.searchRepo('')

    expect(list.items.map((repo) => repo.id)).toEqual(['ok', 'fine'])
    expect(list.items[0]?.description).toBe('')
    expect(list.items[1]?.description.length).toBeLessThanOrEqual(1000)
  })

  it('regex and wildcard characters in the search are plain text (no match, no error, one call each)', async () => {
    const { github, callList } = await start((url) => {
      if (url.pathname === '/users/octocat') return json({ login: 'octocat' })
      return json([{ name: 'demo', description: null }, { name: 'a.b', description: null }])
    })

    await github.connect('octocat')
    for (const query of ['.*', '%', '(', '\\', '[a-z]']) {
      expect((await github.searchRepo(query)).items).toEqual([])
    }
    expect((await github.searchRepo('.')).items.map((repo) => repo.id)).toEqual(['a.b'])
    expect(callList).toHaveLength(1 + 6)
  })

  it('20 rapid connects for alternating users all succeed and leave exactly one connection', async () => {
    const { github } = await start((url) => {
      const login = url.pathname.split('/')[2]
      if (url.pathname.endsWith('/repos')) return json([{ name: `${login}-repo`, description: null }])
      return json({ login, name: null })
    })

    const resultList = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => github.connect(index % 2 ? 'alice-gh' : 'bob-gh')))
    expect(resultList.every((result) => result.status === 'fulfilled')).toBe(true)

    const [repo] = (await github.searchRepo('')).items
    expect(['alice-gh-repo', 'bob-gh-repo']).toContain(repo?.id)
  })

  it('after Switch account, every repository route is 409 and makes no GitHub call', async () => {
    const { github, callList } = await start((url) => {
      if (url.pathname === '/users/octocat') return json({ login: 'octocat' })
      return json([])
    })

    await github.connect('octocat')
    await github.disconnect()
    const before = callList.length

    expect(await failure(() => github.searchRepo(''))).toMatchObject({ status: 409 })
    expect(await failure(() => github.listFile('demo'))).toMatchObject({ status: 409 })
    expect(await failure(() => github.getFile('demo', Buffer.from('a.ts').toString('base64url')))).toMatchObject({ status: 409 })
    expect(callList).toHaveLength(before)
  })

  it.each([
    ['a 10 000 character user name', 'x'.repeat(10_000)],
    ['a user name with a URL in it', 'octocat@169.254.169.254'],
    ['a user name with an encoded slash', 'octocat%2F..%2F..']
  ])('%s is 422 and never reaches GitHub', async (_label, username) => {
    const { github, callList } = await start(() => json({ login: 'x' }))

    expect(await failure(() => github.connect(username))).toMatchObject({ status: 422 })
    expect(callList).toEqual([])
  })
})
