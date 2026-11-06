import { act, fireEvent, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import ReviewTabs from '../../src/components/ReviewTabs'
import {
  REVIEW_PLACEHOLDER_TAB,
  REVIEW_PLACEHOLDER_TEXT,
  REVIEW_POLL_INTERVAL_MS,
  reviewPlaceholderTestId,
  type ReviewPlaceholderTab
} from '../../src/lib/review.constants'
import type { ReviewDetailDto } from '../../src/models/dto'
import { REVIEW_STATUS } from '../../src/models/review.model'
import { AppSettings } from '../../src/models/settings.model'
import type { ReviewDto, ReviewStatus } from '../../src/types'
import { createFakeServices } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'
import { renderWithStore, settle } from '../utils/renderWithStore'

// QA (AI-37, plan 020): adversarial checks on the review tab placeholders. Tests named
// "KNOWN DEFECT" used it.fails; the ones fixed in QA round 1 are now named "D<n> fixed".

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

const placeholderId = (tab: ReviewPlaceholderTab) => reviewPlaceholderTestId(tab)
const findingId = placeholderId(REVIEW_PLACEHOLDER_TAB.finding)
const suggestionId = placeholderId(REVIEW_PLACEHOLDER_TAB.suggestion)
const generatedTestId = placeholderId(REVIEW_PLACEHOLDER_TAB.generatedTest)

function emptyReview(status: ReviewStatus): ReviewDto {
  return { ...sampleReview, status, findingCount: [], finding: [], suggestion: [], generatedTest: [] }
}

function detail(review: ReviewDto): ReviewDetailDto {
  return { id: 'r7', review, saved: null, analyzedContent: review.content, analyzedLanguage: review.language }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function openTab(label: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name: label }))
}

function expectText(testId: string, text: { title: string; detail: string }) {
  const placeholder = within(screen.getByRole('tabpanel')).getByTestId(testId)
  expect(within(placeholder).getByText(text.title)).toBeInTheDocument()
  expect(within(placeholder).getByText(text.detail)).toBeInTheDocument()
}

describe('QA AI-37: placeholder follows the status while the page polls', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Answers `sequence` one by one, then repeats the last one.
  function sequenceServices(sequence: ReviewDto[]) {
    const { services } = createFakeServices()
    let call = 0
    services.review.get.mockImplementation(async () => detail(structuredClone(sequence[Math.min(call++, sequence.length - 1)])))
    return services
  }

  it('pending -> in_progress -> completed (empty): the open Findings tab switches from analyzing to completed', async () => {
    const services = sequenceServices([emptyReview('pending'), emptyReview('in_progress'), emptyReview('completed')])
    renderWithStore(<App />, { route: '/review/r7', services })
    await advance(0)

    openTab(/^Findings/)
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)

    await advance(REVIEW_POLL_INTERVAL_MS)
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)

    await advance(REVIEW_POLL_INTERVAL_MS)
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.completed.finding)
    expect(screen.queryByText(REVIEW_PLACEHOLDER_TEXT.analyzing.finding.title)).toBeNull()
    // The tab stays selected across the status change.
    expect(screen.getByRole('tab', { name: 'Findings (0)' })).toHaveAttribute('aria-selected', 'true')
  })

  it('pending -> completed with items: the placeholder disappears and the list renders, on every tab', async () => {
    const services = sequenceServices([emptyReview('pending'), { ...sampleReview, status: REVIEW_STATUS.completed }])
    renderWithStore(<App />, { route: '/review/r7', services })
    await advance(0)

    openTab(/^Suggested refactors/)
    expectText(suggestionId, REVIEW_PLACEHOLDER_TEXT.analyzing.suggestion)
    await advance(REVIEW_POLL_INTERVAL_MS)
    expect(screen.queryByTestId(suggestionId)).toBeNull()
    expect(screen.getByRole('tab', { name: `Suggested refactors (${sampleReview.suggestion.length})` })).toBeInTheDocument()

    openTab(/^Findings/)
    expect(screen.queryByTestId(findingId)).toBeNull()
    openTab(/^Generated tests/)
    expect(screen.queryByTestId(generatedTestId)).toBeNull()
    openTab(/^Summary/)
    expect(screen.queryByTestId(findingId)).toBeNull()
  })

  it('pending -> failed: Summary Key issues and Generated tests switch to the stopped text', async () => {
    const services = sequenceServices([emptyReview('pending'), emptyReview('failed')])
    renderWithStore(<App />, { route: '/review/r7', services })
    await advance(0)

    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)
    await advance(REVIEW_POLL_INTERVAL_MS)
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.stopped.finding)

    openTab(/^Generated tests/)
    expectText(generatedTestId, REVIEW_PLACEHOLDER_TEXT.stopped.generated_test)
    // Polling stopped: no more requests after a finished status.
    const calls = services.review.get.mock.calls.length
    await advance(REVIEW_POLL_INTERVAL_MS * 10)
    expect(services.review.get).toHaveBeenCalledTimes(calls)
  })

  it('queued -> cancelled: the stopped text replaces the analyzing text', async () => {
    const services = sequenceServices([emptyReview('queued'), emptyReview('cancelled')])
    renderWithStore(<App />, { route: '/review/r7', services })
    await advance(0)
    openTab(/^Suggested refactors/)
    expectText(suggestionId, REVIEW_PLACEHOLDER_TEXT.analyzing.suggestion)
    await advance(REVIEW_POLL_INTERVAL_MS)
    expectText(suggestionId, REVIEW_PLACEHOLDER_TEXT.stopped.suggestion)
  })
})

describe('QA AI-37: mixed lists and rapid interaction', () => {
  function renderTabs(review: ReviewDto, isNew = false, generatedTest = true) {
    return renderWithStore(
      <ReviewTabs
        reviewId="r1"
        review={review}
        code=""
        onCodeChange={() => {}}
        language="TypeScript"
        languageList={['TypeScript']}
        onLanguageChange={() => {}}
        isNew={isNew}
      />,
      { preloadedState: { settings: { ...AppSettings.defaultDto(), generatedTest } } }
    )
  }

  it('completed with findings but no suggestions: only the Suggested refactors tab has a placeholder', () => {
    renderTabs({ ...sampleReview, status: REVIEW_STATUS.completed, suggestion: [], generatedTest: [] })

    expect(screen.queryByTestId(findingId)).toBeNull()
    openTab(/^Findings/)
    expect(screen.queryByTestId(findingId)).toBeNull()
    expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(sampleReview.finding.length)
    openTab(/^Suggested refactors/)
    expectText(suggestionId, REVIEW_PLACEHOLDER_TEXT.completed.suggestion)
    openTab(/^Generated tests/)
    expectText(generatedTestId, REVIEW_PLACEHOLDER_TEXT.completed.generated_test)
  })

  it('completed with suggestions but no findings: Summary and Findings have the placeholder, refactors do not', () => {
    renderTabs({ ...sampleReview, status: REVIEW_STATUS.completed, finding: [], findingCount: [] })

    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.completed.finding)
    openTab(/^Findings/)
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.completed.finding)
    openTab(/^Suggested refactors/)
    expect(screen.queryByTestId(suggestionId)).toBeNull()
    expect(screen.getByRole('tab', { name: `Suggested refactors (${sampleReview.suggestion.length})` })).toBeInTheDocument()
  })

  it('a single finding (fewer than the Summary limit of 3) shows no placeholder in the Summary', () => {
    renderTabs({ ...sampleReview, status: REVIEW_STATUS.completed, finding: sampleReview.finding.slice(0, 1) })
    expect(screen.queryByTestId(findingId)).toBeNull()
  })

  it('rapid tab switching 50 times leaves exactly one placeholder in the panel', () => {
    renderTabs(emptyReview(REVIEW_STATUS.completed))
    const labelList = [/^Summary/, /^Findings/, /^Suggested refactors/, /^Generated tests/]
    for (let index = 0; index < 50; index += 1) openTab(labelList[index % labelList.length])
    openTab(/^Generated tests/)
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByTestId(/-placeholder$/)).toHaveLength(1)
    expectText(generatedTestId, REVIEW_PLACEHOLDER_TEXT.completed.generated_test)
  })

  it('generated tests off: the tab is hidden, the other placeholders still render', () => {
    renderTabs(emptyReview(REVIEW_STATUS.completed), false, false)
    expect(screen.queryByRole('tab', { name: /Generated tests/ })).toBeNull()
    expect(screen.queryByTestId(generatedTestId)).toBeNull()
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.completed.finding)
    openTab(/^Suggested refactors/)
    expectText(suggestionId, REVIEW_PLACEHOLDER_TEXT.completed.suggestion)
  })

  // Low: Review.fromDto rejects an unknown status at the service boundary, so only a caller that
  // bypasses the DTO check reaches this. The exhaustive switch returns the raw value as a state,
  // and REVIEW_PLACEHOLDER_TEXT[state] is undefined.
  it('D4 fixed: a malformed status (not in REVIEW_STATUS) does not crash the tabs', () => {
    expect(() => renderTabs(emptyReview('archived' as ReviewStatus))).not.toThrow()
  })
})

describe('QA AI-37: accessibility', () => {
  function renderEmpty() {
    return renderWithStore(
      <ReviewTabs
        reviewId="r1"
        review={emptyReview(REVIEW_STATUS.completed)}
        code=""
        onCodeChange={() => {}}
        language="TypeScript"
        languageList={['TypeScript']}
        onLanguageChange={() => {}}
      />
    )
  }

  it.each([
    [/^Summary/, findingId],
    [/^Findings/, findingId],
    [/^Suggested refactors/, suggestionId],
    [/^Generated tests/, generatedTestId]
  ])('the %s placeholder icon is hidden from screen readers and the text is plain readable text', (label, testId) => {
    renderEmpty()
    openTab(label)
    const placeholder = screen.getByTestId(testId)
    const svgList = placeholder.querySelectorAll('svg')
    expect(svgList.length).toBeGreaterThan(0)
    svgList.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
    expect(placeholder.textContent?.trim().length).toBeGreaterThan(0)
    expect(placeholder).not.toHaveAttribute('aria-hidden')
  })
})

describe('QA AI-37: fake backend parity', () => {
  // Against the backend the e2e helper `showReviewAs` gives an unfinished review empty lists until the
  // analyzer finishes. In JSON mode every seeded review opens the full template, whatever its status.
  it('D2 fixed: a seeded pending review (r7) shows the analyzing placeholder, not finished findings', async () => {
    renderWithStore(<App />, { route: '/review/r7' })
    await settle()
    await settle()
    expect(screen.getByTestId(findingId)).toBeInTheDocument()
  })

  it('D2 fixed: a seeded failed review (r4) shows the stopped placeholder, not finished findings', async () => {
    renderWithStore(<App />, { route: '/review/r4' })
    await settle()
    await settle()
    expect(screen.getByTestId(findingId)).toBeInTheDocument()
  })

  // Was "current JSON behavior (why the two above fail)"; after the D2 fix r7 has no results.
  it('JSON behavior after the D2 fix: r7 is pending with empty lists and the analyzing placeholder', async () => {
    renderWithStore(<App />, { route: '/review/r7' })
    await settle()
    await settle()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Findings (0)' })).toBeInTheDocument()
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.analyzing.finding)
  })

  it('/review/new on the fake backend shows the "not run yet" placeholders (same as the backend)', async () => {
    renderWithStore(<App />, { route: '/review/new' })
    await settle()
    expectText(findingId, REVIEW_PLACEHOLDER_TEXT.notRun.finding)
    openTab(/^Generated tests/)
    expectText(generatedTestId, REVIEW_PLACEHOLDER_TEXT.notRun.generated_test)
  })
})

describe('QA AI-37: no hard-coded placeholder strings in the changed source', () => {
  const root = resolve(__dirname, '../../src')
  const changed = ['components/TabPlaceholder.tsx', 'components/KeyIssues.tsx', 'components/ReviewTabs.tsx', 'components/GeneratedTestsTab.tsx', 'lib/reviewPlaceholder.ts']

  it('no placeholder title or detail is repeated outside review.constants.ts', () => {
    const textList = Object.values(REVIEW_PLACEHOLDER_TEXT).flatMap((byTab) => Object.values(byTab).flatMap(({ title, detail }) => [title, detail]))
    for (const file of changed) {
      // Comments may quote a text; only code counts.
      const source = readFileSync(resolve(root, file), 'utf8').replace(/^\s*\/\/.*$/gm, '')
      for (const text of textList) expect(source, `${file} repeats "${text}"`).not.toContain(text)
    }
  })

  it('D5 fixed: the placeholder test id suffix is a constant, not a literal in TabPlaceholder', () => {
    const source = readFileSync(resolve(root, 'components/TabPlaceholder.tsx'), 'utf8')
    expect(source).not.toMatch(/-placeholder`/)
  })
})
