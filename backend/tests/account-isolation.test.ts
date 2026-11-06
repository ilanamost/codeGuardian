import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildApp, registerAgent, registrationOf, validSettings, waitForAgentStatus } from './helper/app.js'
import { expectError } from './helper/contract.js'
import { fakeGithubClient, fakeUser } from './helper/github.js'

// Plan 028, Scope 5: each registered account has its own org, and nothing of account A is
// visible to or changeable by account B. Another account's review id is 404, never 403.

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('alice photo')])
const content = 'eval(input)\nconst value: any = 1\nconsole.log(value)\n'
const supportRequest = { issueType: 'other', email: 'alice@example.com', reviewId: '', priority: 'low', description: 'Something went wrong here.' }

async function twoAccount() {
  const { rawApp, store } = buildApp({ githubClient: fakeGithubClient() })
  const alice = await registerAgent(rawApp, registrationOf('alice'))
  const bob = await registerAgent(rawApp, registrationOf('bob'))

  // Alice: a review with a saved edit, settings, a GitHub connection, a support request and a photo.
  await alice.put('/api/settings').send({ ...validSettings, reviewFocus: 'security', generatedTest: true })
  const created = await alice.post('/api/review').send({ source_type: 'snippet', title: 'Alice review', language: 'TypeScript', content })
  const id: string = created.body.id
  await waitForAgentStatus(alice, id, 'completed')
  await alice.put(`/api/review/${id}`).send({ name: 'Alice saved', language: 'TypeScript', code: content })
  await alice.post('/api/github/connect').send({ username: fakeUser })
  await alice.post('/api/support-request').send(supportRequest)
  await alice.put('/api/account/avatar').set('content-type', 'image/png').send(png)
  return { rawApp, store, alice, bob, id }
}

describe('per-account isolation (MemoryStore)', () => {
  it("A's review id gives 404 to B on GET, PUT, run, rename, generated-test and DELETE, and A's review is unchanged", async () => {
    const { alice, bob, id } = await twoAccount()
    const before = (await alice.get(`/api/review/${id}`)).body

    const responseList = [
      await bob.get(`/api/review/${id}`),
      await bob.put(`/api/review/${id}`).send({ language: 'Go', code: 'stolen' }),
      await bob.post(`/api/review/${id}/run`).send({ language: 'Go', code: 'stolen' }),
      await bob.patch(`/api/review/${id}`).send({ name: 'stolen' }),
      await bob.post(`/api/review/${id}/generated-test`),
      await bob.delete(`/api/review/${id}`)
    ]

    for (const response of responseList) {
      expectError(response, 404, 'not_found')
      expect(response.text).not.toContain('Alice')
    }
    expect((await alice.get(`/api/review/${id}`)).body).toEqual(before)
  })

  it("B's History, Dashboard, settings, account, photo and GitHub state never include A's data", async () => {
    const { alice, bob } = await twoAccount()

    expect((await bob.get('/api/review')).body).toEqual([])
    expect((await bob.get('/api/dashboard')).body.statList.map((stat: { value: number }) => stat.value)).toEqual([0, 0, 0, 0])
    expect((await bob.get('/api/settings')).body.reviewFocus).toBe('all')
    expect((await bob.get('/api/account')).body).toMatchObject({ username: 'bob', email: 'bob@example.com', avatarUrl: null })
    expectError(await bob.get('/api/account/avatar'), 404, 'not_found')
    expect((await alice.get('/api/review')).body).toHaveLength(1)
    expect((await alice.get('/api/dashboard')).body.statList[0].value).toBe(1)
    expect((await alice.get('/api/account')).body.avatarUrl).not.toBeNull()
  })

  it('GitHub state and support requests stay in their own org', async () => {
    const { store, alice } = await twoAccount()
    const orgOf = (name: string) => [...store.orgMap.values()].find((org) => org.account.username === name)

    expect(orgOf('alice')?.github.connection).toEqual({ login: fakeUser, name: 'Example User' })
    expect(orgOf('bob')?.github.connection).toBeNull()
    expect(orgOf('alice')?.supportRequestList).toHaveLength(1)
    expect(orgOf('bob')?.supportRequestList).toEqual([])
    expect((await alice.get('/api/account')).body.username).toBe('alice')
  })

  it("changing B's settings or password does not change A's", async () => {
    const { rawApp, alice, bob } = await twoAccount()
    const aliceSettings = (await alice.get('/api/settings')).body

    await bob.put('/api/settings').send({ ...validSettings, theme: 'light', reviewFocus: 'bugs' })
    expect((await bob.put('/api/account/password').send({ currentPassword: registrationOf('bob').password, newPassword: 'bob-new-pass-42' })).status).toBe(204)

    expect((await alice.get('/api/settings')).body).toEqual(aliceSettings)
    expect((await request(rawApp).post('/api/session').set('X-CSRF-Protection', '1')
      .send({ username: 'alice', password: registrationOf('alice').password })).status).toBe(200)
  })

  it("signing out B, or B's password change, does not end A's sessions", async () => {
    const { alice, bob } = await twoAccount()

    await bob.put('/api/account/password').send({ currentPassword: registrationOf('bob').password, newPassword: 'bob-new-pass-42' })
    await bob.delete('/api/session')

    expect((await alice.get('/api/account')).status).toBe(200)
    expectError(await bob.get('/api/account'), 401, 'unauthorized')
  })

  it("A's analysis uses A's AI preferences, not B's", async () => {
    const { alice, bob } = await twoAccount()
    await bob.put('/api/settings').send({ ...validSettings, reviewFocus: 'readability', generatedTest: true })

    const aliceReview = await alice.post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content })
    const bobReview = await bob.post('/api/review').send({ source_type: 'snippet', language: 'TypeScript', content })
    const aliceDone = (await waitForAgentStatus(alice, aliceReview.body.id, 'completed')).body
    const bobDone = (await waitForAgentStatus(bob, bobReview.body.id, 'completed')).body

    expect(aliceDone.finding.map((finding: { category: string }) => finding.category)).toEqual(['security'])
    expect(bobDone.finding.map((finding: { category: string }) => finding.category)).toEqual(['maintainability', 'readability'])
  })
})
