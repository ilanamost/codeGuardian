import type { FindingCategory as FindingCategoryValue, Severity as SeverityValue } from '../model/dto.js'
import { Explanation, FindingCategory, ReviewFocus, Severity, Strictness } from '../utils/domain.js'
import type { AnalyzerPreference } from './analyzer.js'

// What each AI preference means, for both analyzers (plan 028 Open Question 5, kept by plan
// 039): a setting means the same thing with the stub and with Claude.

// The categories each review focus keeps; `all` keeps every one (undefined).
export const FOCUS_CATEGORY_LIST: Record<`${ReviewFocus}`, readonly FindingCategoryValue[] | undefined> = {
  [ReviewFocus.All]: undefined,
  [ReviewFocus.Bugs]: [FindingCategory.Bug],
  [ReviewFocus.Security]: [FindingCategory.Security],
  [ReviewFocus.Performance]: [FindingCategory.Performance],
  [ReviewFocus.Readability]: [FindingCategory.Readability, FindingCategory.Maintainability]
}

// "Only high-confidence" keeps these; "balanced" and "comprehensive" keep every severity.
export const HIGH_CONFIDENCE_SEVERITY_LIST: readonly SeverityValue[] = [Severity.Critical, Severity.High]

// The saved defaults (src/data/settings-default.json), used when an analysis has no preference.
export const PREFERENCE_DEFAULT: AnalyzerPreference = {
  reviewFocus: ReviewFocus.All,
  strictness: Strictness.Balanced,
  explanation: Explanation.Detailed,
  generatedTest: true
}

// The categories a preference lets through, or undefined for every category.
export function categoryListOf(preference: AnalyzerPreference | undefined): readonly FindingCategoryValue[] | undefined {
  return preference ? FOCUS_CATEGORY_LIST[preference.reviewFocus] : undefined
}

export function isHighOnly(preference: AnalyzerPreference | undefined): boolean {
  return preference?.strictness === Strictness.HighConfidence
}
