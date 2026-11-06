import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { FindingCategory, Severity } from '../utils/domain.js'
import { LIMIT } from '../utils/limits.js'

// What the model must answer (plan 039). The same zod schema builds the JSON schema sent as
// `output_config.format` and checks the answer again on the server: the server never trusts the
// model's JSON. Ids, counts, file names and the quality score are NOT here; the server adds them.

const findingSchema = z.object({
  severity: z.enum(Severity),
  category: z.enum(FindingCategory),
  message: z.string().min(1).max(LIMIT.analyzer.messageMax),
  detail: z.string().max(LIMIT.analyzer.detailMax),
  // 1-based, in the numbered code of the prompt; the server drops a line outside the code.
  line_start: z.number().int().min(1)
})

const suggestionSchema = z.object({
  title: z.string().min(1).max(LIMIT.analyzer.messageMax),
  detail: z.string().max(LIMIT.analyzer.detailMax)
})

const testSchema = z.object({
  code: z.string().min(1).max(LIMIT.analyzer.testCodeMax)
})

export const analysisSchema = z.object({
  finding: z.array(findingSchema).max(LIMIT.analyzer.findingMax),
  suggestion: z.array(suggestionSchema).max(LIMIT.analyzer.suggestionMax),
  // null when no test was requested.
  generatedTest: testSchema.nullable()
})

// The answer of one regenerate call: only the new test file.
export const regenerateSchema = testSchema

export type AnalysisOutput = z.infer<typeof analysisSchema>
export type RegenerateOutput = z.infer<typeof regenerateSchema>

// A JSON schema as the Messages API takes it in `output_config.format`.
export type OutputFormat = { type: 'json_schema', schema: Record<string, unknown> }

function formatOf(schema: z.ZodType): OutputFormat {
  const { type, schema: jsonSchema } = zodOutputFormat(schema)
  return { type, schema: jsonSchema as Record<string, unknown> }
}

export const analysisOutputFormat: OutputFormat = formatOf(analysisSchema)
export const regenerateOutputFormat: OutputFormat = formatOf(regenerateSchema)
