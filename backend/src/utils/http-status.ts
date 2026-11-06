// Every HTTP status the API sends (see .orchestrate/api-contract.yaml).
export enum HttpStatus {
  Ok = 200,
  Created = 201,
  Accepted = 202,
  NoContent = 204,
  // The GitHub sign-in redirects (plan 040).
  Found = 302,
  // Sent by Express itself for a fresh conditional GET; it has no body (plan 033 leaves it plain).
  NotModified = 304,
  BadRequest = 400,
  Unauthorized = 401,
  // A refused CSRF header or Origin (plan 028); also GitHub's rate-limit answer.
  Forbidden = 403,
  NotFound = 404,
  Conflict = 409,
  PayloadTooLarge = 413,
  UnprocessableEntity = 422,
  TooManyRequests = 429,
  InternalServerError = 500,
  BadGateway = 502,
  GatewayTimeout = 504
}

// The 3xx range: a GitHub redirect is refused, never followed (plan 023).
export const REDIRECT_MIN = 300
export const REDIRECT_MAX = 399
// The 5xx range of an upstream answer.
export const SERVER_ERROR_MIN = 500

// The 4xx range, used to recognise client errors raised by Express or the body parser.
export const CLIENT_ERROR_MIN = 400
export const CLIENT_ERROR_MAX = 499
