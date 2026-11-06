import { ACCOUNT_FIELD, AVATAR_LIMIT, AVATAR_TYPE_LIST, PASSWORD_FIELD, PASSWORD_LIMIT } from '../../src/lib/account.constants'
import { API_ERROR_CODE, API_PATH, HTTP_STATUS } from '../../src/lib/api.constants'
import { readBytes, sniffAvatarType, toDataUrl } from '../../src/lib/avatarFile'
import { passwordRuleError } from '../../src/lib/password-rule'
import { emailError, usernameError } from '../../src/lib/sessionForm'
import { NEW_REVIEW_TITLE, REVIEW_LIMIT } from '../../src/lib/review.constants'
import { validateSupportRequest } from '../../src/lib/validateSupportRequest'
import { AppError, type FieldIssue } from '../../src/models/app-error'
import type { AccountDto, GeneratedTestFileDto, ReviewDto, SavedReviewDto, SupportRequestDto, TestConfigDto } from '../../src/models/dto'
import { hasFields, isOneOf, isOptional, isRecord, isString } from '../../src/models/guard'
import { githubLinkKey, githubRepoKey, isGithubUsername, parseGithubLink } from '../../src/models/github.model'
import {
  isSavedReviewDto,
  isTestConfigDto,
  orderedTestTypeIdList,
  Review,
  REVIEW_STATUS,
  reviewNameMaxLength,
  ReviewSummary,
  unfinishedStatusList
} from '../../src/models/review.model'
import { AppSettings, isSettingsDto } from '../../src/models/settings.model'
import { DEV_ERROR_MESSAGE, DEV_ISSUE_MESSAGE, ERROR_CODE } from '../../src/utils/error-messages'
import type { DataSource, HttpMethod, Query, RequestOption } from '../../src/services/data-source'
import { fixtureData, type FixtureData } from './fixtureData'
import { settingsStorageKey } from '../../src/services/settings.service'
import { createServices, type Services, type ServicesOption } from '../../src/services'
import { createStorageService, type StorageService } from '../../src/services/storage.service'
import { createId, createTicketNumber, delay, formatTimeAgo, matchesQuery } from '../../src/services/util.service'

// Test only (plan 035): an in-memory fake backend for unit tests. It serves the routes of
// .orchestrate/api-contract.yaml (except the test-only reset route and the session routes) from
// tests/fixtures/*.json and keeps the user's writes (saved, renamed and deleted reviews;
// settings) in the test's browser storage. It answers in the contract shapes and throws the
// AppErrors the API would (404, 409, 422), so the domain services cannot tell it from the HTTP
// API. Like the backend it has no review for `new`: a review created in this session starts
// `pending` and completes at once with the template's results; Run review on an existing review
// (POST /api/review/{id}/run) does the same in place. Created reviews, runs, regenerated tests
// and the changed password last for the session only.
// The session and registration routes are not served (a call is a 404): tests that need them
// use fake services (tests/utils/fakeServices.ts). The profile photo is kept as a data URL.

// The route patterns this fake backend serves: `{name}` captures one path segment.
export const API_ROUTE = {
  review: API_PATH.review,
  reviewById: '/api/review/{id}',
  reviewRun: '/api/review/{id}/run',
  generatedTest: '/api/review/{id}/generated-test',
  dashboard: API_PATH.dashboard,
  githubConnect: API_PATH.githubConnect,
  githubDisconnect: API_PATH.githubDisconnect,
  githubRepo: API_PATH.githubRepo,
  githubFileList: '/api/github/repo/{repoId}/file',
  githubFile: '/api/github/repo/{repoId}/file/{fileId}',
  githubImport: API_PATH.githubImport,
  settings: API_PATH.settings,
  supportRequest: API_PATH.supportRequest,
  account: API_PATH.account,
  accountPassword: API_PATH.accountPassword,
  accountAvatar: API_PATH.accountAvatar
} as const

// Every id path segment the backend accepts (ReviewId and RepoId in the contract).
export const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

// The browser storage keys of the saved and deleted reviews (tests/utils/reviewStorage.ts).
export const savedReviewsKey = 'saved-reviews'
export const deletedReviewsKey = 'deleted-reviews'

export const fixtureSupportDelayMs = 400

export interface FixtureDataSourceOption {
  storage?: StorageService
  supportDelayMs?: number
  now?: () => Date
  data?: FixtureData
}

interface RouteRequest {
  param: Record<string, string>
  body: unknown
  query: Query
  contentType?: string
}

type Handler = (request: RouteRequest) => unknown

interface Route {
  method: HttpMethod
  pattern: RegExp
  paramList: string[]
  handler: Handler
}

type SavedReviewMap = Record<string, SavedReviewDto>

interface CreatedReview {
  id: string
  createdAt: number
  review: ReviewDto
}

// The completed result of the latest Run review of a review, and when it ran.
interface RunResult {
  analyzedAt: number
  review: ReviewDto
}

const isSavedReviewMap = (value: unknown): value is SavedReviewMap => isRecord(value)

const isSaveReviewBody = (value: unknown): value is { name?: string; language: string; code: string } =>
  hasFields(value, { name: isOptional(isString), language: isString, code: isString })

const isNewReviewBody = (value: unknown): value is { title?: string; language: string; content: string } =>
  hasFields(value, { title: isOptional(isString), language: isString, content: isString })

const isPasswordChangeBody = (value: unknown): value is { currentPassword: string; newPassword: string } =>
  hasFields(value, { currentPassword: isString, newPassword: isString })

// PUT /api/account (plan 034): only these fields, as the backend's strict schema.
const accountUpdateKeyList: string[] = [ACCOUNT_FIELD.username, ACCOUNT_FIELD.email, ACCOUNT_FIELD.currentPassword]

const isAccountUpdateBody = (value: unknown): value is { username?: string; email?: string; currentPassword?: string } =>
  isRecord(value) &&
  Object.keys(value).every((key) => accountUpdateKeyList.includes(key)) &&
  hasFields(value, { username: isOptional(isString), email: isOptional(isString), currentPassword: isOptional(isString) })

const isSupportRequestBody = (value: unknown): value is SupportRequestDto =>
  hasFields(value, {
    issueType: isOneOf(['', 'review_failed', 'upload', 'github', 'account', 'other'] as const),
    email: isString,
    reviewId: isString,
    priority: isOneOf(['low', 'normal', 'high'] as const),
    description: isString
  })

function httpError(status: number, code: string, message: string, issueList?: FieldIssue[], details?: Record<string, unknown>): AppError {
  return AppError.fromResponse(status, { error: { code, message, details: issueList ? { ...details, issue: issueList } : details } })
}

const notFound = (message: string) => httpError(HTTP_STATUS.notFound, API_ERROR_CODE.notFound, message)
const invalid = (message: string, issueList?: FieldIssue[]) =>
  httpError(HTTP_STATUS.unprocessable, API_ERROR_CODE.validation, message, issueList)
// The request field a bad GitHub link is reported on (`details.issue[0].field`), as on the backend.
const GITHUB_IMPORT_FIELD = 'url'
// The request field a bad GitHub user name is reported on (POST /api/github/connect, plan 030).
const GITHUB_CONNECT_FIELD = 'username'

const conflict = (message: string) => httpError(HTTP_STATUS.conflict, API_ERROR_CODE.conflict, message)

// The field a refused profile photo is reported on, as on the backend.
const AVATAR_FIELD = 'avatar'
const avatarInvalid = () => invalid(DEV_ERROR_MESSAGE.invalidAvatar, [{ field: AVATAR_FIELD, message: DEV_ISSUE_MESSAGE.invalid }])

function clone<T>(value: T): T {
  return structuredClone(value)
}

// '/api/review/{id}' -> a regex that captures `id`.
function route(method: HttpMethod, path: string, handler: Handler): Route {
  const paramList: string[] = []
  const source = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_match, name: string) => {
    paramList.push(name)
    return '([^/]+)'
  })
  return { method, pattern: new RegExp(`^${source}$`), paramList, handler }
}

export function createFixtureDataSource(option: FixtureDataSourceOption = {}): DataSource {
  const storage = option.storage ?? createStorageService()
  const supportDelayMs = option.supportDelayMs ?? fixtureSupportDelayMs
  const now = option.now ?? (() => new Date())
  const data = option.data ?? fixtureData

  function readAll(): SavedReviewMap {
    return storage.getOr(savedReviewsKey, isSavedReviewMap, {})
  }

  function loadSaved(id: string): SavedReviewDto | null {
    const all = readAll()
    if (!Object.hasOwn(all, id)) return null
    return isSavedReviewDto(all[id]) ? all[id] : null
  }

  function loadDeletedIdList(): string[] {
    const value = storage.get<unknown>(deletedReviewsKey, (item): item is unknown => Array.isArray(item))
    return Array.isArray(value) ? value.filter(isString) : []
  }

  // Session-only state (kept in memory, not persisted). Created reviews are newest first.
  const createdList: CreatedReview[] = []
  const generatedTestById = new Map<string, GeneratedTestFileDto[]>()
  // Plan 034: the test configuration Regenerate stored, by review id (session only).
  const testConfigById = new Map<string, TestConfigDto>()
  const runById = new Map<string, RunResult>()
  let password = data.password
  let account: AccountDto = clone(data.account)
  // Plan 030: whether the fixture GitHub account is connected, as the backend stores it per account.
  let githubConnected = false

  // The repository routes need a connection: 409 conflict otherwise (contract 0.9.0).
  function requireGithub() {
    if (!githubConnected) throw conflict(DEV_ERROR_MESSAGE.githubNotConnected)
  }

  function findAny(id: string): ReviewDto | undefined {
    const created = createdList.find((item) => item.id === id)
    const run = runById.get(id)
    const base = run
      ? { ...run.review, analyzedAgo: formatTimeAgo(run.analyzedAt, now()) }
      : created
      ? { ...created.review, analyzedAgo: formatTimeAgo(created.createdAt, now()) }
      : Object.hasOwn(data.reviewById, id)
        ? data.reviewById[id]
        : undefined
    if (!base) return undefined
    const generatedTest = generatedTestById.get(id)
    // Contract 0.13.0: the test configuration Regenerate stored; a review without one has none
    // here, which every client reads as the default (models/review.model.ts testConfigOf).
    const testConfig = testConfigById.get(id)
    return { ...base, ...(generatedTest ? { generatedTest } : {}), ...(testConfig ? { testConfig } : {}) }
  }

  // A review that exists and is not deleted; otherwise a 404, as on the backend.
  function findLive(id: string): ReviewDto {
    const review = loadDeletedIdList().includes(id) ? undefined : findAny(id)
    if (!review) throw notFound(DEV_ERROR_MESSAGE.noSuchReview)
    return review
  }

  // GET /api/review/{id}: the review with the saved edits applied, `savedAt`, and the code and
  // language its findings belong to.
  function detailOf(id: string, review: ReviewDto) {
    const saved = loadSaved(id)
    const analyzed = { analyzedContent: review.content, analyzedLanguage: review.language }
    if (!saved) return { ...clone(review), savedAt: null, ...analyzed }
    return {
      ...clone(review),
      title: saved.name ?? review.title,
      language: saved.language,
      content: saved.code,
      savedAt: saved.savedAt,
      ...analyzed
    }
  }

  // PUT /api/review/{id} (and the save step of Run review). A save without a name keeps the saved
  // name, as on the backend.
  function saveEdit(id: string, body: { name?: string; language: string; code: string }): SavedReviewDto {
    const saved: SavedReviewDto = { name: body.name ?? loadSaved(id)?.name, language: body.language, code: body.code, savedAt: now().toISOString() }
    if (saved.name === undefined) delete saved.name
    storage.set(savedReviewsKey, { ...readAll(), [id]: saved })
    return saved
  }

  function fileListOf(repoId: string) {
    requireGithub()
    if (!Object.hasOwn(data.githubFileListByRepo, repoId)) throw notFound(DEV_ERROR_MESSAGE.noSuchRepo)
    return data.githubFileListByRepo[repoId]
  }

  const routeList: Route[] = [
    // Created reviews first (newest first), then the seed. A saved name replaces the title;
    // deleted reviews are hidden.
    route('GET', API_ROUTE.review, () => {
      const deleted = loadDeletedIdList()
      // `timeAgo` is the time since creation, as on the backend: Run review restarts `analyzedAgo`
      // but never moves the row's created date.
      const createdSummaryList = createdList.map(({ id, createdAt }) =>
        new Review(findAny(id) as ReviewDto).toSummary(id, formatTimeAgo(createdAt, now()))
      )
      // A seeded review that was run (Run review) is listed from its current state, as created ones
      // are, with its seeded creation time.
      const seedSummaryList = data.reviewSummaryList.map((review) =>
        runById.has(review.id) ? new Review(findAny(review.id) as ReviewDto).toSummary(review.id, review.timeAgo) : new ReviewSummary(review)
      )
      return [...createdSummaryList, ...seedSummaryList]
        .filter((review) => !deleted.includes(review.id))
        .map((review) => review.withName(loadSaved(review.id)?.name).toDto())
    }),

    // Answers `pending` with empty results, as the backend's 202 does; the next GET finds it
    // completed with the template's results (the backend's stub analyzer finishes as fast).
    route('POST', API_ROUTE.review, ({ body }) => {
      // The same limits as the backend: non-blank content of at most 100 000 characters and a title
      // of at most 120.
      if (
        !isNewReviewBody(body) ||
        !body.content.trim() ||
        !body.language.trim() ||
        body.content.length > REVIEW_LIMIT.contentMax ||
        (body.title?.trim().length ?? 0) > REVIEW_LIMIT.titleMax
      ) {
        throw invalid(DEV_ERROR_MESSAGE.invalidReview)
      }
      const id = createId('review')
      const createdAt = now().getTime()
      const title = body.title?.trim() || NEW_REVIEW_TITLE
      const completed: ReviewDto = {
        ...clone(data.reviewTemplate),
        title,
        status: REVIEW_STATUS.completed,
        language: body.language,
        content: body.content
      }
      createdList.unshift({ id, createdAt, review: completed })
      const pending: ReviewDto = {
        ...clone(completed),
        status: REVIEW_STATUS.pending,
        analyzedAgo: formatTimeAgo(createdAt, createdAt),
        qualityScore: 0,
        findingCount: [],
        finding: [],
        suggestion: [],
        generatedTest: []
      }
      return { ...pending, id }
    }),

    // The review with the saved edits applied, and `savedAt` once the user has saved it.
    // `analyzedContent` / `analyzedLanguage`: the code its findings belong to (before the edits).
    route('GET', API_ROUTE.reviewById, ({ param: { id } }) => detailOf(id, findLive(id))),

    // Run review on an existing review: saves the edit like PUT, then re-analyzes the same id. It
    // answers pending with empty results; the next GET finds it completed with the template's
    // results, as after POST /api/review. 409 while the review is unfinished.
    route('POST', API_ROUTE.reviewRun, ({ param: { id }, body }) => {
      // The SaveReview schema of the contract: code 1 to 100 000 characters, language 1 to 40, name 1 to 80.
      if (
        !isSaveReviewBody(body) ||
        !body.code ||
        body.code.length > REVIEW_LIMIT.contentMax ||
        !body.language ||
        body.language.length > REVIEW_LIMIT.languageMax ||
        (body.name !== undefined && (!body.name || body.name.length > reviewNameMaxLength))
      ) {
        throw invalid(DEV_ERROR_MESSAGE.invalidSavedReview)
      }
      const review = findLive(id)
      if (unfinishedStatusList.includes(review.status)) throw conflict(DEV_ERROR_MESSAGE.reviewUnfinished)
      saveEdit(id, body)
      const analyzedAt = now().getTime()
      const completed: ReviewDto = {
        ...clone(data.reviewTemplate),
        title: review.title,
        status: REVIEW_STATUS.completed,
        language: body.language,
        content: body.code
      }
      runById.set(id, { analyzedAt, review: completed })
      generatedTestById.delete(id)
      const pending: ReviewDto = {
        ...clone(completed),
        status: REVIEW_STATUS.pending,
        analyzedAgo: formatTimeAgo(analyzedAt, analyzedAt),
        qualityScore: 0,
        findingCount: [],
        finding: [],
        suggestion: [],
        generatedTest: []
      }
      return { ...detailOf(id, pending), id }
    }),

    // A save without a name keeps the saved name, as on the backend.
    route('PUT', API_ROUTE.reviewById, ({ param: { id }, body }) => {
      if (!isSaveReviewBody(body)) throw invalid(DEV_ERROR_MESSAGE.invalidSavedReview)
      findLive(id)
      return saveEdit(id, body)
    }),

    route('PATCH', API_ROUTE.reviewById, ({ param: { id }, body }) => {
      // The name is trimmed and has 1 to 80 characters, as on the backend.
      const name = hasFields(body, { name: isString }) ? String(body.name).trim() : ''
      if (!name || name.length > reviewNameMaxLength) throw invalid(DEV_ERROR_MESSAGE.invalidName)
      findLive(id)
      const saved = loadSaved(id)
      if (!saved) throw notFound(DEV_ERROR_MESSAGE.noSavedReview)
      const next: SavedReviewDto = { ...saved, name, savedAt: now().toISOString() }
      storage.set(savedReviewsKey, { ...readAll(), [id]: next })
      return next
    }),

    // Records the deletion first, then drops the saved edits. If the second write fails the
    // deletion is rolled back, so a failed delete never loses the saved name or code.
    route('DELETE', API_ROUTE.reviewById, ({ param: { id } }) => {
      findLive(id)
      const deleted = loadDeletedIdList()
      storage.set(deletedReviewsKey, [...deleted, id])
      const all = readAll()
      if (!Object.hasOwn(all, id)) return undefined
      delete all[id]
      try {
        storage.set(savedReviewsKey, all)
      } catch (error) {
        try {
          storage.set(deletedReviewsKey, deleted)
        } catch {
          // Storage is failing altogether; the original error is the one to report.
        }
        throw error
      }
      return undefined
    }),

    // Swaps each file's code with its variant, so a second Regenerate brings the first back.
    // Plan 034: an optional TestConfig body (422 when it is not one, as on the backend) is stored
    // with the review; GET then returns it as `testConfig`.
    route('POST', API_ROUTE.generatedTest, ({ param: { id }, body }) => {
      const hasBody = body !== undefined && !(isRecord(body) && Object.keys(body).length === 0)
      if (hasBody && !isTestConfigDto(body)) throw invalid(DEV_ERROR_MESSAGE.invalidTestConfig)
      const review = findLive(id)
      if (review.status !== REVIEW_STATUS.completed) throw conflict(DEV_ERROR_MESSAGE.reviewNotCompleted)
      if (hasBody && isTestConfigDto(body)) testConfigById.set(id, { framework: body.framework, testTypeIdList: orderedTestTypeIdList(body.testTypeIdList) })
      const fileList = review.generatedTest.map((file) => ({ ...clone(file), code: file.altCode, altCode: file.code }))
      generatedTestById.set(id, fileList)
      return clone(fileList)
    }),

    route('GET', API_ROUTE.dashboard, () => clone(data.dashboard)),

    // The body is checked as on the backend (contract 0.9.0): { username } only, GitHub's
    // user-name pattern (422), and a user name other than the fixture account's is an unknown
    // GitHub user (404, nothing connected).
    route('POST', API_ROUTE.githubConnect, ({ body }) => {
      const username = hasFields(body, { username: isString }) && Object.keys(body).length === 1 ? String(body.username) : ''
      if (!isGithubUsername(username)) {
        throw invalid(DEV_ERROR_MESSAGE.githubUsernameInvalid, [{ field: GITHUB_CONNECT_FIELD, message: DEV_ISSUE_MESSAGE.invalid }])
      }
      if (username.toLowerCase() !== data.githubAccount.login.toLowerCase()) throw notFound(DEV_ERROR_MESSAGE.githubUserNotFound)
      githubConnected = true
      return clone(data.githubAccount)
    }),

    // Idempotent, as on the backend.
    route('POST', API_ROUTE.githubDisconnect, () => {
      githubConnected = false
      return undefined
    }),

    // Repositories whose name contains the query (case-insensitive); all of them for no query.
    // The fixture has fewer repositories than one GitHub page, so the list is never truncated.
    route('GET', API_ROUTE.githubRepo, ({ query }) => {
      requireGithub()
      const text = isString(query.query) ? query.query : ''
      return { items: data.githubRepoList.filter((repo) => matchesQuery(repo.name, text)).map((repo) => clone(repo)), truncated: false }
    }),

    route('GET', API_ROUTE.githubFileList, ({ param: { repoId } }) => ({ items: clone(fileListOf(repoId)), truncated: false })),

    route('GET', API_ROUTE.githubFile, ({ param: { repoId, fileId } }) => {
      const file = fileListOf(repoId).find((item) => item.id === fileId)
      if (!file) throw notFound(DEV_ERROR_MESSAGE.noSuchFile)
      const content = Object.hasOwn(data.githubFileContentById, fileId) ? data.githubFileContentById[fileId] : ''
      return { ...clone(file), content }
    }),

    // The backend's fake GitHub (GITHUB_FAKE=true) for the same links, with no network: the file
    // and pull-request links answer the seeded code; the huge file, the rate-limited, broken and
    // slow repositories answer 413, 429, 502 and 504; any other well-formed link is a 404.
    route('POST', API_ROUTE.githubImport, ({ body }) => {
      const url = hasFields(body, { url: isString }) && Object.keys(body).length === 1 ? String(body.url) : ''
      const link = parseGithubLink(url)
      if (!link) throw invalid(DEV_ERROR_MESSAGE.githubLinkInvalid, [{ field: GITHUB_IMPORT_FIELD, message: DEV_ISSUE_MESSAGE.invalid }])
      const key = githubLinkKey(link)
      const failure = Object.hasOwn(data.githubImportErrorByLink, key)
        ? data.githubImportErrorByLink[key]
        : Object.hasOwn(data.githubImportErrorByRepo, githubRepoKey(link))
          ? data.githubImportErrorByRepo[githubRepoKey(link)]
          : undefined
      if (failure) throw httpError(failure.status, failure.code, failure.message, undefined, failure.details)
      if (!Object.hasOwn(data.githubImportByLink, key)) throw notFound(DEV_ERROR_MESSAGE.githubNotFound)
      return clone(data.githubImportByLink[key])
    }),

    route('GET', API_ROUTE.settings, () => AppSettings.merge(AppSettings.defaultDto(), storage.get(settingsStorageKey, isRecord)).toDto()),

    // A body that is not a complete Settings object is a 422, as on the backend.
    route('PUT', API_ROUTE.settings, ({ body }) => {
      if (!isSettingsDto(body)) throw invalid(DEV_ERROR_MESSAGE.invalidSettings)
      try {
        storage.set(settingsStorageKey, AppSettings.merge(AppSettings.defaultDto(), body).toDto())
      } catch {
        // When storage is unavailable the settings last for this session only, without an error
        // toast on every toggle.
      }
      return undefined
    }),

    route('POST', API_ROUTE.supportRequest, async ({ body }) => {
      if (!isSupportRequestBody(body) || Object.keys(validateSupportRequest(body)).length > 0) throw invalid(DEV_ERROR_MESSAGE.invalidSupportRequest)
      await delay(supportDelayMs)
      // A demo ticket (contract 0.11.0 `{ ticket }`); the form then opens the mail app.
      return { ticket: createTicketNumber() }
    }),

    route('GET', API_ROUTE.account, () => clone(account)),

    // Plan 034: the user name and/or email of the fixture account, in memory only. The same order
    // and `details.issue[]` fields as the backend: the body's format first, then the current
    // password. The fixture has one account, so a value is never taken by another one (no 409).
    route('PUT', API_ROUTE.account, ({ body }) => {
      if (!isAccountUpdateBody(body)) throw invalid(DEV_ERROR_MESSAGE.invalidAccountUpdate)
      const { username, email, currentPassword } = body
      const issueList: FieldIssue[] = []
      if (username === undefined && email === undefined) issueList.push({ field: ACCOUNT_FIELD.username, message: DEV_ISSUE_MESSAGE.invalid })
      if (username !== undefined && usernameError(username)) issueList.push({ field: ACCOUNT_FIELD.username, message: DEV_ISSUE_MESSAGE.invalid })
      if (email !== undefined && emailError(email)) issueList.push({ field: ACCOUNT_FIELD.email, message: DEV_ISSUE_MESSAGE.invalid })
      if (issueList.length > 0) throw invalid(DEV_ERROR_MESSAGE.invalidAccountUpdate, issueList)
      if (!currentPassword || currentPassword !== password) {
        throw invalid(DEV_ERROR_MESSAGE.currentPasswordWrong, [{ field: ACCOUNT_FIELD.currentPassword, message: DEV_ISSUE_MESSAGE.passwordWrong }])
      }
      account = {
        ...account,
        ...(username !== undefined ? { username: username.trim() } : {}),
        ...(email !== undefined ? { email: email.trim().toLowerCase() } : {})
      }
      return clone(account)
    }),

    // The same rules and `details.issue[]` fields as the backend.
    route('PUT', API_ROUTE.accountPassword, ({ body }) => {
      if (!isPasswordChangeBody(body)) throw invalid(DEV_ERROR_MESSAGE.invalidPasswordChange)
      const { currentPassword, newPassword } = body
      if (!currentPassword || currentPassword.length > PASSWORD_LIMIT.max) {
        throw invalid(DEV_ERROR_MESSAGE.invalidPasswordChange, [{ field: PASSWORD_FIELD.current, message: DEV_ISSUE_MESSAGE.invalid }])
      }
      if (newPassword.length < PASSWORD_LIMIT.min || newPassword.length > PASSWORD_LIMIT.max) {
        throw invalid(DEV_ERROR_MESSAGE.invalidPasswordChange, [{ field: PASSWORD_FIELD.new, message: DEV_ISSUE_MESSAGE.invalid }])
      }
      if (currentPassword !== password) {
        throw invalid(DEV_ERROR_MESSAGE.currentPasswordWrong, [{ field: PASSWORD_FIELD.current, message: DEV_ISSUE_MESSAGE.passwordWrong }])
      }
      if (newPassword === currentPassword) {
        throw invalid(DEV_ERROR_MESSAGE.newPasswordSame, [{ field: PASSWORD_FIELD.new, message: DEV_ISSUE_MESSAGE.passwordSame }])
      }
      // The password rules of plan 028 (Open Question 7), as on the backend.
      if (passwordRuleError(newPassword, account)) {
        throw invalid(DEV_ERROR_MESSAGE.newPasswordWeak, [{ field: PASSWORD_FIELD.new, message: DEV_ISSUE_MESSAGE.invalid }])
      }
      password = newPassword
      return undefined
    }),

    // The raw image as the body: PNG, JPEG or WebP by its magic bytes, matching the declared
    // Content-Type, at most 2 MB (413), as on the backend. Kept for the browser session only.
    route('PUT', API_ROUTE.accountAvatar, async ({ body, contentType }) => {
      if (!(body instanceof Blob) || !contentType || !(AVATAR_TYPE_LIST as readonly string[]).includes(contentType)) throw avatarInvalid()
      if (body.size > AVATAR_LIMIT.maxByte) throw httpError(HTTP_STATUS.payloadTooLarge, API_ERROR_CODE.payloadTooLarge, DEV_ERROR_MESSAGE.avatarTooLarge)
      if (body.size === 0) throw avatarInvalid()
      const bytes = await readBytes(body)
      const type = sniffAvatarType(bytes)
      if (!type || type !== contentType) throw avatarInvalid()
      account = { ...account, avatarUrl: toDataUrl(bytes, type) }
      return clone(account)
    }),

    route('DELETE', API_ROUTE.accountAvatar, () => {
      account = { ...account, avatarUrl: null }
      return clone(account)
    })
  ]

  return {
    async request<T>(method: HttpMethod, url: string, body?: unknown, requestOption: RequestOption = {}): Promise<T> {
      // A request cancelled before it starts is reported as cancelled, as the HTTP data source does.
      if (requestOption.signal?.aborted) {
        throw new AppError({ code: ERROR_CODE.abort, kind: 'abort', message: DEV_ERROR_MESSAGE.cancelled, cause: requestOption.signal.reason })
      }
      const path = url.split('?')[0]
      for (const item of routeList) {
        if (item.method !== method) continue
        const match = item.pattern.exec(path)
        if (!match) continue
        const param = Object.fromEntries(item.paramList.map((name, index) => [name, decodeURIComponent(match[index + 1])]))
        // Every id path segment must match the contract pattern, or it is a 422, as on the backend.
        const badId = item.paramList.find((name) => !ID_PATTERN.test(param[name]))
        if (badId) throw invalid(DEV_ERROR_MESSAGE.invalidId, [{ field: badId, message: DEV_ISSUE_MESSAGE.id }])
        // A raw body (a Blob) is passed as it is; JSON bodies are copied, as if sent over the wire.
        const copy = body === undefined || body instanceof Blob ? body : clone(body)
        const result: unknown = await item.handler({ param, body: copy, query: requestOption.query ?? {}, contentType: requestOption.contentType })
        // Typed by the caller, which validates it with a guard, as for an HTTP response.
        return result as T
      }
      throw notFound(DEV_ERROR_MESSAGE.noRoute(method, path))
    }
  }
}

export type FixtureServicesOption = ServicesOption & Omit<FixtureDataSourceOption, 'storage'>

// Every domain service on the fake backend above (one browser storage for both), unless the test
// passes its own `dataSource`. The app's own createServices() talks to the HTTP API instead.
export function createFixtureServices(option: FixtureServicesOption = {}): Services {
  const { supportDelayMs, now, data, ...serviceOption } = option
  const storage = serviceOption.storage ?? createStorageService()
  return createServices({ ...serviceOption, storage, dataSource: serviceOption.dataSource ?? createFixtureDataSource({ storage, supportDelayMs, now, data }) })
}
