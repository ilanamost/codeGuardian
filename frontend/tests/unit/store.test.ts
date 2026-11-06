import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { recentReviewList } from '../utils/sampleData'
import { sampleReview } from '../utils/sampleData'
import { createAppStore } from '../../src/store'
import { fetchDashboard, selectDashboard } from '../../src/store/dashboard.slice'
import {
  connectGithub,
  githubDisconnected,
  githubReset,
  repoCleared,
  searchRepo,
  selectRepo
} from '../../src/store/github.slice'
import { errorReported } from '../../src/store/listener'
import {
  createReview,
  deleteReview,
  downloadReport,
  fetchReview,
  fetchReviewList,
  renameReview,
  saveReview,
  selectCurrentReviewModel,
  selectReviewSummaryList
} from '../../src/store/review.slice'
import { fetchSettings, notificationSet, settingsUpdated } from '../../src/store/settings.slice'
import { submitSupportRequest, supportReset } from '../../src/store/support.slice'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'

function setup() {
  const { services, toast } = createFakeServices()
  const store = createAppStore({ services })
  return { store, services, toast }
}

// Lets listener effects (which run after the action) finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const storageError = () => new AppError({ code: ERROR_CODE.storage, kind: 'storage' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('review slice', () => {
  it('loads the list: loading then succeeded', async () => {
    const { store } = setup()
    const pending = store.dispatch(fetchReviewList())

    expect(store.getState().review.status).toBe('loading')
    await pending
    expect(store.getState().review.status).toBe('succeeded')
    expect(store.getState().review.list).toHaveLength(recentReviewList.length)
    expect(selectReviewSummaryList(store.getState())[0].findingTotal).toBe(6)
  })

  it('stores a load failure as plain AppError JSON and shows one toast', async () => {
    const { store, services, toast } = setup()
    services.review.list.mockRejectedValueOnce(new AppError({ code: ERROR_CODE.network, kind: 'network' }))

    await store.dispatch(fetchReviewList())
    await flush()

    const { status, error } = store.getState().review
    expect(status).toBe('failed')
    expect(error).toMatchObject({ name: 'AppError', code: ERROR_CODE.reviewLoad, causeCode: ERROR_CODE.network })
    expect(toast.error).toHaveBeenCalledWith('Could not load the review. Check your internet connection and try again.')
  })

  it('loads one review and builds the class in a selector', async () => {
    const { store } = setup()

    await store.dispatch(fetchReview('r1'))

    expect(store.getState().review.current).toMatchObject({ id: 'r1', saved: null })
    expect(selectCurrentReviewModel(store.getState())?.hasCriticalFinding).toBe(true)
  })

  it('records an unknown id as a missing review, without a toast', async () => {
    const { store, services, toast } = setup()
    services.review.get.mockResolvedValueOnce(null)

    await store.dispatch(fetchReview('nope'))
    await flush()

    expect(store.getState().review.current).toEqual({ id: 'nope', review: null, saved: null, analyzedContent: '', analyzedLanguage: '' })
    expect(selectCurrentReviewModel(store.getState())).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('clears the shown review while another id loads', async () => {
    const { store } = setup()
    await store.dispatch(fetchReview('r1'))

    const pending = store.dispatch(fetchReview('r2'))
    expect(store.getState().review.current).toBeNull()
    await pending
    expect(store.getState().review.current?.id).toBe('r2')
  })

  it('marks a failed load and keeps the toast for the Review failed preference', async () => {
    const { store, services, toast } = setup()
    services.review.get.mockRejectedValueOnce(new Error('boom'))
    store.dispatch(notificationSet({ type: 'reviewFailed', enabled: false }))

    await store.dispatch(fetchReview('r1'))
    await flush()

    expect(store.getState().review.currentStatus).toBe('failed')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('saves edits into the shown review and renames the list row', async () => {
    const { store, services } = setup()
    await store.dispatch(fetchReviewList())
    await store.dispatch(fetchReview('r1'))

    const result = await store.dispatch(saveReview({ id: 'r1', name: 'Mine', language: 'Go', code: 'x' }))

    expect(saveReview.fulfilled.match(result)).toBe(true)
    expect(services.review.save).toHaveBeenCalledWith('r1', { name: 'Mine', language: 'Go', code: 'x' })
    expect(store.getState().review.current?.saved).toMatchObject({ name: 'Mine', code: 'x' })
    expect(store.getState().review.list[0].title).toBe('Mine')
  })

  it('reports a save failure with the storage hint', async () => {
    const { store, services, toast } = setup()
    services.review.save.mockRejectedValueOnce(storageError())

    const result = await store.dispatch(saveReview({ id: 'r1', language: 'Go', code: 'x' }))
    await flush()

    expect(saveReview.rejected.match(result)).toBe(true)
    expect(toast.error).toHaveBeenCalledWith(
      'Could not save the review. Browser storage is unavailable, check your browser settings and try again.'
    )
  })

  it('renames and deletes', async () => {
    const { store } = setup()
    await store.dispatch(fetchReviewList())
    await store.dispatch(fetchReview('r1'))

    await store.dispatch(renameReview({ id: 'r1', name: 'Renamed' }))
    expect(store.getState().review.list[0].title).toBe('Renamed')

    await store.dispatch(deleteReview('r1'))
    expect(store.getState().review.list.map((item) => item.id)).not.toContain('r1')
    expect(store.getState().review.current).toBeNull()
  })

  it('keeps the row when delete fails', async () => {
    const { store, services, toast } = setup()
    services.review.delete.mockRejectedValueOnce(storageError())
    await store.dispatch(fetchReviewList())

    await store.dispatch(deleteReview('r1'))
    await flush()

    expect(store.getState().review.list).toHaveLength(recentReviewList.length)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Could not delete the review.'))
  })

  it('creates a review and shows it', async () => {
    const { store } = setup()

    await store.dispatch(createReview({ language: 'Go', content: 'x' }))

    expect(store.getState().review.current?.id).toBe('c1')
  })

  it('downloads the report through report.service and reports a failure', async () => {
    const { store, services, toast } = setup()
    await store.dispatch(downloadReport({ id: 'new', review: sampleReview, language: 'Go' }))
    expect(services.report.download).toHaveBeenCalledWith('new', sampleReview, 'Go')

    services.report.download.mockRejectedValueOnce(new Error('jspdf failed'))
    await store.dispatch(downloadReport({ id: 'new', review: sampleReview, language: 'Go' }))
    await flush()
    expect(toast.error).toHaveBeenCalledWith('Could not create the PDF report. Please try again.')
  })
})

describe('dashboard slice', () => {
  it('loads the dashboard and exposes an empty one before that', async () => {
    const { store } = setup()
    expect(selectDashboard(store.getState()).statList).toEqual([])

    await store.dispatch(fetchDashboard())

    expect(store.getState().dashboard.status).toBe('succeeded')
    expect(selectDashboard(store.getState()).findingTotal).toBe(48)
  })

  it('always shows a dashboard failure, even with every preference off', async () => {
    const { store, services, toast } = setup()
    for (const type of ['reviewCompleted', 'reviewFailed', 'criticalFinding', 'email'] as const) {
      store.dispatch(notificationSet({ type, enabled: false }))
    }
    services.dashboard.get.mockRejectedValueOnce(new AppError({ code: ERROR_CODE.timeout, kind: 'timeout' }))

    await store.dispatch(fetchDashboard())
    await flush()

    expect(store.getState().dashboard.status).toBe('failed')
    expect(toast.error).toHaveBeenCalledWith('Could not load the dashboard. The request timed out, please try again.')
  })
})

describe('github slice', () => {
  it('connects, searches, selects a repo and loads its files', async () => {
    const { store, services } = setup()

    await store.dispatch(connectGithub({ username: 'octocat', query: 'rep' }))
    expect(services.github.connect).toHaveBeenCalledWith('octocat')
    expect(services.github.searchRepo).toHaveBeenCalledWith('rep')
    expect(store.getState().github.account).toEqual({ login: 'octocat', name: 'The Octocat' })
    expect(store.getState().github.repoTruncated).toBe(false)

    await store.dispatch(searchRepo('x'))
    expect(store.getState().github.repoStatus).toBe('succeeded')

    const pending = store.dispatch(selectRepo('repo'))
    expect(store.getState().github.selectedRepoId).toBe('repo')
    await pending
    expect(store.getState().github.fileList).toHaveLength(1)
  })

  it('keeps only the newest search result', async () => {
    const { store, services } = setup()
    let resolveOld: (value: { items: { id: string; name: string; description: string }[]; truncated: boolean }) => void = () => {}
    services.github.searchRepo
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ items: [{ id: 'new', name: 'new', description: '' }], truncated: true })

    const old = store.dispatch(searchRepo('o'))
    await store.dispatch(searchRepo('n'))
    resolveOld({ items: [{ id: 'old', name: 'old', description: '' }], truncated: false })
    await old

    expect(store.getState().github.repoList.map((repo) => repo.id)).toEqual(['new'])
    expect(store.getState().github.repoTruncated).toBe(true)
  })

  it('shows a connect failure regardless of preferences', async () => {
    const { store, services, toast } = setup()
    // Plan 035: a 401 always ends the session (see session.test.tsx), so a server failure is used.
    services.github.connect.mockRejectedValueOnce(AppError.fromResponse(502, { error: { code: 'bad_gateway', message: 'x' } }))

    await store.dispatch(connectGithub({ username: 'octocat' }))
    await flush()

    expect(store.getState().github.status).toBe('failed')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error.mock.calls[0][0]).toMatch(/^GitHub authorization failed\. /)
  })

  it('disconnects, clears the repo and resets', async () => {
    const { store } = setup()
    await store.dispatch(connectGithub({ username: 'octocat' }))
    await store.dispatch(selectRepo('repo'))

    store.dispatch(repoCleared())
    expect(store.getState().github.selectedRepoId).toBeNull()
    store.dispatch(githubDisconnected())
    expect(store.getState().github.account).toBeNull()
    store.dispatch(githubReset())
    expect(store.getState().github.repoList).toEqual([])
  })
})

describe('settings slice', () => {
  it('hydrates from settings.service.read and saves every change', async () => {
    const { store, services } = setup()
    expect(services.settings.read).toHaveBeenCalled()

    store.dispatch(settingsUpdated({ theme: 'dark' }))
    store.dispatch(notificationSet({ type: 'email', enabled: true }))
    await flush()

    expect(store.getState().settings.theme).toBe('dark')
    expect(services.settings.save).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark', notification: expect.objectContaining({ email: true }) }))
  })

  it('replaces the state with the loaded settings and does not save them back', async () => {
    const { store, services } = setup()
    services.settings.get.mockResolvedValueOnce({ ...store.getState().settings, theme: 'system' })

    await store.dispatch(fetchSettings())
    await flush()

    expect(store.getState().settings.theme).toBe('system')
    expect(services.settings.save).not.toHaveBeenCalled()
  })

  it('always shows a settings save failure', async () => {
    const { store, services, toast } = setup()
    services.settings.save.mockRejectedValueOnce(new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 }))
    store.dispatch(notificationSet({ type: 'reviewFailed', enabled: false }))
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Could not save your settings. The server had a problem, please try again shortly.')
  })
})

describe('support slice', () => {
  it('submits and stores the ticket, then resets', async () => {
    const { store } = setup()
    const request = { issueType: 'other' as const, email: 'a@b.co', reviewId: '', priority: 'normal' as const, description: 'long enough text' }

    const pending = store.dispatch(submitSupportRequest(request))
    expect(store.getState().support.status).toBe('loading')
    await pending
    expect(store.getState().support.ticket).toBe('SUP-1234')

    store.dispatch(supportReset())
    expect(store.getState().support).toEqual({ status: 'idle', ticket: null, error: null })
  })

  it('clears the previous ticket while the next request is in flight', async () => {
    const { store, services } = setup()
    const request = { issueType: 'other' as const, email: 'a@b.co', reviewId: '', priority: 'normal' as const, description: 'long enough text' }
    services.support.submit.mockResolvedValueOnce({ ticket: 'SUP-1001' })

    await store.dispatch(submitSupportRequest(request))
    expect(store.getState().support).toMatchObject({ status: 'succeeded', ticket: 'SUP-1001' })

    const pending = store.dispatch(submitSupportRequest(request))
    expect(store.getState().support).toMatchObject({ status: 'loading', ticket: null })
    await pending
    expect(store.getState().support).toEqual({ status: 'succeeded', ticket: 'SUP-1234', error: null })
  })

  it('shows the wait of a 429 in the toast (rate limit since contract 0.10.0)', async () => {
    const { store, services, toast } = setup()
    services.support.submit.mockRejectedValueOnce(AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'x', details: { retryAfterSecond: 3540 } } }))

    await store.dispatch(submitSupportRequest({ issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: 'long enough text' }))
    await flush()

    expect(store.getState().support).toMatchObject({ status: 'failed', ticket: null })
    expect(toast.error).toHaveBeenCalledWith('Could not submit your request. Too many support requests. Try again in 59 minutes.')
  })

  it('names no wait when a 429 has no retryAfterSecond', async () => {
    const { store, services, toast } = setup()
    services.support.submit.mockRejectedValueOnce(AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'x' } }))

    await store.dispatch(submitSupportRequest({ issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: 'long enough text' }))
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Could not submit your request. Too many support requests. Try again later.')
  })

  it('records a submit failure and shows the toast', async () => {
    const { store, services, toast } = setup()
    services.support.submit.mockRejectedValueOnce(new AppError({ code: ERROR_CODE.network, kind: 'network' }))

    await store.dispatch(submitSupportRequest({ issueType: 'other', email: 'a@b.co', reviewId: '', priority: 'low', description: 'long enough text' }))
    await flush()

    expect(store.getState().support.status).toBe('failed')
    expect(toast.error).toHaveBeenCalledWith('Could not submit your request. Check your internet connection and try again.')
  })
})

describe('listener middleware', () => {
  it('collapses repeated failures into one toast', async () => {
    const { store, services, toast } = setup()
    services.dashboard.get.mockRejectedValue(new AppError({ code: ERROR_CODE.network, kind: 'network' }))

    await store.dispatch(fetchDashboard())
    await store.dispatch(fetchDashboard())
    await flush()

    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('ignores a thunk aborted by its caller', async () => {
    const { store, services, toast } = setup()
    services.review.list.mockImplementationOnce(() => new Promise(() => {}))

    const pending = store.dispatch(fetchReviewList())
    pending.abort()
    await pending
    await flush()

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows errors reported outside thunks', async () => {
    const { store, toast } = setup()

    store.dispatch(errorReported(new AppError({ code: ERROR_CODE.clipboard, kind: 'unknown' }).toJSON()))
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Could not copy to clipboard')
  })

  it('keeps state serializable (no Redux Toolkit warnings) through success and failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, services } = setup()
    services.review.save.mockRejectedValueOnce(storageError())

    await store.dispatch(fetchReviewList())
    await store.dispatch(fetchReview('r1'))
    await store.dispatch(saveReview({ id: 'r1', language: 'Go', code: 'x' }))
    await store.dispatch(fetchDashboard())
    await flush()

    expect(consoleError).not.toHaveBeenCalled()
    expect(() => JSON.stringify(store.getState())).not.toThrow()
    expect(JSON.parse(JSON.stringify(store.getState()))).toEqual(store.getState())
  })
})
