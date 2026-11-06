import { z } from 'zod'
import { validationError } from './error.js'
import { ERROR_MESSAGE, ISSUE_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

export type ValidationIssue = { field: string, message: string }

// Runs a zod schema and turns a failure into a 422 with one issue per invalid field.
// Only the field path and zod's message are returned, never the submitted value.
export function parse<Schema extends z.ZodType>(schema: Schema, value: unknown, subject: string): z.infer<Schema> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue: ValidationIssue[] = result.error.issues.map((item) => ({
    field: item.path.length > 0 ? item.path.join('.') : subject,
    message: item.message
  }))
  const first = issue[0]
  throw validationError(ERROR_MESSAGE.invalidInput(subject, first?.field, first?.message), { issue })
}

// Every id path segment: letters, digits and dashes only (plan 018, Security).
const idPattern = new RegExp(`^[A-Za-z0-9-]{${LIMIT.id.min},${LIMIT.id.max}}$`)
export const idSchema = z.string().regex(idPattern, ISSUE_MESSAGE.id)

export function parseId(value: unknown, field: string): string {
  const result = idSchema.safeParse(value)
  if (result.success) return result.data
  throw validationError(ERROR_MESSAGE.invalidField(field), { issue: [{ field, message: result.error.issues[0]?.message ?? ISSUE_MESSAGE.invalid }] })
}

// User text both stores keep unchanged (QA AI-43 D1, D2): no NUL character and no unpaired
// surrogate. Every request field that takes free text goes through it, so the memory store and
// PostgreSQL answer the same 422.
export function storableText() {
  return z.string()
    .refine((value) => !value.includes('\u0000'), ISSUE_MESSAGE.nulCharacter)
    .refine((value) => value.isWellFormed(), ISSUE_MESSAGE.notWellFormed)
}

// A non-blank string: the value is kept as typed, only the check trims.
export function nonBlank(min: number, max: number) {
  return storableText().min(min).max(max).refine((value) => value.trim().length > 0, ISSUE_MESSAGE.blank)
}

// Counts code points (not UTF-16 units) and stops early past the limit, for the JSON body check in `app.ts`.
export function exceedsCharLimit(text: string, limit: number): boolean {
  let count = 0
  for (const _codePoint of text) {
    count += 1
    if (count > limit) return true
  }
  return false
}
