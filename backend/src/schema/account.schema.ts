import { z } from 'zod'
import { storableText } from '../lib/validate.js'
import { PATTERN } from '../utils/constants.js'
import { ISSUE_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

// Body of PUT /api/account/password. zod messages never echo the submitted value. The password
// rules of a new password (plan 028) are checked by the service, which knows the account.
export const passwordChangeSchema = z.strictObject({
  currentPassword: storableText().min(LIMIT.password.currentMin).max(LIMIT.password.max),
  newPassword: storableText().min(LIMIT.password.min).max(LIMIT.password.max)
})

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>

// The user name and email rules shared by registration and the account update (plan 034), so
// both answer the same 422. The email is stored lower-cased and, like the support request email,
// refuses every control or line-separator character (`abort`: one issue, not two).
const username = storableText().trim().min(LIMIT.username.min).max(LIMIT.username.max).regex(PATTERN.username, ISSUE_MESSAGE.username)
const email = storableText().trim().max(LIMIT.email.max).regex(PATTERN.email, { message: ISSUE_MESSAGE.email, abort: true })
  .refine((value) => !PATTERN.controlOrLineSeparator.test(value), ISSUE_MESSAGE.email)
  .transform((value) => value.toLowerCase())

// Body of POST /api/account, registration (contract 0.8.0, Registration). The same rules as
// the register form. Confirm password is never sent.
export const registrationSchema = z.strictObject({
  username,
  email,
  password: storableText().min(LIMIT.password.min).max(LIMIT.password.max)
})

export type RegistrationInput = z.infer<typeof registrationSchema>

// Body of PUT /api/account (contract 0.13.0, AccountUpdate). At least one of username and email.
// `currentPassword` is optional here so that a missing one is refused by the service like a wrong
// one (422 on currentPassword, counted toward the failure limit, plan 034 Open Question 1).
export const accountUpdateSchema = z.strictObject({
  username: username.optional(),
  email: email.optional(),
  currentPassword: storableText().max(LIMIT.password.max).optional()
}).refine((value) => value.username !== undefined || value.email !== undefined, ISSUE_MESSAGE.accountUpdateEmpty)

export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>
