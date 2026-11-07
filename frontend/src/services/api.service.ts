import { API_PATH, CSRF_HEADER, HTTP_STATUS, SESSION_MODE_HEADER, SESSION_TOKEN_PATTERN, SESSION_TOKEN_STORAGE_KEY } from '../lib/api.constants'
import { sniffAvatarType } from '../lib/avatarFile'
import { API_URL } from '../lib/config'
import { requestTracker, type RequestTracker } from '../lib/requestTracker'
import { AppError } from '../models/app-error'
import { ERROR_CODE } from '../utils/error-messages'
import type { DataSource, HttpMethod, Query, RequestOption } from './data-source'
import { createStorageService, type StorageService } from './storage.service'

// The HTTP data source and the only module that calls fetch: one fetch per request, JSON in and
// out, failures mapped to AppError. No timeout and no retry (plan 017, Open Question 3).
// Plan 026: identical GETs (same full URL) sent while the first is still pending share one fetch;
// each caller parses the shared body itself. Nothing is cached once the fetch settles. A
// non-GET passes the caller's signal straight to fetch; a shared GET has its own controller,
// a caller's abort rejects only that caller, and the fetch is cancelled once every caller with a
// signal has aborted (one macrotask later, so a React StrictMode remount can still join it).
// Plan 028: every request sends the session cookie (`credentials: 'include'`; the cookie is
// HttpOnly, so no code reads it), and every state-changing one carries X-CSRF-Protection: 1.
// A Blob body (the profile photo) is sent raw with its Content-Type, not as JSON.
// Plan 037: every request is counted on the request tracker (lib/requestTracker.ts) from before
// it is sent until it settles, released in `finally`; a shared GET is counted once per fetch,
// not once per caller, and abortAll releases whatever this source still counts. A `background`
// request is not counted.
// Plan 047 (contract 0.18.0): sign-in and register send X-Session-Mode: token. When the answer
// has a `sessionToken`, GET /api/session is sent with the cookie only: 200 means the cookie works
// (the token is dropped, nothing is stored); 401 means the browser blocked it (token mode: the
// token is kept in storage and sent as `Authorization: Bearer` on every request). The token is
// cleared on sign-out and on any 401, is never put in a URL, and is never logged or shown.
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface ApiServiceOption {
  baseUrl?: string
  fetchFn?: FetchFn
  // Plan 037: where requests in flight are counted for the global loader (the app's tracker by
  // default; tests pass their own).
  tracker?: RequestTracker
  // Plan 047: where the session token is kept in token mode (the browser storage by default).
  storage?: StorageService
}

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  if (!query) return url
  const param = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) param.set(key, String(value))
  }
  const text = param.toString()
  return text ? `${url}?${text}` : url
}

// The reason every shared GET is cancelled with by abortAll: the caller sees a cancelled request
// (kind `abort`, never reported), not a network failure.
const abortAllReason = new Error('cancelled: the session ended')

function abortError(cause: unknown): AppError {
  return new AppError({ code: ERROR_CODE.abort, kind: 'abort', message: 'cancelled by caller', cause })
}

function parseError(status: number | undefined, message: string, cause?: unknown): AppError {
  return new AppError({ code: ERROR_CODE.parse, kind: 'parse', status, message, cause })
}

const jsonType = 'application/json'
const lenientDecoder = new TextDecoder()

// What one fetch produced, before any caller parses it.
interface RawResponse {
  ok: boolean
  status: number
  requestId?: string
  text: string
  // A `blob` response sent plain: its bytes and Content-Type.
  byte?: Uint8Array<ArrayBuffer>
  contentType?: string
}

interface SharedGet {
  promise: Promise<RawResponse>
  controller: AbortController
  callerCount: number
  // Settles with the fetch; true once a counted (not background) caller joined.
  settled: Promise<unknown>
  counted: boolean
}

// One request as it goes on the wire.
interface Call {
  method: HttpMethod
  fullUrl: string
  body: unknown
  contentType?: string
  binary: boolean
  // Not counted for the global loader (plan 037).
  background: boolean
  // Plan 047: asks the backend for a `sessionToken` (sign-in and register).
  askToken?: boolean
  // Plan 047: sent without the bearer token, so only the cookie can authorise it.
  cookieOnly?: boolean
}

function pathOf(url: string): string {
  return `/${url.split('?')[0].replace(/^\/+/, '')}`
}

function sessionTokenOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const token = (value as { sessionToken?: unknown }).sessionToken
  return typeof token === 'string' && SESSION_TOKEN_PATTERN.test(token) ? token : undefined
}

export function createApiService(option: ApiServiceOption = {}): DataSource {
  const baseUrl = option.baseUrl ?? API_URL
  const fetchFn: FetchFn = option.fetchFn ?? ((input, init) => globalThis.fetch(input, init))
  const tracker = option.tracker ?? requestTracker

  const storage = option.storage ?? createStorageService()
  const isToken = (value: unknown): value is string => typeof value === 'string' && SESSION_TOKEN_PATTERN.test(value)
  // Token mode only: the session token, restored from storage on load.
  let sessionToken: string | undefined = storage.get(SESSION_TOKEN_STORAGE_KEY, isToken)

  function forgetToken() {
    sessionToken = undefined
    try {
      storage.remove(SESSION_TOKEN_STORAGE_KEY)
    } catch {
      // Nothing is stored when storage is unavailable.
    }
  }

  function keepToken(token: string) {
    sessionToken = token
    try {
      storage.set(SESSION_TOKEN_STORAGE_KEY, token)
    } catch {
      // The token then lasts until the page is reloaded.
    }
  }

  const inFlight = new Map<string, SharedGet>()

  // What this source counts on the tracker now, so abortAll can release it (plan 037).
  const heldSet = new Set<() => void>()

  function hold(background: boolean): () => void {
    const release = tracker.begin({ background })
    const once = () => {
      if (!heldSet.delete(once)) return
      release()
    }
    heldSet.add(once)
    return once
  }

  function headersOf(method: HttpMethod, body: unknown, contentType?: string, call?: Call): Record<string, string> {
    const headers: Record<string, string> = { Accept: jsonType }
    if (body instanceof Blob) headers['Content-Type'] = contentType ?? body.type
    else if (body !== undefined) headers['Content-Type'] = jsonType
    if (method !== 'GET') headers[CSRF_HEADER.name] = CSRF_HEADER.value
    if (call?.askToken) headers[SESSION_MODE_HEADER.name] = SESSION_MODE_HEADER.value
    if (sessionToken && !call?.cookieOnly) headers.Authorization = `Bearer ${sessionToken}`
    return headers
  }

  function plainBodyOf(body: unknown): BodyInit | undefined {
    if (body === undefined) return undefined
    return body instanceof Blob ? body : JSON.stringify(body)
  }

  async function send(call: Call, signal?: AbortSignal): Promise<RawResponse> {
    const { method, body } = call
    const headers = headersOf(method, body, call.contentType, call)
    const payload = plainBodyOf(body)
    const response = await fetchFn(call.fullUrl, { method, headers, body: payload, credentials: 'include', signal })
    const requestId = response.headers.get('x-request-id') ?? undefined
    if (call.binary) {
      const byte = new Uint8Array(await response.arrayBuffer())
      return { ok: response.ok, status: response.status, requestId, text: response.ok ? '' : lenientDecoder.decode(byte), byte, contentType: response.headers.get('content-type') ?? undefined }
    }
    const text = await response.text()
    return { ok: response.ok, status: response.status, requestId, text }
  }

  function leave(key: string, shared: SharedGet) {
    shared.callerCount -= 1
    if (shared.callerCount > 0) return
    setTimeout(() => {
      if (shared.callerCount > 0) return
      if (inFlight.get(key) === shared) inFlight.delete(key)
      shared.controller.abort()
    }, 0)
  }

  // Shared by callers of the same URL and the same response type.
  function sharedGet(call: Call, signal?: AbortSignal): Promise<RawResponse> {
    // An already-cancelled caller is not shared: fetch rejects it with its own signal, as before.
    if (signal?.aborted) return send(call, signal)
    const key = `${call.binary ? 'blob' : 'json'} ${call.fullUrl}`
    let shared = inFlight.get(key)
    if (!shared) {
      const controller = new AbortController()
      // Whatever fetch rejects with once abortAll cancelled it, the callers see abortAllReason.
      const raw = send(call, controller.signal)
      const promise = raw.catch((error: unknown) => {
        throw controller.signal.reason === abortAllReason ? abortAllReason : error
      })
      const settled = raw.then(
        () => undefined,
        () => undefined
      )
      const created: SharedGet = { promise, controller, callerCount: 0, settled, counted: false }
      const forget = () => {
        if (inFlight.get(key) === created) inFlight.delete(key)
      }
      // On the raw fetch, so the entry is forgotten as soon as the fetch settles.
      raw.then(forget, forget)
      inFlight.set(key, created)
      shared = created
    }
    // Counted once per fetch: by its first counted caller, until the fetch settles (plan 037).
    if (!call.background && !shared.counted) {
      shared.counted = true
      void shared.settled.then(hold(false))
    }
    shared.callerCount += 1
    if (!signal) return shared.promise
    const joined = shared
    return new Promise<RawResponse>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason)
        leave(key, joined)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      joined.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  function blobOf(byte: Uint8Array<ArrayBuffer>, contentType?: string): Blob {
    return new Blob([byte], { type: sniffAvatarType(byte) ?? contentType ?? '' })
  }

  function readResponse<T>(response: RawResponse, binary: boolean): T {
    if (binary && response.ok && response.byte) return blobOf(response.byte, response.contentType) as T
    const { text } = response
    let parsed: unknown
    let failure: Error | undefined
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
    if (!response.ok) {
      throw AppError.fromResponse(response.status, parsed, response.requestId)
    }
    if (response.status === 204) return undefined as T
    if (failure) throw parseError(response.status, 'malformed JSON body', failure)
    return parsed as T
  }

  async function exchange<T>(call: Call, signal?: AbortSignal): Promise<T> {
    let response: RawResponse
    try {
      response = call.method === 'GET' && call.body === undefined ? await sharedGet(call, signal) : await send(call, signal)
    } catch (error) {
      if (signal?.aborted || error === abortAllReason) throw abortError(error)
      throw new AppError({ code: ERROR_CODE.network, kind: 'network', message: 'network error', cause: error })
    }
    // Any 401 ends the token's use: the next sign-in starts clean.
    if (response.status === HTTP_STATUS.unauthorized) forgetToken()
    return readResponse<T>(response, call.binary)
  }

  // After a sign-in or register answer: decides between cookie mode and token mode.
  async function settleToken(result: unknown) {
    const token = sessionTokenOf(result)
    if (result && typeof result === 'object') delete (result as { sessionToken?: unknown }).sessionToken
    if (!token) return forgetToken()
    try {
      const check = await send({ method: 'GET', fullUrl: buildUrl(baseUrl!, API_PATH.session), body: undefined, binary: false, background: true, cookieOnly: true })
      if (check.status === HTTP_STATUS.unauthorized) keepToken(token)
      else forgetToken()
    } catch {
      forgetToken()
    }
  }

  return {
    abortAll() {
      const list = [...inFlight.values()]
      inFlight.clear()
      for (const shared of list) shared.controller.abort(abortAllReason)
      // The safety reset of plan 037: nothing this source counted keeps the global loader on.
      for (const release of [...heldSet]) release()
    },
    async request<T>(method: HttpMethod, url: string, body?: unknown, requestOption: RequestOption = {}): Promise<T> {
      const { signal } = requestOption
      // VITE_API_URL is read with no fallback (lib/config.ts): an unset one is a setup error, not a TypeError.
      if (typeof baseUrl !== 'string') throw new AppError({ code: ERROR_CODE.network, kind: 'network', message: 'The API URL is not configured (set VITE_API_URL)' })
      const fullUrl = buildUrl(baseUrl, url, requestOption.query)
      const binary = requestOption.responseType === 'blob'
      const background = requestOption.background === true
      // A shared GET is counted by its fetch (sharedGet), once for all its callers. Any other
      // request counts until it settles.
      const sharedRead = method === 'GET' && body === undefined
      const release = sharedRead ? undefined : hold(background)
      try {
        const path = pathOf(url)
        const askToken = method === 'POST' && (path === API_PATH.session || path === API_PATH.account)
        const result = await exchange<T>({ method, fullUrl, body, contentType: requestOption.contentType, binary, background, askToken, cookieOnly: askToken }, signal)
        if (askToken) await settleToken(result)
        else if (method === 'DELETE' && path === API_PATH.session) forgetToken()
        return result
      } finally {
        release?.()
      }
    }
  }
}
