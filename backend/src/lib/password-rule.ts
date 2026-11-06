import { PATTERN } from '../utils/constants.js'
import { COMMON_PASSWORD_LIST } from '../utils/common-password.js'
import { ISSUE_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

// The password rules for a new password (plan 028, Open Question 7), on registration and on a
// password change. The frontend checks the same rules first (its register form shows them as a
// live checklist); the server is the authority. Sign-in never checks them, so an older password
// such as the demo one still signs in.

const commonSet = new Set(COMMON_PASSWORD_LIST)

export type PasswordOwner = { username: string, email: string }

// The first rule the password breaks, as a `details.issue[].message`, or undefined. The
// password itself is never part of the message.
export function passwordRuleIssue(password: string, owner: PasswordOwner): string | undefined {
  if (password.length < LIMIT.password.min || password.length > LIMIT.password.max) return ISSUE_MESSAGE.passwordLength
  if (!PATTERN.passwordLetter.test(password) || !PATTERN.passwordDigit.test(password)) return ISSUE_MESSAGE.passwordLetterDigit
  const lower = password.toLowerCase()
  if (lower === owner.username.trim().toLowerCase() || lower === owner.email.trim().toLowerCase()) return ISSUE_MESSAGE.passwordPersonal
  if (commonSet.has(lower)) return ISSUE_MESSAGE.passwordCommon
  return undefined
}
