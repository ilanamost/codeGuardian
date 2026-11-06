import { FORM_ERROR_MESSAGE } from '../utils/error-messages'
import { PASSWORD_LIMIT } from './account.constants'
import { COMMON_PASSWORD_LIST } from './common-password'

// The password rules of a NEW password (plan 028, Open Question 7), on registration and on a
// password change; the same as backend/src/lib/password-rule.ts. The server is the authority:
// this copy lets the forms refuse a password (and show the live checklist) before sending it.
// Sign-in never checks them, so an older password such as the demo one still signs in.

const commonSet = new Set(COMMON_PASSWORD_LIST)
const letterPattern = /\p{L}/u
const digitPattern = /[0-9]/

export interface PasswordOwner {
  username: string
  email: string
}

export type PasswordRuleId = 'length' | 'letterDigit' | 'personal' | 'common'

// Every rule with whether the password passes it, in the order the server checks them.
export function passwordRuleCheck(password: string, owner: PasswordOwner): Record<PasswordRuleId, boolean> {
  const lower = password.toLowerCase()
  const username = owner.username.trim().toLowerCase()
  const email = owner.email.trim().toLowerCase()
  return {
    length: password.length >= PASSWORD_LIMIT.min && password.length <= PASSWORD_LIMIT.max,
    letterDigit: letterPattern.test(password) && digitPattern.test(password),
    personal: password.length > 0 && lower !== username && lower !== email,
    common: password.length > 0 && !commonSet.has(lower)
  }
}

const messageByRule: Record<PasswordRuleId, string> = {
  length: FORM_ERROR_MESSAGE.passwordLength(PASSWORD_LIMIT.min, PASSWORD_LIMIT.max),
  letterDigit: FORM_ERROR_MESSAGE.passwordLetterDigit,
  personal: FORM_ERROR_MESSAGE.passwordPersonal,
  common: FORM_ERROR_MESSAGE.passwordCommon
}

// The message of the first rule the password breaks, or undefined when it passes them all.
export function passwordRuleError(password: string, owner: PasswordOwner): string | undefined {
  const check = passwordRuleCheck(password, owner)
  const broken = (Object.keys(check) as PasswordRuleId[]).find((rule) => !check[rule])
  return broken ? messageByRule[broken] : undefined
}
