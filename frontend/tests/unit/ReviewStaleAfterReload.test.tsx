import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { REVIEW_TEXT } from '../../src/lib/review.constants'
import type { ReviewDto, SavedReviewDto } from '../../src/models/dto'
import type { Finding } from '../../src/types'
import { createFakeServices, detailOf } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'
import { renderWithStoreSettled } from '../utils/renderWithStore'

// Plan 025: a saved edit that no longer matches the analyzed code is stale from the first render
// (no editor markers), and a failed or cancelled review with no change explains why Run review
// is disabled. CodeEditor is replaced by a stub that records the `finding` it gets.
const editorFinding = vi.hoisted(() => [] as (Finding[] | undefined)[])

vi.mock('../../src/components/CodeEditor', () => ({
  default: ({
    value,
    readOnly = true,
    finding,
    onChange
  }: {
    value: string
    readOnly?: boolean
    finding?: Finding[]
    onChange?: (value: string) => void
  }) => {
    if (!readOnly) editorFinding.push(finding)
    if (readOnly) return <div data-testid="readonly-editor">{value}</div>
    return <textarea data-testid="summary-editor" value={value} onChange={(event) => onChange?.(event.target.value)} />
  }
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

beforeEach(() => {
  window.localStorage.clear()
  editorFinding.length = 0
  vi.clearAllMocks()
})

const lastFinding = () => editorFinding.at(-1)
const runButton = () => screen.getByRole('button', { name: REVIEW_TEXT.runButton })
const hint = () => screen.queryByText(REVIEW_TEXT.runAgainHint)

const NEW_CODE = 'x = 1\n'

function review(patch: Partial<ReviewDto> = {}): ReviewDto {
  return { ...structuredClone(sampleReview), ...patch }
}

function savedEdit(patch: Partial<SavedReviewDto> = {}): SavedReviewDto {
  return { name: sampleReview.title, language: sampleReview.language, code: sampleReview.content, savedAt: 't', ...patch }
}

async function openWith(detail: ReturnType<typeof detailOf>) {
  const { services } = createFakeServices()
  services.review.get.mockResolvedValue(detail)
  const rendered = await renderWithStoreSettled(<App />, { route: '/review/r1', services })
  return { ...rendered, services }
}

describe('Stale findings after Save review and a reload', () => {
  it('marks no line on the first render when the saved code differs from the analyzed code', async () => {
    await openWith(detailOf('r1', review(), savedEdit({ code: NEW_CODE })))

    expect(screen.getByTestId('summary-editor')).toHaveValue(NEW_CODE)
    expect(editorFinding.length).toBeGreaterThan(0)
    expect(editorFinding.every((finding) => finding?.length === 0)).toBe(true)
    expect(runButton()).toBeEnabled()
    // Option 2A: the Summary's Key issues still list the last analysis.
    expect(screen.getByRole('button', { name: REVIEW_TEXT.viewAllFindings })).toBeInTheDocument()
  })

  it('marks no line when only the saved language differs', async () => {
    await openWith(detailOf('r1', review(), savedEdit({ language: 'Go' })))
    expect(lastFinding()).toEqual([])
    expect(runButton()).toBeEnabled()
  })

  it('keeps the markers when the saved code equals the analyzed code (whitespace and CR LF aside)', async () => {
    await openWith(detailOf('r1', review(), savedEdit({ code: `${sampleReview.content.replace(/\n/g, '\r\n')}  ` })))
    expect(lastFinding()?.length).toBeGreaterThan(0)
    expect(runButton()).toBeDisabled()
  })

  it('keeps the markers when there is no saved edit', async () => {
    await openWith(detailOf('r1', review()))
    expect(lastFinding()?.length).toBeGreaterThan(0)
  })

  it('Run review clears the flag: the new findings mark the saved code', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    const saved = savedEdit({ code: NEW_CODE })
    services.review.get.mockResolvedValueOnce(detailOf('r1', review(), saved))
    // After the run: the analysis of the saved code, with findings.
    services.review.get.mockResolvedValue(detailOf('r1', review({ content: NEW_CODE }), saved))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })
    expect(lastFinding()).toEqual([])

    await user.click(runButton())

    await waitFor(() => expect(services.review.run).toHaveBeenCalled())
    await waitFor(() => expect(lastFinding()?.length).toBeGreaterThan(0), { timeout: 4000 })
    expect(runButton()).toBeDisabled()
  })
})

describe('Run again hint on a failed or cancelled review', () => {
  it.each(['failed', 'cancelled'] as const)('a %s review with no change: Run review disabled, hint shown', async (status) => {
    await openWith(detailOf('r1', review({ status })))
    expect(runButton()).toBeDisabled()
    expect(hint()).toBeInTheDocument()
  })

  it('the hint goes away after an edit, which enables Run review', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review({ status: 'failed' })))
    await user.type(screen.getByTestId('summary-editor'), '// edit')
    expect(hint()).not.toBeInTheDocument()
    expect(runButton()).toBeEnabled()
  })

  it('no hint on a failed review whose saved edit was not analyzed (Run review enabled)', async () => {
    await openWith(detailOf('r1', review({ status: 'failed' }), savedEdit({ code: NEW_CODE })))
    expect(hint()).not.toBeInTheDocument()
    expect(runButton()).toBeEnabled()
  })

  it('no hint on a completed review with no change', async () => {
    await openWith(detailOf('r1', review()))
    expect(runButton()).toBeDisabled()
    expect(hint()).not.toBeInTheDocument()
  })

  it('no hint on /review/new', async () => {
    await renderWithStoreSettled(<App />, { route: '/review/new' })
    expect(hint()).not.toBeInTheDocument()
  })
})
