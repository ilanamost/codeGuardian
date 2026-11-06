import { EMAIL_FORBIDDEN_PATTERN, EMAIL_LIMIT, EMAIL_PATTERN, SIGN_IN_LIMIT, USERNAME_LIMIT, USERNAME_PATTERN } from './account.constants'
import { HTTP_STATUS } from './api.constants'
import { passwordRuleError } from './password-rule'
import type { AppErrorJson } from '../models/app-error'
import { ACCOUNT_FIELD_ERROR_MESSAGE, FORM_ERROR_MESSAGE, REGISTER_FIELD_ERROR_MESSAGE, SESSION_ERROR_MESSAGE } from '../utils/error-messages'

// The client checks of the login and register forms (plan 028), the same limits as the
// contract's SignIn and Registration. Nothing is sent while a field has an error.

export interface SignInFieldError {
  username?: string
  password?: string
}

// Both fields required; the user name trimmed and at most 64 characters, the password at most 200.
export function validateSignIn(username: string, password: string): SignInFieldError {
  const error: SignInFieldError = {}
  const name = username.trim()
  if (!name) error.username = FORM_ERROR_MESSAGE.usernameRequired
  else if (name.length > SIGN_IN_LIMIT.usernameMax) error.username = FORM_ERROR_MESSAGE.usernameTooLong(SIGN_IN_LIMIT.usernameMax)
  if (!password) error.password = FORM_ERROR_MESSAGE.passwordRequired
  else if (password.length > SIGN_IN_LIMIT.passwordMax) error.password = FORM_ERROR_MESSAGE.passwordTooLong(SIGN_IN_LIMIT.passwordMax)
  return error
}

export interface RegistrationInput {
  username: string
  email: string
  password: string
  confirmPassword: string
}

export type RegistrationFieldError = Partial<Record<keyof RegistrationInput, string>>

// The registration rules for a user name (trimmed first): 3 to 32 of [A-Za-z0-9._-].
export function usernameError(value: string): string | undefined {
  const username = value.trim()
  if (!username) return FORM_ERROR_MESSAGE.usernameRequired
  if (username.length < USERNAME_LIMIT.min || username.length > USERNAME_LIMIT.max) {
    return FORM_ERROR_MESSAGE.usernameLength(USERNAME_LIMIT.min, USERNAME_LIMIT.max)
  }
  return USERNAME_PATTERN.test(username) ? undefined : FORM_ERROR_MESSAGE.usernameCharacter
}

// The registration rules for an email (trimmed first): valid, at most 254 characters, and no
// control or line separator character (contract 0.13.0).
export function emailError(value: string): string | undefined {
  const email = value.trim()
  if (!email) return FORM_ERROR_MESSAGE.emailRequired
  if (email.length > EMAIL_LIMIT.max) return FORM_ERROR_MESSAGE.emailTooLong(EMAIL_LIMIT.max)
  if (EMAIL_FORBIDDEN_PATTERN.test(email) || !EMAIL_PATTERN.test(email)) return FORM_ERROR_MESSAGE.emailInvalid
  return undefined
}

// User name and email: the rules above. Password: the password rules. Confirm password:
// required and equal.
export function validateRegistration(input: RegistrationInput): RegistrationFieldError {
  const error: RegistrationFieldError = {}
  const username = input.username.trim()
  const email = input.email.trim()
  const nameIssue = usernameError(username)
  const emailIssue = emailError(email)
  if (nameIssue) error.username = nameIssue
  if (emailIssue) error.email = emailIssue
  if (!input.password) error.password = FORM_ERROR_MESSAGE.passwordRequired
  else {
    const ruleError = passwordRuleError(input.password, { username, email })
    if (ruleError) error.password = ruleError
  }
  if (!input.confirmPassword) error.confirmPassword = FORM_ERROR_MESSAGE.confirmPasswordRequired
  else if (input.password !== input.confirmPassword) error.confirmPassword = FORM_ERROR_MESSAGE.passwordMismatch
  return error
}

export function hasFieldError(error: object): boolean {
  return Object.values(error).some(Boolean)
}

// The sign-in answer shown under the form: one generic text for any 401, the wait time for a
// 429. Other failures (network, server) are error toasts.
export function signInMessageOf(error: AppErrorJson | null): string | undefined {
  if (!error) return undefined
  if (error.status === HTTP_STATUS.unauthorized) return SESSION_ERROR_MESSAGE.signInFailed
  if (error.status === HTTP_STATUS.rateLimited) return SESSION_ERROR_MESSAGE.rateLimited(error.retryAfterSecond)
  if (error.status === HTTP_STATUS.unprocessable) return SESSION_ERROR_MESSAGE.invalid
  return undefined
}

// The registration answer shown under the form: the generic conflict text (it never says which
// field is taken), the wait time for a 429, or a 422 without a known field.
export function registerMessageOf(error: AppErrorJson | null): string | undefined {
  if (!error) return undefined
  if (error.status === HTTP_STATUS.conflict) return SESSION_ERROR_MESSAGE.registerConflict
  if (error.status === HTTP_STATUS.rateLimited) return SESSION_ERROR_MESSAGE.rateLimited(error.retryAfterSecond)
  if (error.status === HTTP_STATUS.unprocessable && !registerFieldErrorOf(error).hasField) return SESSION_ERROR_MESSAGE.invalid
  return undefined
}

// The fields a 422 of the registration names (`details.issue[]`), as the form's own texts.
export function registerFieldErrorOf(error: AppErrorJson | null): { field: RegistrationFieldError; hasField: boolean } {
  const field: RegistrationFieldError = {}
  if (error?.status !== HTTP_STATUS.unprocessable) return { field, hasField: false }
  for (const issue of error.issueList ?? []) {
    if (Object.hasOwn(REGISTER_FIELD_ERROR_MESSAGE, issue.field)) field[issue.field as keyof RegistrationFieldError] = REGISTER_FIELD_ERROR_MESSAGE[issue.field]
  }
  return { field, hasField: hasFieldError(field) }
}

// Plan 034: the Account edit form (PUT /api/account). The same user name and email rules as the
// registration; the current password is required (the server checks it).
export interface AccountUpdateInput {
  username: string
  email: string
  currentPassword: string
}

export type AccountUpdateFieldError = Partial<Record<keyof AccountUpdateInput, string>>

export function validateAccountUpdate(input: AccountUpdateInput): AccountUpdateFieldError {
  const error: AccountUpdateFieldError = {}
  const username = usernameError(input.username)
  const email = emailError(input.email)
  if (username) error.username = username
  if (email) error.email = email
  if (!input.currentPassword) error.currentPassword = FORM_ERROR_MESSAGE.currentPasswordRequired
  return error
}

// The fields a 422 of PUT /api/account names, as the form's own texts (a wrong current password
// is one of them).
export function accountUpdateFieldErrorOf(error: AppErrorJson | null): { field: AccountUpdateFieldError; hasField: boolean } {
  const field: AccountUpdateFieldError = {}
  if (error?.status !== HTTP_STATUS.unprocessable) return { field, hasField: false }
  for (const issue of error.issueList ?? []) {
    if (Object.hasOwn(ACCOUNT_FIELD_ERROR_MESSAGE, issue.field)) field[issue.field as keyof AccountUpdateFieldError] = ACCOUNT_FIELD_ERROR_MESSAGE[issue.field]
  }
  return { field, hasField: hasFieldError(field) }
}

// The answer shown under the Account edit form: the generic conflict text (it never says which
// field is taken), the wait time for a 429, or a 422 without a known field. Other failures
// (network, server) are error toasts.
export function accountUpdateMessageOf(error: AppErrorJson | null): string | undefined {
  if (!error) return undefined
  if (error.status === HTTP_STATUS.conflict) return SESSION_ERROR_MESSAGE.registerConflict
  if (error.status === HTTP_STATUS.rateLimited) return SESSION_ERROR_MESSAGE.rateLimited(error.retryAfterSecond)
  if (error.status === HTTP_STATUS.unprocessable && !accountUpdateFieldErrorOf(error).hasField) return SESSION_ERROR_MESSAGE.invalid
  return undefined
}
