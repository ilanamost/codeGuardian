import { expect } from 'vitest'
import { createFakeGithubFetch } from '../../src/lib/github-fake.js'
import { createGithubClient, type FetchLike, type GithubClientOption, type ImportBudget } from '../../src/lib/github-fetch.js'

// A fake GitHub for the client and route tests: no test touches the network (plan 023). Every
// call is recorded so a test can assert where the client went and that it stopped.

export const API = 'https://api.github.com'

export type FakeCall = { url: string, init: RequestInit }
export type FakeHandler = (url: URL, init: RequestInit, index: number) => Response | Promise<Response>

export function fakeGithub(handler: FakeHandler) {
  const callList: FakeCall[] = []
  const fetch: FetchLike = async (url, init) => {
    callList.push({ url, init })
    return handler(new URL(url), init, callList.length - 1)
  }
  const client = (option: Omit<GithubClientOption, 'fetch'> = {}) => createGithubClient({ fetch, ...option })
  return { fetch, callList, client }
}

export function jsonResponse(body: unknown, status = 200, header: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...header } })
}

// A contents API answer for a file; `size` defaults to the real byte length (a test can lie).
export function fileResponse(content: string | Uint8Array, option: { size?: number, extra?: Record<string, unknown> } = {}): Response {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
  // GitHub breaks the base64 text every 60 characters.
  const encoded = bytes.toString('base64').replace(/(.{60})/g, '$1\n')
  return jsonResponse({ type: 'file', size: option.size ?? bytes.byteLength, encoding: 'base64', content: encoded, ...option.extra })
}

// The e2e fake GitHub (`src/lib/github-fake.ts`) as a client: no network (plan 030).
export function fakeGithubClient() {
  return createGithubClient({ fetch: createFakeGithubFetch() })
}

// The fake GitHub user of plan 030.
export const fakeUser = 'example-user'

export function notFound(): Response {
  return jsonResponse({ message: 'Not Found' }, 404)
}

// Never settles and ignores its signal: only the client's own race can end the wait.
export function stall(): Promise<Response> {
  return new Promise<Response>(() => undefined)
}

export function delay<T>(ms: number, value: () => T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value()), ms))
}

export function budget(totalTimeoutMs = 30_000): ImportBudget {
  return { signal: AbortSignal.timeout(totalTimeoutMs), totalTimeoutMs }
}

// SSRF (plan 023, Validation): every call went to the constant API origin, without
// credentials, and with redirects off.
export function expectOnlyGithubApi(callList: FakeCall[]): void {
  for (const call of callList) {
    expect(new URL(call.url).origin).toBe(API)
    expect(call.url.startsWith(`${API}/repos/`) || call.url.startsWith(`${API}/users/`)).toBe(true)
    expect(call.init.redirect).toBe('manual')
    expect(call.init.credentials).toBe('omit')
    const header = new Headers(call.init.headers)
    expect(header.has('authorization')).toBe(false)
    expect(header.has('cookie')).toBe(false)
  }
}

// A text of exactly `length` UTF-16 units that ends with a line break.
export function textOf(length: number, char = 'x'): string {
  return `${char.repeat(length - 1)}\n`
}
