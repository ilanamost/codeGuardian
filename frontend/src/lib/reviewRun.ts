import { REVIEW_STATUS, unfinishedStatusList } from '../models/review.model'
import type { ReviewStatus } from '../models/dto'
import { toLf } from '../services/util.service'
import { REVIEW_LIMIT } from './review.constants'

export type RunReviewInput = {
  code: string
  language: string
  // What the current findings belong to (GET /api/review/{id} analyzedContent / analyzedLanguage).
  analyzedContent: string
  analyzedLanguage: string
  status: ReviewStatus
  // Something is saving or running.
  busy: boolean
}

// True when the editor code or language differs from what was last analyzed. Code is compared
// trimmed and with LF line breaks, as it is sent, so only real changes count.
export function hasUnanalyzedChange({ code, language, analyzedContent, analyzedLanguage }: Pick<RunReviewInput, 'code' | 'language' | 'analyzedContent' | 'analyzedLanguage'>): boolean {
  return toLf(code).trim() !== toLf(analyzedContent).trim() || language !== analyzedLanguage
}

// Run review on an existing review (plan 021 revision 1): enabled when there is an unanalyzed
// change, the code is not empty or too long, the review is not pending, queued or in progress,
// and nothing is saving or running.
export function canRunReview(input: RunReviewInput): boolean {
  const sent = toLf(input.code)
  if (input.busy || !sent.trim() || sent.length > REVIEW_LIMIT.contentMax) return false
  if (unfinishedStatusList.includes(input.status)) return false
  return hasUnanalyzedChange(input)
}

// The statuses of a review whose analysis stopped (plan 025): it is run again only after a change.
const stoppedStatusList: readonly ReviewStatus[] = [REVIEW_STATUS.failed, REVIEW_STATUS.cancelled]

// True when a failed or cancelled review has no unanalyzed change, so Run review stays disabled
// and the page explains why (plan 025, Open Question 1A).
export function needsChangeToRunAgain(input: Pick<RunReviewInput, 'code' | 'language' | 'analyzedContent' | 'analyzedLanguage' | 'status'>): boolean {
  return stoppedStatusList.includes(input.status) && !hasUnanalyzedChange(input)
}

// Whether the findings on screen were produced from other code than the saved edit (plan 025):
// after Save review and a reload the saved code can differ from `analyzedContent`, so the editor
// must not mark the old findings on it. No saved edit means the editor shows the analyzed code.
export function isSavedFindingStale(
  saved: { code: string; language: string } | null,
  analyzed: Pick<RunReviewInput, 'analyzedContent' | 'analyzedLanguage'>
): boolean {
  if (!saved) return false
  return hasUnanalyzedChange({ code: saved.code, language: saved.language, ...analyzed })
}
