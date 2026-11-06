import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GeneratedTestsTab from '../../src/components/GeneratedTestsTab'
import ReviewTabs from '../../src/components/ReviewTabs'
import {
  GENERATED_TEST_OFF_HINT,
  REVIEW_PLACEHOLDER_STATE,
  REVIEW_PLACEHOLDER_TAB,
  REVIEW_PLACEHOLDER_TEXT,
  REVIEW_PLACEHOLDER_TEST_ID_SUFFIX,
  REVIEW_TEXT,
  reviewPlaceholderTestId,
  type ReviewPlaceholderState,
  type ReviewPlaceholderTab
} from '../../src/lib/review.constants'
import { reviewPlaceholderFor, reviewPlaceholderState } from '../../src/lib/reviewPlaceholder'
import { AppSettings } from '../../src/models/settings.model'
import { REVIEW_STATUS, reviewStatusList } from '../../src/models/review.model'
import { loadFixtureData } from '../utils/fixtureData'
import type { ReviewDto, ReviewStatus } from '../../src/types'
import { sampleReview } from '../utils/sampleData'
import { renderWithStore } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>
}))

// Every status, with the state its empty tabs show (plan 020 Open Question 1: one per state).
const expectedStateByStatus: Record<ReviewStatus, ReviewPlaceholderState> = {
  pending: REVIEW_PLACEHOLDER_STATE.analyzing,
  queued: REVIEW_PLACEHOLDER_STATE.analyzing,
  in_progress: REVIEW_PLACEHOLDER_STATE.analyzing,
  completed: REVIEW_PLACEHOLDER_STATE.completed,
  failed: REVIEW_PLACEHOLDER_STATE.stopped,
  cancelled: REVIEW_PLACEHOLDER_STATE.stopped
}

const placeholderTabList = Object.values(REVIEW_PLACEHOLDER_TAB)

function emptyReview(status: ReviewStatus): ReviewDto {
  return { ...sampleReview, status, findingCount: [], finding: [], suggestion: [], generatedTest: [] }
}

function renderTabs(review: ReviewDto, isNew = false, generatedTest = true) {
  return renderWithStore(
    <ReviewTabs
      reviewId="r1"
      review={review}
      code={review.content}
      onCodeChange={() => {}}
      language="TypeScript"
      languageList={['TypeScript']}
      onLanguageChange={() => {}}
      isNew={isNew}
    />,
    { preloadedState: { settings: { ...AppSettings.defaultDto(), generatedTest } } }
  )
}

// The tab whose body is the placeholder of `tab`, and the label it is opened by.
const tabCase: { tab: ReviewPlaceholderTab; label: RegExp }[] = [
  { tab: REVIEW_PLACEHOLDER_TAB.finding, label: /^Findings/ },
  { tab: REVIEW_PLACEHOLDER_TAB.suggestion, label: /^Suggested refactors/ },
  { tab: REVIEW_PLACEHOLDER_TAB.generatedTest, label: /^Generated tests/ }
]

// (status, isNew) pairs covering the four states: not run, analyzing, completed, failed or cancelled.
const stateCase: { name: string; status: ReviewStatus; isNew: boolean; state: ReviewPlaceholderState }[] = [
  { name: 'not run yet', status: REVIEW_STATUS.pending, isNew: true, state: REVIEW_PLACEHOLDER_STATE.notRun },
  ...reviewStatusList.map((status) => ({ name: status, status, isNew: false, state: expectedStateByStatus[status] }))
]

describe('reviewPlaceholderState', () => {
  it.each(reviewStatusList)('maps %s to its state for a saved review', (status) => {
    expect(reviewPlaceholderState(status, false)).toBe(expectedStateByStatus[status])
  })

  it.each(reviewStatusList)('maps %s to "not run yet" for a new review', (status) => {
    expect(reviewPlaceholderState(status, true)).toBe(REVIEW_PLACEHOLDER_STATE.notRun)
  })

  it('covers every status (the expectation table has no extra or missing status)', () => {
    expect(Object.keys(expectedStateByStatus).sort()).toEqual([...reviewStatusList].sort())
  })
})

describe('reviewPlaceholderFor', () => {
  it('has a non-empty title and detail for every state and tab', () => {
    for (const state of Object.values(REVIEW_PLACEHOLDER_STATE)) {
      for (const tab of placeholderTabList) {
        expect(REVIEW_PLACEHOLDER_TEXT[state][tab].title).not.toBe('')
        expect(REVIEW_PLACEHOLDER_TEXT[state][tab].detail).not.toBe('')
      }
    }
  })

  it('never says "No issues found" before the analysis has finished', () => {
    for (const status of [REVIEW_STATUS.pending, REVIEW_STATUS.queued, REVIEW_STATUS.inProgress, REVIEW_STATUS.failed]) {
      expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.finding, status, false).title).not.toBe(
        REVIEW_PLACEHOLDER_TEXT.completed.finding.title
      )
    }
    expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.finding, REVIEW_STATUS.completed, true).title).toBe(
      REVIEW_PLACEHOLDER_TEXT.notRun.finding.title
    )
  })

  it('adds the Settings hint only to "No tests generated" with generated tests off', () => {
    expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.generatedTest, REVIEW_STATUS.completed, false, false).hint).toBe(GENERATED_TEST_OFF_HINT)
    expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.generatedTest, REVIEW_STATUS.completed, false, true).hint).toBeUndefined()
    expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.generatedTest, REVIEW_STATUS.inProgress, false, false).hint).toBeUndefined()
    expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.finding, REVIEW_STATUS.completed, false, false).hint).toBeUndefined()
  })
})

describe('Review tab placeholders', () => {
  describe.each(stateCase)('$name', ({ status, isNew, state }) => {
    it.each(tabCase)('the $tab tab shows only its placeholder', async ({ tab, label }) => {
      const user = userEvent.setup()
      renderTabs(emptyReview(status), isNew)
      await user.click(screen.getByRole('tab', { name: label }))

      const panel = screen.getByRole('tabpanel')
      const placeholder = within(panel).getByTestId(reviewPlaceholderTestId(tab))
      const text = REVIEW_PLACEHOLDER_TEXT[state][tab]
      expect(within(placeholder).getByText(text.title)).toBeInTheDocument()
      expect(within(placeholder).getByText(text.detail)).toBeInTheDocument()
      // Nothing else renders in that tab: the placeholder is the panel's only content.
      expect(panel.children).toHaveLength(1)
      expect(panel.firstElementChild).toBe(placeholder)
      expect(within(panel).queryByRole('listitem')).toBeNull()
    })

    it('the Summary tab shows the findings placeholder under Key Issues', () => {
      renderTabs(emptyReview(status), isNew)

      const keyIssue = screen.getByRole('heading', { name: 'Key Issues' }).closest('section') as HTMLElement
      const text = REVIEW_PLACEHOLDER_TEXT[state].finding
      expect(within(keyIssue).getByText(text.title)).toBeInTheDocument()
      expect(within(keyIssue).getByText(text.detail)).toBeInTheDocument()
      expect(within(keyIssue).queryByRole('listitem')).toBeNull()
    })
  })

  it('keeps the counts in the tab labels', () => {
    renderTabs(emptyReview(REVIEW_STATUS.completed))

    expect(screen.getByRole('tab', { name: 'Findings (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Suggested refactors (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Generated tests (0)' })).toBeInTheDocument()
  })

  it.each(tabCase)('shows no placeholder in the $tab tab when its list has items', async ({ tab, label }) => {
    const user = userEvent.setup()
    renderTabs({ ...sampleReview, status: REVIEW_STATUS.completed })
    await user.click(screen.getByRole('tab', { name: label }))

    expect(screen.queryByTestId(reviewPlaceholderTestId(tab))).toBeNull()
  })

  it('shows no placeholder under Key Issues when there are findings', () => {
    renderTabs({ ...sampleReview, status: REVIEW_STATUS.completed })

    expect(screen.queryByTestId(reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.finding))).toBeNull()
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})

describe('QA round 1 fixes', () => {
  it('hides "View all findings" on the Summary when there is no finding', () => {
    renderTabs(emptyReview(REVIEW_STATUS.completed))

    expect(screen.queryByRole('button', { name: REVIEW_TEXT.viewAllFindings })).toBeNull()
  })

  it('shows "View all findings" when there are findings, and it opens the Findings tab', async () => {
    const user = userEvent.setup()
    renderTabs({ ...sampleReview, status: REVIEW_STATUS.completed })
    await user.click(screen.getByRole('button', { name: REVIEW_TEXT.viewAllFindings }))

    expect(screen.getByRole('tab', { name: /^Findings/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('the stopped details never repeat the stopped title', () => {
    for (const tab of placeholderTabList) {
      const { title, detail } = REVIEW_PLACEHOLDER_TEXT.stopped[tab]
      expect(detail).not.toContain(title)
    }
  })

  it('falls back to the stopped state for a value that is not a status', () => {
    expect(reviewPlaceholderState('archived' as ReviewStatus, false)).toBe(REVIEW_PLACEHOLDER_STATE.stopped)
    expect(reviewPlaceholderFor(REVIEW_PLACEHOLDER_TAB.finding, 'archived' as ReviewStatus, false)).toEqual(
      REVIEW_PLACEHOLDER_TEXT.stopped.finding
    )
  })

  it('builds the placeholder test id from the shared suffix', () => {
    expect(reviewPlaceholderTestId(REVIEW_PLACEHOLDER_TAB.suggestion)).toBe(
      `${REVIEW_PLACEHOLDER_TAB.suggestion}${REVIEW_PLACEHOLDER_TEST_ID_SUFFIX}`
    )
  })

  it('JSON seed: only completed reviews carry results; the others have empty lists', () => {
    const data = loadFixtureData()
    const entryList = Object.values(data.reviewById)
    expect(entryList.some((review) => review.status !== REVIEW_STATUS.completed)).toBe(true)
    for (const review of entryList) {
      if (review.status === REVIEW_STATUS.completed) {
        expect(review.finding.length).toBeGreaterThan(0)
        continue
      }
      expect(review.finding).toEqual([])
      expect(review.findingCount).toEqual([])
      expect(review.suggestion).toEqual([])
      expect(review.generatedTest).toEqual([])
    }
  })

  it('JSON seed: a review without results lists no finding counts in History', () => {
    const data = loadFixtureData()
    for (const summary of data.reviewSummaryList) {
      const review = data.reviewById[summary.id]
      if (review && review.finding.length === 0) expect(summary.high + summary.medium + summary.low).toBe(0)
    }
  })
})

describe('Generated tests placeholder', () => {
  function renderGeneratedTest(status: ReviewStatus, generatedTest: boolean) {
    return renderWithStore(<GeneratedTestsTab reviewId="r1" status={status} fileList={[]} />, {
      preloadedState: { settings: { ...AppSettings.defaultDto(), generatedTest } }
    })
  }

  it('renders the placeholder instead of nothing when there is no file', () => {
    const { container } = renderGeneratedTest(REVIEW_STATUS.completed, true)

    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText(REVIEW_PLACEHOLDER_TEXT.completed.generated_test.title)).toBeInTheDocument()
    expect(screen.queryByText(GENERATED_TEST_OFF_HINT)).toBeNull()
  })

  it('adds the Settings hint when generated tests are off', () => {
    renderGeneratedTest(REVIEW_STATUS.completed, false)

    expect(screen.getByText(REVIEW_PLACEHOLDER_TEXT.completed.generated_test.title)).toBeInTheDocument()
    expect(screen.getByText(GENERATED_TEST_OFF_HINT)).toBeInTheDocument()
  })

  it('hides the Generated tests tab when they are off in Settings', () => {
    renderTabs(emptyReview(REVIEW_STATUS.completed), false, false)

    expect(screen.queryByRole('tab', { name: /Generated tests/ })).toBeNull()
  })
})
