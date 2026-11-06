import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { createReviewService } from '../../src/services/review.service'
import { ERROR_CODE, type ErrorCode } from '../../src/utils/error-messages'
import { answering, createFakeDataSource } from '../utils/fakeDataSource'
import { recentReviewList, sampleReview } from '../utils/sampleData'

function failing(status: number, code: ErrorCode) {
  return createFakeDataSource(() => {
    throw new AppError({ code, kind: 'http', status })
  })
}

describe('review.service', () => {
  it('lists reviews from GET /api/review and passes the signal', async () => {
    const { source, call } = answering(recentReviewList)
    const controller = new AbortController()

    expect(await createReviewService(source).list({ signal: controller.signal })).toEqual(recentReviewList)
    expect(call).toHaveBeenCalledWith('GET', '/api/review', undefined, { signal: controller.signal })
  })

  it('rejects a malformed list with a parse AppError', async () => {
    await expect(createReviewService(answering([{ id: 1 }]).source).list()).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('gets one review by encoded id and builds its saved state from savedAt', async () => {
    const { source, call } = answering({
      ...sampleReview,
      title: 'Mine',
      savedAt: '2026-10-20T10:00:00.000Z',
      analyzedContent: 'old code',
      analyzedLanguage: 'Go'
    })

    const detail = await createReviewService(source).get('a/b')

    expect(call.mock.calls[0][1]).toBe('/api/review/a%2Fb')
    expect(detail?.review).toEqual({ ...sampleReview, title: 'Mine' })
    expect(detail?.saved).toEqual({ name: 'Mine', language: sampleReview.language, code: sampleReview.content, savedAt: '2026-10-20T10:00:00.000Z' })
    expect(detail).toMatchObject({ analyzedContent: 'old code', analyzedLanguage: 'Go' })
  })

  it('rejects a GET answer without analyzedContent or analyzedLanguage (contract 0.6.0)', async () => {
    await expect(createReviewService(answering({ ...sampleReview, savedAt: null }).source).get('r1')).rejects.toMatchObject({ code: ERROR_CODE.parse })
    await expect(
      createReviewService(answering({ ...sampleReview, savedAt: null, analyzedContent: 'x' }).source).get('r1')
    ).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('runs a review: POST /api/review/{id}/run with the edit, answering the pending review', async () => {
    const pending = { ...sampleReview, status: 'pending', finding: [], findingCount: [], suggestion: [], generatedTest: [] }
    const { source, call } = answering({ ...pending, id: 'r1', savedAt: 't', analyzedContent: 'new', analyzedLanguage: 'Go' })

    const detail = await createReviewService(source).run('r1', { name: 'N', language: 'Go', code: 'new' })

    expect(call.mock.calls[0].slice(0, 3)).toEqual(['POST', '/api/review/r1/run', { name: 'N', language: 'Go', code: 'new' }])
    expect(detail).toMatchObject({ id: 'r1', review: { status: 'pending' }, analyzedContent: 'new', analyzedLanguage: 'Go' })
    await expect(createReviewService(answering({ ...pending, id: 'r1', savedAt: 't' }).source).run('r1', { language: 'Go', code: 'x' })).rejects.toMatchObject({
      code: ERROR_CODE.parse
    })
  })

  it('takes the analyzed code of a created review from its content (POST /api/review has no such fields)', async () => {
    const detail = await createReviewService(answering({ ...sampleReview, id: 'c1' }).source).create({ language: 'Go', content: 'x' })
    expect(detail).toMatchObject({ analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language })
  })

  it('has no saved state when savedAt is null', async () => {
    const answer = { ...sampleReview, savedAt: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language }
    expect((await createReviewService(answering(answer).source).get('r1'))?.saved).toBeNull()
  })

  it('returns null for not found so the page shows Review not found', async () => {
    expect(await createReviewService(failing(404, ERROR_CODE.notFound).source).get('nope')).toBeNull()
  })

  it('rejects other failures and a malformed review', async () => {
    await expect(createReviewService(failing(401, ERROR_CODE.unauthorized).source).get('r1')).rejects.toMatchObject({
      code: ERROR_CODE.unauthorized
    })
    await expect(createReviewService(answering({ title: 1 }).source).get('r1')).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('saves with PUT, renames with PATCH and deletes with DELETE', async () => {
    const saved = { name: 'n', language: 'Go', code: 'a', savedAt: 't' }
    const { source, call } = createFakeDataSource((method) => (method === 'DELETE' ? undefined : saved))
    const service = createReviewService(source)

    expect(await service.save('r1', { name: 'n', language: 'Go', code: 'a' })).toEqual(saved)
    expect(await service.rename('r1', 'n')).toEqual(saved)
    await service.delete('r1')

    expect(call.mock.calls.map(([method, url, body]) => [method, url, body])).toEqual([
      ['PUT', '/api/review/r1', { name: 'n', language: 'Go', code: 'a' }],
      ['PATCH', '/api/review/r1', { name: 'n' }],
      ['DELETE', '/api/review/r1', undefined]
    ])
  })

  it('rejects a malformed saved review', async () => {
    await expect(createReviewService(answering({ code: 1 }).source).save('r1', { language: 'Go', code: 'a' })).rejects.toMatchObject({
      code: ERROR_CODE.parse
    })
  })

  it('creates with POST and needs an id back', async () => {
    const { source, call } = answering({ ...sampleReview, id: 'x1' })
    const created = await createReviewService(source).create({ language: 'Go', content: 'a' })

    expect(created.id).toBe('x1')
    expect(call.mock.calls[0][2]).toEqual({ source_type: 'snippet', language: 'Go', content: 'a' })
    await expect(createReviewService(answering(sampleReview).source).create({ language: 'Go', content: 'a' })).rejects.toMatchObject({
      code: ERROR_CODE.parse
    })
  })
})
