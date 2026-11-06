import { z } from 'zod'
import { storableText } from '../lib/validate.js'
import { EditorFontSize, Explanation, HistoryDensity, ReviewFocus, Strictness, Theme } from '../utils/domain.js'
import { LIMIT } from '../utils/limits.js'

// Body of PUT /api/settings: the full Settings object, every field required.
export const settingsSchema = z.strictObject({
  notification: z.strictObject({
    reviewCompleted: z.boolean(),
    reviewFailed: z.boolean(),
    criticalFinding: z.boolean(),
    email: z.boolean()
  }),
  theme: z.enum(Theme),
  editorFontSize: z.enum(EditorFontSize),
  historyDensity: z.enum(HistoryDensity),
  reviewFocus: z.enum(ReviewFocus),
  strictness: z.enum(Strictness),
  explanation: z.enum(Explanation),
  generatedTest: z.boolean(),
  // 'auto' or a language name.
  language: storableText().trim().min(LIMIT.language.min).max(LIMIT.language.max)
})
