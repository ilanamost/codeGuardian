import { REVIEW_STATUS } from '../models/review.model'
import type { ReviewStatus } from '../types'
import {
  GENERATED_TEST_OFF_HINT,
  REVIEW_PLACEHOLDER_STATE,
  REVIEW_PLACEHOLDER_TAB,
  REVIEW_PLACEHOLDER_TEXT,
  type ReviewPlaceholderState,
  type ReviewPlaceholderTab,
  type ReviewPlaceholderText
} from './review.constants'

// The one place that maps a review's (status, isNew) to the placeholder state. A new review
// (/review/new) has not run yet whatever its status says. The switch covers every status, so a
// new status fails the typecheck here instead of falling through to a wrong text. A value that is
// not a status at all (a malformed payload at run time) falls back to `stopped`, never a crash.
export function reviewPlaceholderState(status: ReviewStatus, isNew: boolean): ReviewPlaceholderState {
  if (isNew) return REVIEW_PLACEHOLDER_STATE.notRun
  switch (status) {
    case REVIEW_STATUS.pending:
    case REVIEW_STATUS.queued:
    case REVIEW_STATUS.inProgress:
      return REVIEW_PLACEHOLDER_STATE.analyzing
    case REVIEW_STATUS.completed:
      return REVIEW_PLACEHOLDER_STATE.completed
    case REVIEW_STATUS.failed:
    case REVIEW_STATUS.cancelled:
      return REVIEW_PLACEHOLDER_STATE.stopped
    default: {
      const unknownStatus: never = status
      void unknownStatus
      return REVIEW_PLACEHOLDER_STATE.stopped
    }
  }
}

export type ReviewPlaceholder = ReviewPlaceholderText & { hint?: string }

// The title and detail a tab shows while its list is empty. `generatedTestOn` is the Settings
// toggle: "No tests generated" gets a hint when it is off.
export function reviewPlaceholderFor(
  tab: ReviewPlaceholderTab,
  status: ReviewStatus,
  isNew: boolean,
  generatedTestOn = true
): ReviewPlaceholder {
  const state = reviewPlaceholderState(status, isNew)
  const text = REVIEW_PLACEHOLDER_TEXT[state][tab]
  const showHint = tab === REVIEW_PLACEHOLDER_TAB.generatedTest && state === REVIEW_PLACEHOLDER_STATE.completed && !generatedTestOn
  return showHint ? { ...text, hint: GENERATED_TEST_OFF_HINT } : text
}
