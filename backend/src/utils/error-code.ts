// `error.code` values of the standard error shape (.rule/error-handling-rules.md).
export enum ErrorCode {
  BadRequest = 'bad_request',
  Validation = 'validation_error',
  // No valid session (plan 028, contract 0.8.0).
  Unauthorized = 'unauthorized',
  // A state-changing request without the CSRF header, or from a foreign Origin (plan 028).
  Forbidden = 'forbidden',
  NotFound = 'not_found',
  Conflict = 'conflict',
  PayloadTooLarge = 'payload_too_large',
  // GitHub link import (plan 023), sign in, sign up and password change (plan 028).
  RateLimited = 'rate_limited',
  Upstream = 'upstream_error',
  UpstreamTimeout = 'upstream_timeout',
  Internal = 'internal_error'
}

// `type` values set by Express's JSON body parser on the errors it raises.
export enum BodyParserErrorType {
  ParseFailed = 'entity.parse.failed'
}
