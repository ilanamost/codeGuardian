import { describe, expect, it, vi } from 'vitest'
import { createApiService, type FetchFn } from '../../src/services/api.service'

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('qa-041: plain wire after the encryption removal', () => {
  it('a 2 MB Blob goes raw, once, with its own content type and no JSON wrapper', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(204))
    const blob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' })

    await createApiService({ baseUrl: 'http://api.test/', fetchFn }).request('PUT', '/api/account/avatar', blob)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).not.toMatch(/crypto/)
    expect(init.body).toBe(blob)
    expect(init.headers).toMatchObject({ 'Content-Type': 'image/png' })
  })

  it('a JSON request has no kid, iv or ct and never triggers a crypto call, even after a 400 with a decryption-like code', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json(400, { error: { code: 'decryption_failed', message: 'x' } }))
    const service = createApiService({ baseUrl: 'http://api.test/', fetchFn })

    await expect(service.request('POST', '/api/review', { title: 'a'.repeat(5000), password: 'p' })).rejects.toBeDefined()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [, init] = fetchFn.mock.calls[0]
    const sent = JSON.parse(init.body as string)
    for (const key of ['kid', 'iv', 'ct']) expect(sent).not.toHaveProperty(key)
    expect(sent.password).toBe('p')
  })

  it('a non-JSON error body does not crash into a retry loop', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(new Response('<html>', { status: 502 }))
    await expect(createApiService({ baseUrl: 'http://api.test/', fetchFn }).request('POST', '/api/review', {})).rejects.toBeDefined()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
