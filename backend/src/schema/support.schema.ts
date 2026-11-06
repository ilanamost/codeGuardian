import { z } from 'zod'
import { storableText } from '../lib/validate.js'
import { PATTERN } from '../utils/constants.js'
import { IssueType, SupportPriority } from '../utils/domain.js'
import { ISSUE_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

// Body of POST /api/support-request. Same rules as the browser check in
// frontend/src/lib/validateSupportRequest.ts: values are trimmed first. The email also refuses
// every control or line-separator character (QA 031 F1, kept by plan 032), so a stored address
// never holds a line break.
export const supportRequestSchema = z.strictObject({
  issueType: z.enum(IssueType),
  // `abort`: a value the email pattern already refuses gets one email issue, not two.
  email: storableText().trim().max(LIMIT.email.max).regex(PATTERN.email, { message: ISSUE_MESSAGE.email, abort: true })
    .refine((value) => !PATTERN.controlOrLineSeparator.test(value), ISSUE_MESSAGE.email),
  reviewId: storableText().trim().max(LIMIT.supportReviewIdMax).regex(PATTERN.supportReviewId, ISSUE_MESSAGE.supportReviewId),
  priority: z.enum(SupportPriority),
  description: storableText().trim().min(LIMIT.supportDescription.min).max(LIMIT.supportDescription.max)
})

export type SupportRequestInput = z.infer<typeof supportRequestSchema>
