// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createStorageService } from '../../src/services/storage.service'

// QA plan 047: try to break the frontend side of the bearer-token fallback.

const token = 'T'.repeat(43)
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const unauthorized = () => json(401, { error: { code: 'unauthorized', message: 'x' } })

function scan(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) scan(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

function memoryStorage(failWrite = false) {
  const map = new Map<string, string>()
  const raw = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrite) throw new Error('quota')
      map.set(key, value)
    },
    removeItem: (key: string) => void map.delete(key)
  } as unknown as Storage
  return { map, storage: createStorageService(() => raw) }
}

describe('QA 048 source scan', () => {
  const files = scan(join(__dirname, '../../src'))

  it('no dangerouslySetInnerHTML or innerHTML anywhere in src', () => {
    const hit = files.filter((file) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(readFileSync(file, 'utf8')))
    expect(hit).toEqual([])
  })

  it('the token name and storage key appear only in api.service and the constants', () => {
    const hit = files.filter((file) => /sessionToken|SESSION_TOKEN_STORAGE_KEY|cr\.sessionToken/.test(readFileSync(file, 'utf8'))).map((file) => file.replace(/\\/g, '/').split('/src/')[1])
    expect(hit.sort()).toEqual(['lib/api.constants.ts', 'services/api.service.ts'])
  })

  it('no store, listener or notification file mentions the token or a bearer', () => {
    const hit = files.filter((file) => /store|notification|listener/.test(file) && /sessionToken|Bearer/.test(readFileSync(file, 'utf8')))
    expect(hit).toEqual([])
  })
})

describe('QA 048 api.service behaviour', () => {
  function build(fetchFn: FetchFn, failWrite = false) {
    const mem = memoryStorage(failWrite)
    return { mem, source: createApiService({ baseUrl: 'http://api.test', fetchFn, storage: mem.storage }) }
  }

  it('the token never reaches the caller, in token mode or cookie mode', async () => {
    for (const cookieWorks of [true, false]) {
      const { source, mem } = build(async (_url, init) => {
        if (init.method === 'POST') return json(200, { username: 'a', sessionToken: token })
        return cookieWorks ? json(200, {}) : unauthorized()
      })
      const result = await source.request<Record<string, unknown>>('POST', '/api/session', { username: 'a', password: 'b' })
      expect(JSON.stringify(result)).not.toContain(token)
      expect(mem.map.has(SESSION_TOKEN_STORAGE_KEY)).toBe(!cookieWorks)
    }
  })

  it('a malformed sessionToken from the server is ignored and not stored', async () => {
    for (const bad of ['short', 'x'.repeat(44), 42, null, { a: 1 }, `<script>${'a'.repeat(40)}`]) {
      const { source, mem } = build(async () => json(200, { username: 'a', sessionToken: bad }))
      await source.request('POST', '/api/session', {})
      expect(mem.map.size).toBe(0)
    }
  })

  it('a poisoned localStorage value is never sent as a bearer', async () => {
    const mem = memoryStorage()
    mem.map.set(SESSION_TOKEN_STORAGE_KEY, JSON.stringify('evil\r\nX: 1'))
    const seen: Record<string, string>[] = []
    const source = createApiService({
      baseUrl: 'http://api.test',
      storage: mem.storage,
      fetchFn: async (_url, init) => {
        seen.push(init.headers as Record<string, string>)
        return json(200, {})
      }
    })
    await source.request('GET', '/api/dashboard')
    expect(seen[0].Authorization).toBeUndefined()
  })

  it('a throwing localStorage does not break sign-in; the token is then kept in memory only', async () => {
    const seen: Record<string, string>[] = []
    const { source } = build(async (_url, init) => {
      seen.push(init.headers as Record<string, string>)
      if (init.method === 'POST') return json(200, { sessionToken: token })
      return seen.length === 2 ? unauthorized() : json(200, {})
    }, true)
    await expect(source.request('POST', '/api/session', {})).resolves.toBeDefined()
    await source.request('GET', '/api/dashboard')
    expect(seen[seen.length - 1].Authorization).toBe(`Bearer ${token}`)
  })

  it('a network failure on the cookie check drops the token (no stale token left)', async () => {
    const { source, mem } = build(async (_url, init) => {
      if (init.method === 'POST') return json(200, { sessionToken: token })
      throw new TypeError('offline')
    })
    await source.request('POST', '/api/session', {})
    expect(mem.map.size).toBe(0)
  })

  it('a 500 or 403 does not clear the token, a 401 does, and no Authorization is sent after it', async () => {
    const mem = memoryStorage()
    mem.map.set(SESSION_TOKEN_STORAGE_KEY, JSON.stringify(token))
    const status = [500, 403, 401, 200]
    const seen: Record<string, string>[] = []
    const source = createApiService({
      baseUrl: 'http://api.test',
      storage: mem.storage,
      fetchFn: async (_url, init) => {
        seen.push(init.headers as Record<string, string>)
        return json(status[seen.length - 1], { error: { code: 'x', message: 'x' } })
      }
    })
    for (let i = 0; i < 4; i += 1) await source.request('GET', `/api/r${i}`).catch(() => undefined)
    expect(seen.map((header) => header.Authorization !== undefined)).toEqual([true, true, true, false])
    expect(mem.map.size).toBe(0)
  })

  it('a failed sign-out (500) leaves the token so the user can retry; success clears it', async () => {
    const mem = memoryStorage()
    mem.map.set(SESSION_TOKEN_STORAGE_KEY, JSON.stringify(token))
    const codes = [500, 204]
    const source = createApiService({ baseUrl: 'http://api.test', storage: mem.storage, fetchFn: async () => json(codes.shift() ?? 204, { error: { code: 'x', message: 'x' } }) })
    await source.request('DELETE', '/api/session').catch(() => undefined)
    expect(mem.map.size).toBe(1)
    await source.request('DELETE', '/api/session')
    expect(mem.map.size).toBe(0)
  })

  it('twenty rapid sign-ins on a blocked cookie never throw and leave one stored token', async () => {
    let count = 0
    const { source, mem } = build(async (_url, init) => {
      if (init.method === 'POST') return json(200, { sessionToken: String(count++ % 10).repeat(43) })
      return unauthorized()
    })
    await Promise.all(Array.from({ length: 20 }, () => source.request('POST', '/api/session', {})))
    expect(mem.map.size).toBe(1)
  })
})
