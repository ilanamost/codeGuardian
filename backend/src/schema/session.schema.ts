import { z } from 'zod'
import { storableText } from '../lib/validate.js'
import { LIMIT } from '../utils/limits.js'

// Body of POST /api/session (contract 0.8.0, SignIn). Unknown fields are 422; zod messages
// never echo the submitted value. The user name is trimmed, the password is not.
export const signInSchema = z.strictObject({
  username: storableText().trim().min(LIMIT.signInUsername.min).max(LIMIT.signInUsername.max),
  password: storableText().min(LIMIT.signInPassword.min).max(LIMIT.signInPassword.max)
})

export type SignInInput = z.infer<typeof signInSchema>
