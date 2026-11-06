import { z } from 'zod'
import { AppError, notFoundError, payloadTooLargeError, rateLimitedError, upstreamError, upstreamTimeoutError } from './error.js'
import { GITHUB_API, GITHUB_CONTENT_TYPE, GITHUB_PATTERN, TIMEOUT_ERROR_NAME, TIME } from '../utils/constants.js'
import { ImportLimit, SkipReason } from '../utils/domain.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'
import { HttpStatus, REDIRECT_MAX, REDIRECT_MIN } from '../utils/http-status.js'
import { LIMIT } from '../utils/limits.js'

// The GitHub REST client of the link import (plan 023, scope 2) and of the wizard's repository
// routes (plan 030); `.doc/architecture.md`. One instance serves both, so they share GitHub's
// unauthenticated rate limit.
// SSRF rules, all enforced here:
// - Every request goes to the constant `GITHUB_API.origin`. URLs are built from parsed and
//   checked parts (`github-url.ts`, `github-id.ts`), each one percent-encoded, and the built
//   URL's origin is checked again before the call. No URL from a response (`download_url`,
//   `html_url`, `clone_url`, `avatar_url`, ...) is ever read: the response schemas below do not
//   even keep those fields.
// - No credentials are sent (the optional `authorization` is for GitHub OAuth later and is
//   undefined today), and redirects are not followed: any 3xx is a 502.
// - The `Content-Type` and `Content-Length` are checked before the body is read, and the body
//   is read through a byte counter that stops at the cap.
// - Every call has its own timeout and also stops at the request's overall deadline.
// Fetched code is returned as text only; it is never executed, imported or passed to a shell.

// The subset of `fetch` the client needs, so tests inject a fake and no test uses the network.
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type GithubClientOption = {
  fetch: FetchLike
  callTimeoutMs?: number
  now?: () => number
  // The `Authorization` header value; undefined today (no token, public data only, plan 030).
  authorization?: string
}

// The overall deadline of one import (or one wizard request), shared by all its calls.
export type ImportBudget = { signal: AbortSignal, totalTimeoutMs: number }

export type FetchedFile = { kind: 'text', text: string } | { kind: 'skip', reason: SkipReason }
export type PullInfo = { headSha: string, changedFileCount: number }
export type PullFileEntry = { path: string, status: string, changeCount: number }
// Plan 030. Only these fields are ever kept from GitHub's answers.
export type GithubUser = { login: string, name: string | null }
export type GithubRepoEntry = { name: string, description: string }
export type GithubRepoPage = { repoList: GithubRepoEntry[], hasMore: boolean }
export type GithubTreeEntry = { path: string, type: string, size: number | undefined }
export type GithubTree = { entryList: GithubTreeEntry[], truncated: boolean }

export type GithubClient = {
  // `ref` undefined reads the repository's default branch (plan 030).
  getFile(owner: string, repo: string, path: string[], ref: string | undefined, budget: ImportBudget): Promise<FetchedFile>
  getPull(owner: string, repo: string, number: number, budget: ImportBudget): Promise<PullInfo>
  listPullFile(owner: string, repo: string, number: number, budget: ImportBudget): Promise<PullFileEntry[]>
  // Plan 030: GET /users/{username}. A 404 is `githubUserNotFound`.
  getUser(username: string, budget: ImportBudget): Promise<GithubUser>
  // GET /users/{login}/repos: one page of public repositories owned by the user, newest first.
  listUserRepo(login: string, budget: ImportBudget): Promise<GithubRepoPage>
  // GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1; a repository without a commit is an
  // empty tree.
  getTree(owner: string, repo: string, budget: ImportBudget): Promise<GithubTree>
}

// Response shapes: only the fields the client uses; unknown fields (every URL field) are dropped.
const contentEntrySchema = z.object({
  type: z.string(),
  size: z.number().int().nonnegative(),
  encoding: z.string().optional(),
  content: z.string().optional()
})
const pullSchema = z.object({
  changed_files: z.number().int().nonnegative(),
  head: z.object({ sha: z.string().regex(GITHUB_PATTERN.sha) })
})
const pullFileListSchema = z.array(z.object({
  filename: z.string().min(1),
  status: z.string(),
  changes: z.number().int().nonnegative()
}))
const userSchema = z.object({
  login: z.string(),
  name: z.string().nullable().optional()
})
const repoListSchema = z.array(z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  private: z.boolean().optional()
}))
const treeSchema = z.object({
  tree: z.array(z.object({
    path: z.string(),
    type: z.string(),
    size: z.number().int().nonnegative().optional()
  })),
  truncated: z.boolean().optional()
})
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/
const lineBreakPattern = /\r?\n/g
const controlPattern = /[\u0000-\u001f\u007f]/g

// Thrown by the byte counter; the caller turns it into the right 413 or 502.
class ResponseTooLarge extends Error {}

// Resolves or rejects with `promise`, or rejects as soon as `signal` aborts (a fake or a stalled
// stream may ignore the signal).
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error) }
    )
  })
}

function discard(response: Response): void {
  response.body?.cancel().catch(() => undefined)
}

async function readCapped(response: Response, maxByte: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunkList: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal)
      if (done) break
      total += value.byteLength
      if (total > maxByte) throw new ResponseTooLarge()
      chunkList.push(value)
    }
  } catch (error) {
    reader.cancel().catch(() => undefined)
    throw error
  }
  return Buffer.concat(chunkList)
}

function encodePath(segmentList: string[]): string {
  return segmentList.map(encodeURIComponent).join('/')
}

// Builds `https://api.github.com/repos/...` (or `/users/...`) and checks the origin once more.
function apiUrl(segmentList: string[], query: Record<string, string> = {}, rootPath: string = GITHUB_API.repoPath): URL {
  const url = new URL(`${GITHUB_API.origin}${rootPath}/${encodePath(segmentList)}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  if (url.origin !== GITHUB_API.origin) throw upstreamError(ERROR_MESSAGE.githubUpstream)
  return url
}

function headerInteger(response: Response, name: string): number | undefined {
  const value = response.headers.get(name)?.trim()
  return value && GITHUB_PATTERN.integer.test(value) ? Number(value) : undefined
}

// The 413 a file over the single-file limit gets.
function fileTooLarge(path: string[]): AppError {
  return payloadTooLargeError(ERROR_MESSAGE.githubLimit(ImportLimit.FileChar, LIMIT.github.fileChar),
    { limit: ImportLimit.FileChar, max: LIMIT.github.fileChar, path: path.join('/') })
}

function decodeText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

// Text from GitHub kept for display (plan 030): control characters become spaces, then it must
// be non-blank, well-formed Unicode, cut to `max` units; anything else is undefined.
function displayText(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(controlPattern, ' ').trim()
  if (text.length === 0 || !text.isWellFormed()) return undefined
  const cut = text.slice(0, max)
  // A cut through a surrogate pair drops its first half too.
  return cut.isWellFormed() ? cut : cut.slice(0, -1)
}

function badAnswer(): AppError {
  return upstreamError(ERROR_MESSAGE.githubUpstream)
}

type RequestOption = {
  // The message of a GitHub 404.
  notFoundMessage?: string
  // A status read as "no body" (json undefined) instead of an error.
  emptyOn?: number
}

export function createGithubClient(option: GithubClientOption): GithubClient {
  const fetchFn = option.fetch
  const callTimeoutMs = option.callTimeoutMs ?? LIMIT.github.callTimeoutMs
  const now = option.now ?? Date.now
  const authorization = option.authorization

  function rateLimited(response: Response): AppError {
    const reset = headerInteger(response, GITHUB_API.headerName.rateReset)
    const retryAfter = headerInteger(response, GITHUB_API.headerName.retryAfter)
    // retry-after (the secondary limit) wins over x-ratelimit-reset (the hourly window).
    const resetMs = retryAfter !== undefined ? now() + retryAfter * TIME.msPerSecond : reset !== undefined ? reset * TIME.msPerSecond : undefined
    const resetAt = resetMs !== undefined && Number.isFinite(new Date(resetMs).getTime()) ? new Date(resetMs).toISOString() : undefined
    return rateLimitedError(ERROR_MESSAGE.githubRateLimited, resetAt ? { resetAt } : undefined)
  }

  // Maps a non-200 answer. Nothing from the response text or headers goes into the error,
  // except GitHub's rate-limit reset time.
  function statusError(response: Response, notFoundMessage: string): AppError {
    const status = response.status
    if (response.type === 'opaqueredirect' || (status >= REDIRECT_MIN && status <= REDIRECT_MAX)) return badAnswer()
    if (status === HttpStatus.NotFound) return notFoundError(notFoundMessage)
    // Primary limit: 403 with x-ratelimit-remaining 0. Secondary limit: 403 with retry-after
    // (QA AI-46 D4). Either one, or any 429, is rate_limited.
    const exhausted = response.headers.get(GITHUB_API.headerName.rateRemaining)?.trim() === GITHUB_API.rateExhausted
    const retryAfter = response.headers.has(GITHUB_API.headerName.retryAfter)
    if (status === HttpStatus.TooManyRequests || (status === HttpStatus.Forbidden && (exhausted || retryAfter))) return rateLimited(response)
    return badAnswer()
  }

  // One GET to GitHub, answered with the parsed JSON and the response headers. `tooLarge` is the
  // error for a body over `maxByte` (declared by Content-Length, or counted while reading).
  async function request(url: URL, maxByte: number, budget: ImportBudget, tooLarge: () => AppError,
    requestOption: RequestOption = {}): Promise<{ json: unknown, header: Headers }> {
    if (url.origin !== GITHUB_API.origin) throw badAnswer()
    if (budget.signal.aborted) throw totalTimeout(budget)
    const callSignal = AbortSignal.timeout(callTimeoutMs)
    const signal = AbortSignal.any([budget.signal, callSignal])
    try {
      const response = await raceAbort(fetchFn(url.href, {
        method: 'GET',
        headers: {
          [GITHUB_API.headerName.accept]: GITHUB_API.header.accept,
          [GITHUB_API.headerName.apiVersion]: GITHUB_API.header.apiVersion,
          [GITHUB_API.headerName.userAgent]: GITHUB_API.header.userAgent,
          ...(authorization === undefined ? {} : { [GITHUB_API.headerName.authorization]: authorization })
        },
        redirect: 'manual',
        credentials: 'omit',
        signal
      }), signal)

      if (requestOption.emptyOn !== undefined && response.status === requestOption.emptyOn) {
        discard(response)
        return { json: undefined, header: response.headers }
      }
      if (response.status !== HttpStatus.Ok) {
        discard(response)
        throw statusError(response, requestOption.notFoundMessage ?? ERROR_MESSAGE.githubNotFound)
      }
      const contentType = response.headers.get(GITHUB_API.headerName.contentType)?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== GITHUB_API.jsonType) {
        discard(response)
        throw badAnswer()
      }
      const declared = headerInteger(response, GITHUB_API.headerName.contentLength)
      if (declared !== undefined && declared > maxByte) {
        discard(response)
        throw tooLarge()
      }
      const bytes = await readCapped(response, maxByte, signal)
      try {
        return { json: JSON.parse(bytes.toString('utf8')) as unknown, header: response.headers }
      } catch {
        throw badAnswer()
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (error instanceof ResponseTooLarge) throw tooLarge()
      if (budget.signal.aborted) throw totalTimeout(budget)
      if (callSignal.aborted || (error instanceof Error && error.name === TIMEOUT_ERROR_NAME)) {
        throw upstreamTimeoutError(ERROR_MESSAGE.githubTimeout(ImportLimit.CallTimeout, callTimeoutMs),
          { limit: ImportLimit.CallTimeout, maxMs: callTimeoutMs })
      }
      // A network failure: its message can name hosts or addresses, so it is not passed on.
      throw badAnswer()
    }
  }

  async function getJson(url: URL, maxByte: number, budget: ImportBudget, tooLarge: () => AppError, notFoundMessage?: string): Promise<unknown> {
    return (await request(url, maxByte, budget, tooLarge, { notFoundMessage })).json
  }

  return {
    async getFile(owner, repo, path, ref, budget) {
      const url = apiUrl([owner, repo, GITHUB_API.contentsPath, ...path], ref === undefined ? {} : { [GITHUB_API.refParam]: ref })
      const json = await getJson(url, LIMIT.github.fileResponseByte, budget, () => fileTooLarge(path))
      if (Array.isArray(json)) return { kind: 'skip', reason: SkipReason.Folder }
      const parsed = contentEntrySchema.safeParse(json)
      if (!parsed.success) throw badAnswer()
      const entry = parsed.data

      if (entry.type === GITHUB_CONTENT_TYPE.symlink) return { kind: 'skip', reason: SkipReason.Symlink }
      if (entry.type === GITHUB_CONTENT_TYPE.submodule) return { kind: 'skip', reason: SkipReason.Submodule }
      if (entry.type === GITHUB_CONTENT_TYPE.dir) return { kind: 'skip', reason: SkipReason.Folder }
      if (entry.type !== GITHUB_CONTENT_TYPE.file) throw badAnswer()
      // The declared size first: over `fileByte` bytes is over `fileChar` for certain.
      if (entry.size > LIMIT.github.fileByte) throw fileTooLarge(path)

      const encoded = entry.content?.replace(lineBreakPattern, '')
      if (entry.encoding !== GITHUB_API.base64 || encoded === undefined || !base64Pattern.test(encoded)) throw badAnswer()
      // Then the bytes actually received, whatever `size` said.
      const bytes = Buffer.from(encoded, GITHUB_API.base64)
      if (bytes.byteLength > LIMIT.github.fileByte) throw fileTooLarge(path)
      const text = decodeText(bytes)
      if (text === undefined) return { kind: 'skip', reason: SkipReason.Binary }
      if (text.length > LIMIT.github.fileChar) throw fileTooLarge(path)
      return { kind: 'text', text }
    },

    async getPull(owner, repo, number, budget) {
      const url = apiUrl([owner, repo, GITHUB_API.pullsPath, String(number)])
      const json = await getJson(url, LIMIT.github.pullResponseByte, budget, badAnswer)
      const parsed = pullSchema.safeParse(json)
      if (!parsed.success) throw badAnswer()
      return { headSha: parsed.data.head.sha, changedFileCount: parsed.data.changed_files }
    },

    async listPullFile(owner, repo, number, budget) {
      const url = apiUrl([owner, repo, GITHUB_API.pullsPath, String(number), GITHUB_API.filesPath],
        { [GITHUB_API.perPageParam]: String(GITHUB_API.perPage) })
      // A file list too large to read means changes far over the total limit.
      const json = await getJson(url, LIMIT.github.pullResponseByte, budget, () => payloadTooLargeError(
        ERROR_MESSAGE.githubLimit(ImportLimit.TotalChar, LIMIT.github.totalChar),
        { limit: ImportLimit.TotalChar, max: LIMIT.github.totalChar }))
      const parsed = pullFileListSchema.safeParse(json)
      if (!parsed.success) throw badAnswer()
      return parsed.data.map((item) => ({ path: item.filename, status: item.status, changeCount: item.changes }))
    },

    async getUser(username, budget) {
      const url = apiUrl([username], {}, GITHUB_API.userPath)
      const json = await getJson(url, LIMIT.github.userResponseByte, budget, badAnswer, ERROR_MESSAGE.githubUserNotFound)
      const parsed = userSchema.safeParse(json)
      // The login is trusted only after the same pattern check as the typed name.
      if (!parsed.success || !GITHUB_PATTERN.owner.test(parsed.data.login)) throw badAnswer()
      return { login: parsed.data.login, name: displayText(parsed.data.name, LIMIT.github.displayNameMax) ?? null }
    },

    async listUserRepo(login, budget) {
      const url = apiUrl([login, GITHUB_API.reposPath], {
        [GITHUB_API.typeParam]: GITHUB_API.typeOwner,
        [GITHUB_API.sortParam]: GITHUB_API.sortUpdated,
        [GITHUB_API.directionParam]: GITHUB_API.directionDesc,
        [GITHUB_API.perPageParam]: String(LIMIT.github.repoListMax)
      }, GITHUB_API.userPath)
      const { json, header } = await request(url, LIMIT.github.repoListResponseByte, budget, badAnswer,
        { notFoundMessage: ERROR_MESSAGE.githubUserNotFound })
      const parsed = repoListSchema.safeParse(json)
      if (!parsed.success) throw badAnswer()
      // A name GitHub itself would refuse can never become a repoId; a private one never shows.
      const repoList = parsed.data
        .filter((item) => item.private !== true && GITHUB_PATTERN.repo.test(item.name) && !GITHUB_PATTERN.dotSegment.test(item.name))
        .slice(0, LIMIT.github.repoListMax)
        .map((item) => ({ name: item.name, description: displayText(item.description, LIMIT.github.repoDescriptionMax) ?? '' }))
      const hasMore = GITHUB_PATTERN.linkNext.test(header.get(GITHUB_API.headerName.link) ?? '') || parsed.data.length > LIMIT.github.repoListMax
      return { repoList, hasMore }
    },

    async getTree(owner, repo, budget) {
      const url = apiUrl([owner, repo, GITHUB_API.gitPath, GITHUB_API.treesPath, GITHUB_API.headRef],
        { [GITHUB_API.recursiveParam]: GITHUB_API.recursiveOn })
      const { json } = await request(url, LIMIT.github.treeResponseByte, budget, badAnswer,
        { notFoundMessage: ERROR_MESSAGE.githubRepoNotFound, emptyOn: GITHUB_API.emptyRepoStatus })
      // A repository without any commit (GitHub's 409) has no file.
      if (json === undefined) return { entryList: [], truncated: false }
      const parsed = treeSchema.safeParse(json)
      if (!parsed.success) throw badAnswer()
      return {
        entryList: parsed.data.tree.map((item) => ({ path: item.path, type: item.type, size: item.size })),
        truncated: parsed.data.truncated === true
      }
    }
  }
}

export function totalTimeout(budget: ImportBudget): AppError {
  return upstreamTimeoutError(ERROR_MESSAGE.githubTimeout(ImportLimit.TotalTimeout, budget.totalTimeoutMs),
    { limit: ImportLimit.TotalTimeout, maxMs: budget.totalTimeoutMs })
}
