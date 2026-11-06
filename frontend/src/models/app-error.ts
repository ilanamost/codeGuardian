import { buildUserMessage, ERROR_CODE, isErrorCode, type ErrorCode } from '../utils/error-messages'
import { hasFields, isArrayOf, isRecord, isString } from './guard'

// What failed underneath, independent of the action: drives retries and the recovery hint.
export type AppErrorKind = 'network' | 'timeout' | 'abort' | 'http' | 'parse' | 'validation' | 'storage' | 'unknown'

const kindList: AppErrorKind[] = ['network', 'timeout', 'abort', 'http', 'parse', 'validation', 'storage', 'unknown']

// One invalid field of a 422, from the standard error body's `details.issue[]`. The message is
// the server's (developer text); the UI shows its own constant for the field instead.
export interface FieldIssue {
  field: string
  message: string
}

const isFieldIssue = (value: unknown): value is FieldIssue => hasFields(value, { field: isString, message: isString })

// `details.issue[]` of an error body, or an empty list when there is none (or it is malformed).
export function issueListOf(details: unknown): FieldIssue[] {
  if (!isRecord(details) || !isArrayOf(isFieldIssue)(details.issue)) return []
  return details.issue.map((item) => ({ field: item.field, message: item.message }))
}

// Plain, serializable form kept in Redux state and thunk rejections.
export interface AppErrorJson {
  name: 'AppError'
  code: ErrorCode
  kind: AppErrorKind
  // The code of the underlying cause when `code` names an action (e.g. storage under review_save).
  causeCode?: ErrorCode
  status?: number
  requestId?: string
  message: string
  userMessage: string
  // Invalid fields named by the server (422 `details.issue[]`); omitted when there are none.
  issueList?: FieldIssue[]
  // The limit a 413 names in `details.limit` (GitHub link import: fileChar, totalChar, fileCount).
  limit?: string
  // How long to wait after a 429, from `details.retryAfterSecond` (contract 0.8.0).
  retryAfterSecond?: number
  // When the account's analysis quota frees up again, from a 429's `details.resetAt` (contract 0.14.0).
  resetAt?: string
}

export interface AppErrorInit {
  code: ErrorCode
  kind: AppErrorKind
  message?: string
  status?: number
  requestId?: string
  causeCode?: ErrorCode
  userMessage?: string
  issueList?: FieldIssue[]
  limit?: string
  retryAfterSecond?: number
  resetAt?: string
  cause?: unknown
}

const statusCode: Record<number, ErrorCode> = {
  400: ERROR_CODE.validation,
  401: ERROR_CODE.unauthorized,
  403: ERROR_CODE.forbidden,
  404: ERROR_CODE.notFound,
  408: ERROR_CODE.timeout,
  409: ERROR_CODE.conflict,
  413: ERROR_CODE.payloadTooLarge,
  422: ERROR_CODE.validation,
  429: ERROR_CODE.rateLimited
}

export function codeForStatus(status: number): ErrorCode {
  return statusCode[status] ?? (status >= 500 ? ERROR_CODE.server : ERROR_CODE.unknown)
}

// Server `error.code` values that say more than their status (contract 0.7.0, GitHub import only).
const codeByServerCode: Record<string, ErrorCode> = {
  upstream_error: ERROR_CODE.upstreamError,
  upstream_timeout: ERROR_CODE.upstreamTimeout
}

function codeForResponse(status: number, serverCode: unknown): ErrorCode {
  if (isString(serverCode) && Object.hasOwn(codeByServerCode, serverCode)) return codeByServerCode[serverCode]
  return codeForStatus(status)
}

// `details.limit` of a 413 (a string), or undefined.
export function limitOf(details: unknown): string | undefined {
  return isRecord(details) && isString(details.limit) ? details.limit : undefined
}

// `details.retryAfterSecond` of a 429 (a positive whole number), or undefined.
export function retryAfterOf(details: unknown): number | undefined {
  if (!isRecord(details)) return undefined
  const value = details.retryAfterSecond
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

// `details.resetAt` of a 429 (an ISO date-time string that parses), or undefined.
export function resetAtOf(details: unknown): string | undefined {
  if (!isRecord(details) || !isString(details.resetAt)) return undefined
  return Number.isNaN(new Date(details.resetAt).getTime()) ? undefined : details.resetAt
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly kind: AppErrorKind
  readonly status?: number
  readonly requestId?: string
  readonly causeCode?: ErrorCode
  readonly userMessage: string
  readonly issueList: FieldIssue[]
  readonly limit?: string
  readonly retryAfterSecond?: number
  readonly resetAt?: string

  constructor({ code, kind, message, status, requestId, causeCode, userMessage, issueList, limit, retryAfterSecond, resetAt, cause }: AppErrorInit) {
    super(message ?? code, cause === undefined ? undefined : { cause })
    this.name = 'AppError'
    this.code = code
    this.kind = kind
    this.status = status
    this.requestId = requestId
    this.causeCode = causeCode
    this.limit = limit
    this.retryAfterSecond = retryAfterSecond
    this.resetAt = resetAt
    // Never built from a raw server message or stack: always one of the constants.
    this.userMessage = userMessage ?? buildUserMessage(code, causeCode, limit, retryAfterSecond, resetAt)
    this.issueList = issueList ?? []
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError
  }

  // Wraps anything thrown into an AppError. An AppError passes through unchanged.
  static from(error: unknown, code: ErrorCode = ERROR_CODE.unknown): AppError {
    if (error instanceof AppError) return error
    if (isAppErrorJson(error)) return AppError.fromJson(error)
    const message = error instanceof Error ? error.message : String(error)
    return new AppError({ code, kind: 'unknown', message, cause: error })
  }

  // Maps a non-2xx response (its status and parsed body, standard error shape
  // { error: { code, message }, requestId }) to an AppError. The server message is kept as the
  // internal message only; the user sees one of the constants in utils/error-messages.ts.
  static fromResponse(status: number, body: unknown, headerRequestId?: string): AppError {
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
    const requestId = isRecord(body) && isString(body.requestId) ? body.requestId : headerRequestId
    return new AppError({
      code: codeForResponse(status, error?.code),
      kind: status === 408 ? 'timeout' : status === 400 || status === 422 ? 'validation' : 'http',
      status,
      requestId,
      message: error && isString(error.message) ? error.message : `HTTP ${status}`,
      issueList: issueListOf(error?.details),
      limit: limitOf(error?.details),
      retryAfterSecond: retryAfterOf(error?.details),
      resetAt: resetAtOf(error?.details)
    })
  }

  static fromJson(json: AppErrorJson): AppError {
    return new AppError({
      code: json.code,
      kind: json.kind,
      message: json.message,
      status: json.status,
      requestId: json.requestId,
      causeCode: json.causeCode,
      userMessage: json.userMessage,
      issueList: json.issueList,
      limit: json.limit,
      retryAfterSecond: json.retryAfterSecond,
      resetAt: json.resetAt
    })
  }

  // Puts an action in front of the cause: storage failure -> review_save (storage).
  // Cancelled requests stay `abort` so they are never reported.
  forAction(code: ErrorCode): AppError {
    if (this.kind === 'abort' || this.code === code) return this
    return new AppError({
      code,
      kind: this.kind,
      message: this.message,
      status: this.status,
      requestId: this.requestId,
      causeCode: this.causeCode ?? this.code,
      issueList: this.issueList,
      limit: this.limit,
      retryAfterSecond: this.retryAfterSecond,
      resetAt: this.resetAt,
      cause: this
    })
  }

  toJSON(): AppErrorJson {
    const json: AppErrorJson = {
      name: 'AppError',
      code: this.code,
      kind: this.kind,
      message: this.message,
      userMessage: this.userMessage
    }
    if (this.causeCode !== undefined) json.causeCode = this.causeCode
    if (this.status !== undefined) json.status = this.status
    if (this.requestId !== undefined) json.requestId = this.requestId
    if (this.issueList.length > 0) json.issueList = this.issueList.map((item) => ({ ...item }))
    if (this.limit !== undefined) json.limit = this.limit
    if (this.retryAfterSecond !== undefined) json.retryAfterSecond = this.retryAfterSecond
    if (this.resetAt !== undefined) json.resetAt = this.resetAt
    return json
  }
}

export function isAppErrorJson(value: unknown): value is AppErrorJson {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    item.name === 'AppError' &&
    isErrorCode(item.code) &&
    kindList.includes(item.kind as AppErrorKind) &&
    typeof item.userMessage === 'string'
  )
}
