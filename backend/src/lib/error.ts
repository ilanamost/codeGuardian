import type { NextFunction, Request, Response } from 'express'
import { HEADER, LogLevel, UNKNOWN_REQUEST_ID } from '../utils/constants.js'
import { BodyParserErrorType, ErrorCode } from '../utils/error-code.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'
import { CLIENT_ERROR_MAX, CLIENT_ERROR_MIN, HttpStatus } from '../utils/http-status.js'

// Stable error shape per `.rule/error-handling-rules.md`:
//   { error: { code, message, details? }, requestId }
// Internal details stay in the log, never in the response.

export type ErrorBody = {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
  requestId: string
}

export class AppError extends Error {
  readonly status: HttpStatus
  readonly code: ErrorCode
  readonly details?: unknown
  // Response headers that belong to the error (for example `Retry-After` on a 429).
  readonly header?: Record<string, string>

  constructor(status: HttpStatus, code: ErrorCode, message: string, details?: unknown, header?: Record<string, string>) {
    super(message)
    this.name = AppError.name
    this.status = status
    this.code = code
    this.details = details
    this.header = header
  }
}

// Malformed input the server cannot even parse (for example broken JSON).
export function badRequestError(message: string): AppError {
  return new AppError(HttpStatus.BadRequest, ErrorCode.BadRequest, message)
}

// Well-formed input that fails its schema or a business rule on a field.
export function validationError(message: string, details?: unknown): AppError {
  return new AppError(HttpStatus.UnprocessableEntity, ErrorCode.Validation, message, details)
}

// No valid session (plan 028): no cookie, or an unknown, tampered, deleted or expired id.
export function unauthorizedError(message: string): AppError {
  return new AppError(HttpStatus.Unauthorized, ErrorCode.Unauthorized, message)
}

// A state-changing request without the CSRF header, or with a foreign Origin (plan 028).
export function forbiddenError(message: string): AppError {
  return new AppError(HttpStatus.Forbidden, ErrorCode.Forbidden, message)
}

export function notFoundError(message: string): AppError {
  return new AppError(HttpStatus.NotFound, ErrorCode.NotFound, message)
}

export function conflictError(message: string): AppError {
  return new AppError(HttpStatus.Conflict, ErrorCode.Conflict, message)
}

export function payloadTooLargeError(message: string, details?: unknown): AppError {
  return new AppError(HttpStatus.PayloadTooLarge, ErrorCode.PayloadTooLarge, message, details)
}

// GitHub link import (plan 023): GitHub's unauthenticated limit is used up.
export function rateLimitedError(message: string, details?: unknown): AppError {
  return new AppError(HttpStatus.TooManyRequests, ErrorCode.RateLimited, message, details)
}

// Sign in, sign up or password change over a limit (plan 028): `Retry-After` in seconds, and
// the same number in `details.retryAfterSecond`.
export function tooManyAttemptError(retryAfterSecond: number): AppError {
  return new AppError(HttpStatus.TooManyRequests, ErrorCode.RateLimited, ERROR_MESSAGE.tooManyAttempt(retryAfterSecond),
    { retryAfterSecond }, { [HEADER.retryAfter]: String(retryAfterSecond) })
}

// The account's analysis quota is spent (plan 039): `details.resetAt` is when a new analysis is
// accepted, and `Retry-After` says the same in seconds.
export function analysisQuotaError(resetAt: string, retryAfterSecond: number): AppError {
  return new AppError(HttpStatus.TooManyRequests, ErrorCode.RateLimited, ERROR_MESSAGE.analysisQuota,
    { resetAt }, { [HEADER.retryAfter]: String(retryAfterSecond) })
}

// GitHub failed, redirected, or answered something unexpected.
export function upstreamError(message: string): AppError {
  return new AppError(HttpStatus.BadGateway, ErrorCode.Upstream, message)
}

export function upstreamTimeoutError(message: string, details?: unknown): AppError {
  return new AppError(HttpStatus.GatewayTimeout, ErrorCode.UpstreamTimeout, message, details)
}

export function toErrorBody(error: AppError, requestId: string): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    },
    requestId
  }
}

// Correlation id for support/debugging. Attached by `attachRequestId` and echoed
// in every error response.
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string
  }
}

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = crypto.randomUUID()
  res.setHeader(HEADER.requestId, req.requestId)
  next()
}

// Client errors raised by Express itself or by the JSON body parser: they carry a 4xx `status`
// or `statusCode` (for example a malformed percent-escape in a path parameter is a URIError
// with status 400). They are mapped to the contract's codes: 413 for a body over the limit,
// 400 bad_request for everything else, so no undeclared status (such as 415) leaks out.
// Their `body` field may hold the raw request text, including a password, so nothing from
// them is logged or returned.
function clientStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { status, statusCode } = error as { status?: unknown, statusCode?: unknown }
  const value = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : undefined
  if (value !== undefined && value >= CLIENT_ERROR_MIN && value <= CLIENT_ERROR_MAX) return value
  return error instanceof URIError ? HttpStatus.BadRequest : undefined
}

function fromClientError(error: unknown, status: number): AppError {
  if (status === HttpStatus.PayloadTooLarge) return payloadTooLargeError(ERROR_MESSAGE.bodyTooLarge)
  if ((error as { type?: unknown }).type === BodyParserErrorType.ParseFailed) return badRequestError(ERROR_MESSAGE.bodyNotJson)
  if (error instanceof URIError) return badRequestError(ERROR_MESSAGE.urlNotEncoded)
  return badRequestError(ERROR_MESSAGE.requestUnreadable)
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? UNKNOWN_REQUEST_ID

  if (error instanceof AppError) {
    // Upstream failures (502, 504) are logged with the code only: their messages are constant
    // texts, and nothing GitHub sent (body, headers) is ever part of them.
    if (error.status >= HttpStatus.InternalServerError) {
      console.warn(JSON.stringify({ level: LogLevel.Warn, operation: `${req.method} ${req.path}`, requestId, code: error.code }))
    }
    if (error.header) res.set(error.header)
    res.status(error.status).json(toErrorBody(error, requestId))
    return
  }

  const clientStatus = clientStatusOf(error)
  if (clientStatus !== undefined) {
    const appError = fromClientError(error, clientStatus)
    res.status(appError.status).json(toErrorBody(appError, requestId))
    return
  }

  // Unexpected: log with context, return a safe generic message.
  console.error(JSON.stringify({
    level: LogLevel.Error,
    operation: `${req.method} ${req.path}`,
    requestId,
    message: error instanceof Error ? error.message : String(error)
  }))

  res.status(HttpStatus.InternalServerError).json(toErrorBody(
    new AppError(HttpStatus.InternalServerError, ErrorCode.Internal, ERROR_MESSAGE.internal),
    requestId
  ))
}
