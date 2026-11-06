import { DATABASE } from '../utils/constants.js'
import { DATABASE_HINT, ERROR_MESSAGE } from '../utils/error-messages.js'

// PostgreSQL errors are never passed on as they are: their message or detail can contain the
// host, the user, the database name or a value from the query (submitted code). Only the error
// code (a SQLSTATE such as 28P01, or a Node code such as ECONNREFUSED) leaves this module.

const codePattern = /^[A-Z0-9_]{2,40}$/

export function errorCodeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return DATABASE.unknownCode
  const { code, errors } = error as { code?: unknown, errors?: unknown }
  if (typeof code === 'string' && codePattern.test(code)) return code
  // Node reports a refused dual-stack connection (::1 and 127.0.0.1) as an AggregateError.
  if (Array.isArray(errors) && errors.length > 0) return errorCodeOf(errors[0])
  return DATABASE.unknownCode
}

// Thrown when the backend cannot start on PostgreSQL. Its message is safe to print.
export class DatabaseStartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = DatabaseStartupError.name
  }
}

export function connectError(variable: string, error: unknown): DatabaseStartupError {
  const code = errorCodeOf(error)
  const hint = DATABASE_HINT[code] ?? DATABASE_HINT.default ?? ''
  return new DatabaseStartupError(ERROR_MESSAGE.databaseConnect(variable, code, hint))
}

// A failed query, with nothing but the operation name and the code.
export class DatabaseError extends Error {
  readonly code: string

  constructor(operation: string, code: string) {
    super(ERROR_MESSAGE.databaseFailed(operation, code))
    this.name = DatabaseError.name
    this.code = code
  }
}

export function databaseError(operation: string, error: unknown): Error {
  if (error instanceof DatabaseError || error instanceof DatabaseStartupError) return error
  return new DatabaseError(operation, errorCodeOf(error))
}
