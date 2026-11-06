import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp } from './helper/app.js'
import { expectContract, expectError } from './helper/contract.js'

// Plan 028, Scope 17 (Open Question 4, answer A): the profile photo, raw bytes, checked by magic
// bytes, at most 2 MB, served only to the account itself.

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')])
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 body')])
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const html = Buffer.from('<!doctype html><script>alert(1)</script>')
const maxByte = 2 * 1024 * 1024

function upload(app: Parameters<typeof request>[0], body: Buffer, type: string) {
  return request(app).put('/api/account/avatar').set('content-type', type).send(body)
}

describe('PUT /api/account/avatar', () => {
  it.each([
    ['PNG', png, 'image/png'],
    ['JPEG', jpeg, 'image/jpeg'],
    ['WebP', webp, 'image/webp']
  ])('stores a %s and answers 200 with the new avatarUrl', async (_label, body, type) => {
    const { app } = buildApp()

    const response = await upload(app, body, type)

    expectContract(response, '/api/account/avatar', 'PUT')
    expect(response.status).toBe(200)
    expect(response.body.avatarUrl).toMatch(/^\/api\/account\/avatar\?v=[0-9a-f]{12}$/)
    expect((await request(app).get('/api/account')).body.avatarUrl).toBe(response.body.avatarUrl)
    expect((await request(app).get('/api/session')).status).toBe(200)
  })

  it('a new photo gets a new avatarUrl', async () => {
    const { app } = buildApp()

    const first = (await upload(app, png, 'image/png')).body.avatarUrl
    const second = (await upload(app, jpeg, 'image/jpeg')).body.avatarUrl

    expect(second).not.toBe(first)
  })

  it('accepts exactly 2 MB and refuses one byte more with 413', async () => {
    const { app } = buildApp()
    const exact = Buffer.concat([png, Buffer.alloc(maxByte - png.length)])

    expect((await upload(app, exact, 'image/png')).status).toBe(200)
    const tooLarge = await upload(app, Buffer.concat([exact, Buffer.from([0])]), 'image/png')

    expectError(tooLarge, 413, 'payload_too_large')
    expectContract(tooLarge, '/api/account/avatar', 'PUT')
  })

  it.each([
    ['SVG as image/svg+xml', svg, 'image/svg+xml'],
    ['SVG renamed as image/png', svg, 'image/png'],
    ['HTML renamed as image/png', html, 'image/png'],
    // A declared type that differs from the bytes.
    ['a PNG sent as image/jpeg', png, 'image/jpeg'],
    ['a JPEG sent as image/webp', jpeg, 'image/webp'],
    ['a PNG as text/plain', png, 'text/plain'],
    ['an empty body', Buffer.alloc(0), 'image/png'],
    ['a truncated PNG signature', png.subarray(0, 4), 'image/png'],
    ['RIFF that is not WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]), 'image/webp']
  ])('refuses %s with 422 and stores nothing', async (_label, body, type) => {
    const { app, store } = buildApp()

    const response = await upload(app, body, type)

    expectError(response, 422, 'validation_error')
    expectContract(response, '/api/account/avatar', 'PUT')
    expect(response.body.error.details.issue[0].field).toBe('avatar')
    expect(store.state.avatar).toBeUndefined()
    expect((await request(app).get('/api/account')).body.avatarUrl).toBeNull()
  })

  it('refuses a JSON body with 422', async () => {
    const { app } = buildApp()

    expectError(await request(app).put('/api/account/avatar').send({ data: 'x' }), 422, 'validation_error')
  })
})

describe('GET /api/account/avatar', () => {
  it('returns the bytes with the sniffed type and the safe headers', async () => {
    const { app } = buildApp()
    await upload(app, webp, 'image/webp')

    const response = await request(app).get('/api/account/avatar').buffer(true).parse((res, callback) => {
      const chunkList: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunkList.push(chunk))
      res.on('end', () => callback(null, Buffer.concat(chunkList)))
    })

    expectContract(response, '/api/account/avatar', 'GET')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/webp')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(response.headers['content-disposition']).toBe('inline')
    expect(response.headers['cache-control']).toBe('private')
    expect(Buffer.compare(response.body as Buffer, webp)).toBe(0)
  })

  it('answers 404 when there is no photo and 401 without a session', async () => {
    const { app, rawApp } = buildApp()

    const missing = await request(app).get('/api/account/avatar')
    const signedOut = await request(rawApp).get('/api/account/avatar')

    expectError(missing, 404, 'not_found')
    expectContract(missing, '/api/account/avatar', 'GET')
    expectError(signedOut, 401, 'unauthorized')
  })
})

describe('DELETE /api/account/avatar', () => {
  it('removes the photo: avatarUrl null, and the photo is gone', async () => {
    const { app } = buildApp()
    await upload(app, png, 'image/png')

    const response = await request(app).delete('/api/account/avatar')

    expectContract(response, '/api/account/avatar', 'DELETE')
    expect(response.status).toBe(200)
    expect(response.body.avatarUrl).toBeNull()
    expectError(await request(app).get('/api/account/avatar'), 404, 'not_found')
    expect((await request(app).delete('/api/account/avatar')).status).toBe(200)
  })
})
