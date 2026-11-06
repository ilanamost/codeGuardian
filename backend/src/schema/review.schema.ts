import { z } from 'zod'
import { nonBlank, storableText } from '../lib/validate.js'
import { SourceType, TestFramework, TestType } from '../utils/domain.js'
import { ISSUE_MESSAGE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

// Request bodies for /api/review (contract: NewReview, SaveReview, rename).

const language = nonBlank(LIMIT.language.min, LIMIT.language.max)
const name = storableText().trim().min(LIMIT.reviewName.min).max(LIMIT.reviewName.max)
const code = nonBlank(LIMIT.content.min, LIMIT.content.max)

export const newReviewSchema = z.strictObject({
  source_type: z.literal(SourceType.Snippet),
  title: storableText().trim().max(LIMIT.reviewTitleMax).optional(),
  language,
  content: code
})

export const saveReviewSchema = z.strictObject({
  name: name.optional(),
  language,
  code
})

export const renameReviewSchema = z.strictObject({ name })

// The order of the test kinds a configuration is stored in, whatever order is sent.
const testTypeOrder: readonly TestType[] = [TestType.Unit, TestType.Edge, TestType.Error]

// Body of POST /api/review/{id}/generated-test (contract 0.13.0, TestConfig): the framework and
// one or more kinds of tests, each at most once.
export const testConfigSchema = z.strictObject({
  framework: z.enum(TestFramework),
  testTypeIdList: z.array(z.enum(TestType)).min(1).max(testTypeOrder.length)
    .refine((list) => new Set(list).size === list.length, ISSUE_MESSAGE.testTypeRepeated)
    .transform((list) => testTypeOrder.filter((type) => list.includes(type)))
})

export type NewReviewInput = z.infer<typeof newReviewSchema>
export type SaveReviewInput = z.infer<typeof saveReviewSchema>
export type TestConfigInput = z.infer<typeof testConfigSchema>
