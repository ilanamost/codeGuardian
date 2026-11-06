import type { Analyzer, AnalyzerInput, AnalyzerPreference, AnalyzerResult } from './analyzer.js'
import type { CountedSeverity, Finding, FindingCategory as FindingCategoryValue, GeneratedTestFile, Severity as SeverityValue, Suggestion, TestConfig } from '../model/dto.js'
import { PATTERN, SEVERITY_WEIGHT, STUB_TEST_FRAMEWORK, STUB_TEST_TYPE_TITLE, type StubFrameworkSyntax } from '../utils/constants.js'
import { AnalyzerKind, Explanation, FindingCategory, Severity, TestType } from '../utils/domain.js'
import { LIMIT } from '../utils/limits.js'
import { HIGH_CONFIDENCE_SEVERITY_LIST, categoryListOf, isHighOnly } from './preference.js'
import { testFileNameOf } from './test-file-name.js'

// STUB ANALYZER: no AI. It applies a few fixed line rules so a created review completes with
// predictable findings. Every finding says "Stub rule" so nobody mistakes it for real analysis.

type Rule = {
  id: string
  severity: SeverityValue
  category: FindingCategoryValue
  message: string
  suggestion: string
  test: (line: string) => boolean
}

const ruleList: Rule[] = [
  { id: 'no-eval', severity: Severity.Critical, category: FindingCategory.Security, message: 'Use of eval', suggestion: 'Replace eval with explicit parsing or a lookup table', test: (line) => /\beval\s*\(/.test(line) },
  { id: 'no-hardcoded-secret', severity: Severity.High, category: FindingCategory.Security, message: 'Possible hardcoded credential', suggestion: 'Read credentials from configuration, never from source', test: (line) => /(password|secret|token|api_?key)\s*[:=]\s*['"][^'"]+['"]/i.test(line) },
  { id: 'no-any', severity: Severity.Medium, category: FindingCategory.Maintainability, message: 'Untyped value (any)', suggestion: 'Replace any with a specific type or unknown', test: (line) => /(:\s*any\b|\bas\s+any\b|<any>)/.test(line) },
  { id: 'no-console', severity: Severity.Low, category: FindingCategory.Readability, message: 'Leftover console call', suggestion: 'Remove console calls or use a logger', test: (line) => /\bconsole\.(log|debug|info)\s*\(/.test(line) },
  { id: 'no-todo', severity: Severity.Low, category: FindingCategory.Maintainability, message: 'Unresolved TODO or FIXME', suggestion: 'Resolve the TODO or track it in an issue', test: (line) => /\b(TODO|FIXME)\b/.test(line) },
  { id: 'max-line-length', severity: Severity.Low, category: FindingCategory.Readability, message: 'Very long line', suggestion: `Break lines longer than ${LIMIT.longLine} characters`, test: (line) => line.length > LIMIT.longLine }
]

const severityWeight: Record<SeverityValue, number> = SEVERITY_WEIGHT
const countedSeverityList: CountedSeverity[] = [Severity.Critical, Severity.High, Severity.Medium, Severity.Low]

// One line of text: a line break inside a file name never breaks the generated code.
function oneLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]/g, ' ')
}

// A JavaScript single-quoted string literal of any text.
function quoted(value: string): string {
  return `'${oneLine(value).replace(/[\\']/g, (character) => `\\${character}`)}'`
}

// The test of each kind, with the framework's assertion (plan 034).
function testBlockOf(type: `${TestType}`, syntax: StubFrameworkSyntax): string[] {
  if (type === TestType.Unit) return ["it('loads the module', () => {", `  expect(true)${syntax.equal}(true)`, '})']
  if (type === TestType.Edge) return ["it('handles an empty input', () => {", `  expect([].length)${syntax.equal}(0)`, '})']
  return ["it('throws on an invalid input', () => {", `  expect(() => { throw new Error('invalid input') })${syntax.throwing}()`, '})']
}

// Stub tests in the configured framework's syntax, with one `describe` per chosen kind of test
// and no other (plan 034). The regenerated variant differs only in its titles.
export function configuredTestCode(sourceFile: string, testConfig: TestConfig, regenerated: boolean): string {
  const syntax = STUB_TEST_FRAMEWORK[testConfig.framework]
  const dot = sourceFile.lastIndexOf('.')
  const name = dot > 0 ? sourceFile.slice(0, dot) : sourceFile
  const suffix = regenerated ? ' (regenerated)' : ''
  return [
    `// Stub ${testConfig.framework} tests for ${oneLine(sourceFile)}${suffix}`,
    ...syntax.importList,
    '',
    `describe(${quoted(`${name}${suffix}`)}, () => {`,
    ...testConfig.testTypeIdList.flatMap((type) => [
      `  describe('${STUB_TEST_TYPE_TITLE[type]}', () => {`,
      ...testBlockOf(type, syntax).map((line) => `    ${line}`),
      '  })'
    ]),
    '})',
    ''
  ].join('\n')
}

function buildTest(input: AnalyzerInput): GeneratedTestFile {
  const { name, extension, id, sourceFile, testFile, language } = testFileNameOf(input)
  const file = { id, sourceFile, testFile, language }
  // A stored test configuration (plan 034); without one, the original output.
  if (input.testConfig) {
    return { ...file, code: configuredTestCode(sourceFile, input.testConfig, false), altCode: configuredTestCode(sourceFile, input.testConfig, true) }
  }
  return {
    ...file,
    code: `// Stub generated test for ${name}.${extension}\ndescribe('${name}', () => {\n  it('loads the module', () => {\n    expect(true).toBe(true)\n  })\n})\n`,
    altCode: `// Stub generated test for ${name}.${extension} (regenerated)\ndescribe('${name} (regenerated)', () => {\n  it('still loads the module', () => {\n    expect(true).toBe(true)\n  })\n})\n`
  }
}

// The rules a preference lets through: a rule out of focus or below the strictness never
// produces a finding or a suggestion.
function activeRuleList(preference: AnalyzerPreference | undefined): Rule[] {
  const categoryList = categoryListOf(preference)
  const highOnly = isHighOnly(preference)
  return ruleList.filter((rule) =>
    (!categoryList || categoryList.includes(rule.category)) && (!highOnly || HIGH_CONFIDENCE_SEVERITY_LIST.includes(rule.severity)))
}

export function createStubAnalyzer(): Analyzer {
  return {
    kind: AnalyzerKind.Stub,

    // The saved AI preferences shape the output (plan 028, Open Question 5); without them, or
    // with the defaults, the output is unchanged.
    async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
      const finding: Finding[] = []
      const hitRule = new Set<Rule>()
      const lineList = input.content.split(PATTERN.lineBreak)
      const activeList = activeRuleList(input.preference)
      const concise = input.preference?.explanation === Explanation.Concise

      lineList.forEach((line, index) => {
        for (const rule of activeList) {
          if (finding.length >= LIMIT.maxFinding || !rule.test(line)) continue
          hitRule.add(rule)
          finding.push({
            id: `f${finding.length + 1}`,
            severity: rule.severity,
            category: rule.category,
            message: rule.message,
            detail: concise ? `Line ${index + 1}` : `Line ${index + 1} - Stub rule ${rule.id}`,
            line_start: index + 1
          })
        }
      })

      const suggestion: Suggestion[] = [...hitRule].map((rule, index) => ({
        id: `s${index + 1}`,
        title: rule.suggestion,
        detail: `Stub rule ${rule.id}`
      }))

      const penalty = finding.reduce((sum, item) => sum + severityWeight[item.severity], 0)

      return {
        qualityScore: Math.max(LIMIT.minQualityScore, LIMIT.fullQualityScore - penalty),
        findingCount: countedSeverityList.map((severity) => ({
          severity,
          count: finding.filter((item) => item.severity === severity).length
        })),
        finding,
        suggestion,
        generatedTest: input.preference?.generatedTest === false ? [] : [buildTest(input)]
      }
    },

    // The stub swaps each file's code with its stored variant, so pressing "Regenerate" again
    // brings the first version back. With a test configuration (plan 034) each file gets that
    // configuration's first variant, or its second when it already holds the first, so it still
    // alternates.
    async regenerateTest(fileList: GeneratedTestFile[], testConfig?: TestConfig): Promise<GeneratedTestFile[]> {
      if (!testConfig) return fileList.map((file) => ({ ...file, code: file.altCode, altCode: file.code }))
      return fileList.map((file) => {
        const first = configuredTestCode(file.sourceFile, testConfig, false)
        const second = configuredTestCode(file.sourceFile, testConfig, true)
        return file.code === first ? { ...file, code: second, altCode: first } : { ...file, code: first, altCode: second }
      })
    }
  }
}
