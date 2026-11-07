import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { AppSettings } from '../../src/models/settings.model'
import { SESSION_TOKEN_STORAGE_KEY } from '../../src/lib/api.constants'
import { createServices } from '../../src/services'
import { createDashboardService } from '../../src/services/dashboard.service'
import { createGithubService } from '../../src/services/github.service'
import { createReportService } from '../../src/services/report.service'
import { createSettingsService, settingsStorageKey } from '../../src/services/settings.service'
import { createStorageService, type StorageService } from '../../src/services/storage.service'
import { createSupportService } from '../../src/services/support.service'
import { ERROR_CODE } from '../../src/utils/error-messages'
import type { SupportRequest } from '../../src/types'
import { downloadReportPdf } from '../../src/lib/reportPdf'
import { answering, createFakeDataSource } from '../utils/fakeDataSource'
import { activityByRange, categoryCountList, dashboardStatList, githubRepoList, recentReviewList, severityCountList } from '../utils/sampleData'

vi.mock('../../src/lib/reportPdf', () => ({ downloadReportPdf: vi.fn().mockResolvedValue(undefined) }))

const dashboardDto = { statList: dashboardStatList, severityCountList, categoryCountList, activityByRange }

const validRequest: SupportRequest = {
  issueType: 'other',
  email: ' a@b.co ',
  reviewId: '',
  priority: 'normal',
  description: 'Something is broken here'
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('dashboard.service', () => {
  it('reads GET /api/dashboard', async () => {
    const { source, call } = answering(dashboardDto)

    expect(await createDashboardService(source).get()).toEqual(dashboardDto)
    expect(call).toHaveBeenCalledWith('GET', '/api/dashboard', undefined, undefined)
  })

  it('rejects a malformed payload with a parse AppError', async () => {
    await expect(createDashboardService(answering({ statList: 'x' }).source).get()).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })
})

describe('github.service', () => {
  it('calls the GitHub routes with a trimmed query and an encoded repo id', async () => {
    const { source, call } = createFakeDataSource((_method, url) => {
      if (url === '/api/github/connect') return { login: 'octocat', name: null }
      if (url === '/api/github/repo') return { items: githubRepoList, truncated: true }
      return { items: [{ id: 'f', path: 'a.ts', language: 'TypeScript' }], truncated: false }
    })
    const service = createGithubService(source)

    expect(await service.connect('octocat')).toEqual({ login: 'octocat', name: null })
    expect(await service.searchRepo(' api ')).toEqual({ items: githubRepoList, truncated: true })
    expect((await service.listFile('a/b')).items).toHaveLength(1)

    // The user name is the whole body (contract GithubConnect).
    expect(call.mock.calls[0][2]).toEqual({ username: 'octocat' })
    expect(call.mock.calls.map(([method, url, , option]) => [method, url, option?.query])).toEqual([
      ['POST', '/api/github/connect', undefined],
      ['GET', '/api/github/repo', { query: 'api' }],
      ['GET', '/api/github/repo/a%2Fb/file', undefined]
    ])
  })

  it('sends no query for an empty search', async () => {
    const { source, call } = answering({ items: [], truncated: false })

    await createGithubService(source).searchRepo('  ')

    expect(call.mock.calls[0][3]).toEqual({ query: { query: undefined } })
  })

  it('rejects a malformed response and passes data source errors through', async () => {
    await expect(createGithubService(answering([{ id: 1 }]).source).searchRepo('')).rejects.toMatchObject({ code: ERROR_CODE.parse })
    // Contract 0.9.0: a plain array (0.8.0) or a list without `truncated` is refused too.
    await expect(createGithubService(answering([]).source).searchRepo('')).rejects.toMatchObject({ code: ERROR_CODE.parse })
    await expect(createGithubService(answering({ items: [] }).source).listFile('a')).rejects.toMatchObject({ code: ERROR_CODE.parse })
    await expect(createGithubService(answering({ email: 'a@b.co' }).source).connect('a')).rejects.toMatchObject({ code: ERROR_CODE.parse })

    const { source } = createFakeDataSource(() => {
      throw new AppError({ code: ERROR_CODE.unauthorized, kind: 'http', status: 401 })
    })
    await expect(createGithubService(source).connect('octocat')).rejects.toMatchObject({ code: ERROR_CODE.unauthorized })
  })
})

describe('settings.service', () => {
  it('reads the cache synchronously: defaults, stored values, corrupt storage', () => {
    const service = createSettingsService(answering({}).source, createStorageService())
    expect(service.read()).toEqual(AppSettings.defaultDto())

    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ theme: 'dark' }))
    expect(service.read().theme).toBe('dark')

    window.localStorage.setItem(settingsStorageKey, '{not json')
    expect(service.read()).toEqual(AppSettings.defaultDto())
  })

  it('gets /api/settings merged over the defaults and caches the result', async () => {
    const { source, call } = answering({ theme: 'dark', bogus: 1 })
    const service = createSettingsService(source, createStorageService())

    const settings = await service.get()

    expect(settings).toEqual({ ...AppSettings.defaultDto(), theme: 'dark' })
    expect(service.read().theme).toBe('dark')
    // Plan 037 (Open Question 3A): the silent settings load is background work.
    expect(call).toHaveBeenCalledWith('GET', '/api/settings', undefined, { background: true })
  })

  it('puts the settings and keeps quiet when only the cache cannot be written', async () => {
    const { source, call } = answering(undefined)
    const service = createSettingsService(source, createStorageService())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    await expect(service.save({ ...AppSettings.defaultDto(), theme: 'dark' })).resolves.toBeUndefined()
    expect(call).toHaveBeenCalledWith('PUT', '/api/settings', { ...AppSettings.defaultDto(), theme: 'dark' }, undefined)
  })

  it('save rejects when the data source fails', async () => {
    const { source } = createFakeDataSource(() => {
      throw new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 })
    })

    await expect(createSettingsService(source, createStorageService()).save(AppSettings.defaultDto())).rejects.toMatchObject({
      code: ERROR_CODE.server
    })
  })
})

describe('support.service', () => {
  it('posts the trimmed request and reads the ticket (contract 0.11.0)', async () => {
    const { source, call } = answering({ ticket: 'SUP-1234' })

    expect(await createSupportService(source).submit(validRequest)).toEqual({ ticket: 'SUP-1234' })
    const [method, url, body] = call.mock.calls[0]
    expect([method, url]).toEqual(['POST', '/api/support-request'])
    expect(body).toMatchObject({ email: 'a@b.co' })
  })

  it('rejects an invalid request before sending it', async () => {
    const { source, call } = answering({ ticket: 'SUP-1' })

    await expect(createSupportService(source).submit({ ...validRequest, email: 'nope' })).rejects.toMatchObject({
      code: ERROR_CODE.validation,
      kind: 'validation'
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects a response without a ticket', async () => {
    await expect(createSupportService(answering({}).source).submit(validRequest)).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })

  it('drops unknown fields (also a leftover 0.10.0 emailed)', async () => {
    const { source } = answering({ ticket: 'SUP-1001', emailed: false, extra: 'x' })

    expect(await createSupportService(source).submit(validRequest)).toEqual({ ticket: 'SUP-1001' })
  })

  it('rejects a ticket that is not a string', async () => {
    await expect(createSupportService(answering({ ticket: 42 }).source).submit(validRequest)).rejects.toMatchObject({ code: ERROR_CODE.parse })
  })
})

describe('report.service', () => {
  it('builds the PDF in the browser', async () => {
    await createReportService().download('r1', {} as never, 'Go')

    expect(downloadReportPdf).toHaveBeenCalledWith('r1', {}, 'Go')
  })
})

describe('createServices', () => {
  it('uses the injected data source for every domain service', async () => {
    const { source, call } = createFakeDataSource((method, url) => {
      if (url === '/api/review') return recentReviewList
      if (url === '/api/dashboard') return dashboardDto
      if (url === '/api/github/connect') return { login: 'octocat', name: null }
      if (url === '/api/settings') return {}
      if (url === '/api/support-request') return { ticket: 'SUP-1' }
      return method
    })
    const services = createServices({ dataSource: source })

    await services.review.list()
    await services.dashboard.get()
    await services.github.connect('octocat')
    await services.settings.get()
    await services.support.submit(validRequest)

    expect(call.mock.calls.map(([method, url]) => `${method} ${url}`)).toEqual([
      'GET /api/review',
      'GET /api/dashboard',
      'POST /api/github/connect',
      'GET /api/settings',
      'POST /api/support-request'
    ])
  })

  // Plan 035, Validation 5: with no override the services talk to the HTTP API only.
  it('defaults to the HTTP data source: GET /api/... goes through fetch, never browser storage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/review') return new Response(JSON.stringify(recentReviewList), { status: 200 })
      return new Response(JSON.stringify(dashboardDto), { status: 200 })
    })
    const storage: StorageService = { get: vi.fn(), getOr: vi.fn(), set: vi.fn(), remove: vi.fn(), has: vi.fn() }
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const services = createServices({ storage })

    expect(await services.dashboard.get()).toEqual(dashboardDto)
    expect(await services.review.list()).toEqual(recentReviewList)

    expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(['/api/dashboard', '/api/review'])
    // Plan 047: the one read is the session token (token mode), once, when the source is built.
    expect(storage.get).toHaveBeenCalledTimes(1)
    expect(vi.mocked(storage.get).mock.calls[0][0]).toBe(SESSION_TOKEN_STORAGE_KEY)
    expect(storage.getOr).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('a failing backend is an AppError from the HTTP data source, with no fallback data', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(createServices().dashboard.get()).rejects.toBeInstanceOf(AppError)
  })
})
