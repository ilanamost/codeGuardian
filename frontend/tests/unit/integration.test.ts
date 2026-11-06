import { describe, expect, it, vi } from 'vitest'
import { API_PATH } from '../../src/lib/api.constants'
import { AppError, issueListOf } from '../../src/models/app-error'
import { initialsOf, isAccountDto } from '../../src/models/account.model'
import { isGithubFileContentDto } from '../../src/models/github.model'
import { createAccountService } from '../../src/services/account.service'
import { createApiService, type FetchFn } from '../../src/services/api.service'
import { createGithubService } from '../../src/services/github.service'
import { createReviewService } from '../../src/services/review.service'
import { createAppStore } from '../../src/store'
import { changePassword, fetchAccount, passwordErrorCleared } from '../../src/store/account.slice'
import { signOut } from '../../src/store/session.slice'
import { connectGithub, disconnectGithub, importGithubFile } from '../../src/store/github.slice'
import { draftCleared, fetchReview, regenerateTest } from '../../src/store/review.slice'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { answering, createFakeDataSource } from '../utils/fakeDataSource'
import { createFakeServices } from '../utils/fakeServices'
import { signedInState } from '../utils/renderWithStore'
import { REVIEW_TEXT } from '../../src/lib/review.constants'
import { generatedTestFileList, sampleReview } from '../utils/sampleData'

// Plan 019 Scope 1 and 4: the six button routes (service -> thunk -> slice) and the error
// mapping for every status the backend sends.

const account = { username: 'john.doe', fullName: 'John Doe', email: 'john@company.com', avatarUrl: null, memberSince: 'March 12, 2025' }
const fileContent = { id: 'be-1', path: 'src/server.ts', language: 'TypeScript', content: 'const a = 1\n' }

function storeWith(services = createFakeServices().services) {
  return { store: createAppStore({ services }), services }
}

describe('services for the six button routes', () => {
  it('review.regenerateTest posts to /api/review/{id}/generated-test and checks the files', async () => {
    const { source, call } = createFakeDataSource(() => generatedTestFileList)

    expect(await createReviewService(source).regenerateTest('r 1')).toEqual(generatedTestFileList)
    expect(call).toHaveBeenCalledWith('POST', '/api/review/r%201/generated-test', undefined, undefined)
    await expect(createReviewService(answering([{ id: 1 }]).source).regenerateTest('r1')).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('github.disconnect posts to /api/github/disconnect', async () => {
    const { source, call } = createFakeDataSource()

    await expect(createGithubService(source).disconnect()).resolves.toBeUndefined()
    expect(call).toHaveBeenCalledWith('POST', API_PATH.githubDisconnect, undefined, undefined)
  })

  it('github.getFile reads one file with its content and rejects a malformed one', async () => {
    const { source, call } = createFakeDataSource(() => fileContent)

    expect(await createGithubService(source).getFile('backend-api', 'be-1')).toEqual(fileContent)
    expect(call).toHaveBeenCalledWith('GET', '/api/github/repo/backend-api/file/be-1', undefined, undefined)
    await expect(createGithubService(answering({ id: 'be-1', path: 'a' }).source).getFile('r', 'f')).rejects.toMatchObject({
      code: ERROR_CODE.parse
    })
  })

  it('account.get and changePassword call their routes', async () => {
    const { source, call } = createFakeDataSource((method) => (method === 'GET' ? account : undefined))
    const service = createAccountService(source)

    expect(await service.get()).toEqual(account)
    await service.changePassword({ currentPassword: 'old-one', newPassword: 'new-one-1' })

    expect(call.mock.calls.map(([method, url, body]) => [method, url, body])).toEqual([
      ['GET', '/api/account', undefined],
      ['PUT', '/api/account/password', { currentPassword: 'old-one', newPassword: 'new-one-1' }]
    ])
    await expect(createAccountService(answering({ ...account, avatarUrl: 5 }).source).get()).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })
})

describe('account, file and initials guards', () => {
  it('accepts the contract shapes and rejects wrong ones', () => {
    expect(isAccountDto(account)).toBe(true)
    expect(isAccountDto({ ...account, avatarUrl: 'https://x/a.png' })).toBe(true)
    expect(isAccountDto({ ...account, avatarUrl: undefined })).toBe(false)
    expect(isGithubFileContentDto(fileContent)).toBe(true)
    expect(isGithubFileContentDto({ ...fileContent, content: null })).toBe(false)
  })

  it('builds initials from the first and last word', () => {
    expect(initialsOf('John Doe')).toBe('JD')
    expect(initialsOf('  ada  b  lovelace ')).toBe('AL')
    expect(initialsOf('Cher')).toBe('C')
    expect(initialsOf('   ')).toBe('')
  })
})

describe('error mapping for every status the backend sends', () => {
  const respond = (status: number, body: unknown): FetchFn => async () => new Response(JSON.stringify(body), { status })

  it.each([
    [400, ERROR_CODE.validation, 'validation'],
    [404, ERROR_CODE.notFound, 'http'],
    [409, ERROR_CODE.conflict, 'http'],
    [413, ERROR_CODE.payloadTooLarge, 'http'],
    [422, ERROR_CODE.validation, 'validation'],
    [500, ERROR_CODE.server, 'http']
  ])('maps HTTP %i to %s', async (status, code, kind) => {
    const source = createApiService({ baseUrl: 'http://x', fetchFn: respond(status, { error: { code: 'x', message: 'm' }, requestId: 'q' }) })

    await expect(source.request('GET', '/a')).rejects.toMatchObject({ code, kind, status, requestId: 'q' })
  })

  it('keeps the 422 details.issue[] fields and carries them through thunk rejections', async () => {
    const body = { error: { code: 'validation_error', message: 'm', details: { issue: [{ field: 'currentPassword', message: 'is not correct' }] } } }
    const error = AppError.fromResponse(422, body)

    expect(error.issueList).toEqual([{ field: 'currentPassword', message: 'is not correct' }])
    const json = error.forAction(ERROR_CODE.passwordChange).toJSON()
    expect(json.issueList).toEqual([{ field: 'currentPassword', message: 'is not correct' }])
    expect(AppError.fromJson(json).issueList).toEqual(error.issueList)
    expect(AppError.fromResponse(500, {}).toJSON()).not.toHaveProperty('issueList')
  })

  it('ignores a malformed details.issue', () => {
    expect(issueListOf(undefined)).toEqual([])
    expect(issueListOf({ issue: 'x' })).toEqual([])
    expect(issueListOf({ issue: [{ field: 1 }] })).toEqual([])
  })

  it('builds the user message from constants, never from the server text', () => {
    const error = AppError.fromResponse(413, { error: { code: 'payload_too_large', message: 'secret server text' } }).forAction(ERROR_CODE.reviewCreate)

    expect(error.userMessage).toBe('Could not start the review. It is too large, shorten it and try again.')
  })
})

describe('store: account', () => {
  it('loads the account once and skips a second load', async () => {
    const { store, services } = storeWith()

    await store.dispatch(fetchAccount())
    await store.dispatch(fetchAccount())

    expect(store.getState().account).toMatchObject({ account, status: 'succeeded' })
    expect(services.account.get).toHaveBeenCalledTimes(1)
  })

  it('records a failed load, and the next load tries again', async () => {
    const { store, services } = storeWith()
    services.account.get.mockRejectedValueOnce(new Error('down'))

    await store.dispatch(fetchAccount())
    expect(store.getState().account).toMatchObject({ status: 'failed', error: { code: ERROR_CODE.accountLoad } })

    await store.dispatch(fetchAccount())
    expect(store.getState().account.status).toBe('succeeded')
  })

  it('changePassword: succeeded, or failed with the field issue and no error toast', async () => {
    const { services, toast } = createFakeServices()
    const { store } = storeWith(services)

    await store.dispatch(changePassword({ currentPassword: 'a', newPassword: 'longenough1' }))
    expect(store.getState().account.passwordStatus).toBe('succeeded')

    services.account.changePassword.mockRejectedValueOnce(
      AppError.fromResponse(422, { error: { code: 'validation_error', message: 'm', details: { issue: [{ field: 'currentPassword', message: 'x' }] } } })
    )
    await store.dispatch(changePassword({ currentPassword: 'b', newPassword: 'longenough1' }))
    expect(store.getState().account).toMatchObject({ passwordStatus: 'failed', passwordError: { issueList: [{ field: 'currentPassword' }] } })
    expect(toast.error).not.toHaveBeenCalled()

    store.dispatch(passwordErrorCleared())
    expect(store.getState().account).toMatchObject({ passwordStatus: 'idle', passwordError: null })
  })

  it('changePassword without a known field issue is an error toast', async () => {
    const { services, toast } = createFakeServices()
    const { store } = storeWith(services)
    services.account.changePassword.mockRejectedValueOnce(
      AppError.fromResponse(422, { error: { code: 'validation_error', message: 'm', details: { issue: [{ field: 'other', message: 'x' }] } } })
    )

    await store.dispatch(changePassword({ currentPassword: 'b', newPassword: 'longenough1' }))

    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('signOut records its status: a failure keeps the session', async () => {
    const { services } = createFakeServices()
    const store = createAppStore({ services, preloadedState: signedInState() })

    services.session.signOut.mockRejectedValueOnce(new Error('down'))
    await store.dispatch(signOut())
    expect(store.getState().session).toMatchObject({ signOutStatus: 'failed', status: 'signedIn' })

    await store.dispatch(signOut())
    expect(store.getState().session).toMatchObject({ status: 'signedOut', end: 'signOut' })
    expect(services.session.signOut).toHaveBeenCalledTimes(2)
  })
})

describe('store: GitHub disconnect and import', () => {
  it('clears the account only once the server disconnected', async () => {
    const { store, services } = storeWith()
    await store.dispatch(connectGithub({ username: 'octocat' }))

    services.github.disconnect.mockRejectedValueOnce(new Error('down'))
    await store.dispatch(disconnectGithub())
    expect(store.getState().github).toMatchObject({ disconnectStatus: 'failed', account: { login: 'octocat' } })

    await store.dispatch(disconnectGithub())
    expect(store.getState().github).toMatchObject({ disconnectStatus: 'succeeded', account: null, selectedRepoId: null, fileList: [] })
  })

  it('keeps an imported file as the new review draft (title truncated to 80 characters)', async () => {
    const { store, services } = storeWith()
    services.github.getFile.mockResolvedValueOnce({ ...fileContent, path: `src/${'a'.repeat(100)}.ts` })

    await store.dispatch(importGithubFile({ repoId: 'backend-api', fileId: 'be-1' }))

    const draft = store.getState().review.draft
    expect(services.github.getFile).toHaveBeenCalledWith('backend-api', 'be-1')
    expect(draft).toMatchObject({ language: 'TypeScript', content: fileContent.content })
    expect(draft?.title).toHaveLength(80)
    expect(store.getState().github.importStatus).toBe('succeeded')

    store.dispatch(draftCleared())
    expect(store.getState().review.draft).toBeNull()
  })

  it('leaves no draft when the import fails', async () => {
    const { store, services } = storeWith()
    services.github.getFile.mockRejectedValueOnce(new Error('down'))

    await store.dispatch(importGithubFile({ repoId: 'r', fileId: 'f' }))

    expect(store.getState().review.draft).toBeNull()
    expect(store.getState().github).toMatchObject({ importStatus: 'failed', error: { code: ERROR_CODE.githubFileImport } })
  })
})

describe('store: Regenerate', () => {
  it('replaces the generated tests of the current review', async () => {
    const { store } = storeWith()
    await store.dispatch(fetchReview('r1'))

    await store.dispatch(regenerateTest('r1'))

    expect(store.getState().review.regenerateStatus).toBe('succeeded')
    expect(store.getState().review.current?.review?.generatedTest.map((file) => file.code)).toEqual(
      sampleReview.generatedTest.map((file) => file.altCode)
    )
  })

  it('leaves another review alone and records a failure', async () => {
    const { store, services } = storeWith()
    await store.dispatch(fetchReview('r1'))

    await store.dispatch(regenerateTest('r2'))
    expect(store.getState().review.current?.review?.generatedTest).toEqual(sampleReview.generatedTest)

    services.review.regenerateTest.mockRejectedValueOnce(new Error('down'))
    await store.dispatch(regenerateTest('r1'))
    expect(store.getState().review.regenerateStatus).toBe('failed')
  })
})

describe('listener: Review completed notice', () => {
  it('notifies once when a review the page waited for completes, and not for one already finished', async () => {
    const { services, toast } = createFakeServices()
    const { store } = storeWith(services)
    services.review.get.mockResolvedValueOnce({ id: 'r1', review: { ...sampleReview, status: 'pending' }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language })

    await store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r1'))

    // sampleReview has a critical finding: the critical notice comes with it (plan 028), once too.
    expect(toast.success.mock.calls.filter(([message]) => message === 'Review completed')).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith(REVIEW_TEXT.criticalFinding)
    expect(toast.success).toHaveBeenCalledTimes(2)
  })

  it('follows the Review completed preference', async () => {
    const { services, toast } = createFakeServices()
    const settings = services.settings.read()
    services.settings.read.mockReturnValue({ ...settings, notification: { ...settings.notification, reviewCompleted: false } })
    const { store } = storeWith(services)
    services.review.get.mockResolvedValueOnce({ id: 'r1', review: { ...sampleReview, status: 'in_progress' }, saved: null, analyzedContent: sampleReview.content, analyzedLanguage: sampleReview.language })

    await store.dispatch(fetchReview('r1'))
    await store.dispatch(fetchReview('r1'))

    expect(toast.success).not.toHaveBeenCalledWith('Review completed')
    vi.restoreAllMocks()
  })
})
