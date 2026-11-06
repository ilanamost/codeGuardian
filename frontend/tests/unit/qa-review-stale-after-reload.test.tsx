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

// QA, plan 025: tries to break the stale flag after a reload, its recomputation when a new
// analysis arrives (the frontend agent's deviation), and the Run again hint.
// CodeEditor is a stub: a textarea that records the `finding` it gets, plus a stub upload button.
const editorFinding = vi.hoisted(() => [] as (Finding[] | undefined)[])
const UPLOAD_CODE = vi.hoisted(() => 'uploaded = 1\n')

vi.mock('../../src/components/CodeEditor', () => ({
  default: ({
    value,
    readOnly = true,
    finding,
    onChange,
    onFileLoad,
    onLanguageChange
  }: {
    value: string
    readOnly?: boolean
    finding?: Finding[]
    onChange?: (value: string) => void
    onFileLoad?: (file: { fileName: string; content: string; language: string }) => void
    onLanguageChange?: (language: string) => void
  }) => {
    if (!readOnly) editorFinding.push(finding)
    if (readOnly) return <div data-testid="readonly-editor">{value}</div>
    return (
      <div>
        <textarea data-testid="summary-editor" value={value} onChange={(event) => onChange?.(event.target.value)} />
        {onFileLoad && (
          <button type="button" onClick={() => onFileLoad({ fileName: 'u.py', content: UPLOAD_CODE, language: 'Python' })}>
            stub upload
          </button>
        )}
        {onLanguageChange && (
          <button type="button" onClick={() => onLanguageChange('Go')}>
            stub language
          </button>
        )}
      </div>
    )
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
const saveButton = () => screen.getByRole('button', { name: REVIEW_TEXT.saveButton })
const hint = () => screen.queryByText(REVIEW_TEXT.runAgainHint)
const editor = () => screen.getByTestId('summary-editor')

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

describe('QA: plain typed edits keep markers (plan 021 behavior unchanged)', () => {
  it('an unsaved typed edit keeps the markers', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review()))
    expect(lastFinding()?.length).toBeGreaterThan(0)

    await user.type(editor(), '// typed')

    expect(lastFinding()?.length).toBeGreaterThan(0)
    expect(runButton()).toBeEnabled()
  })

  it('a typed edit then Save review (no reload) keeps the markers in this session', async () => {
    const user = userEvent.setup()
    const { services } = await openWith(detailOf('r1', review()))
    await user.type(editor(), '// typed')
    await user.click(saveButton())
    await waitFor(() => expect(services.review.save).toHaveBeenCalled())
    await waitFor(() => expect(saveButton()).toBeEnabled())

    expect(lastFinding()?.length).toBeGreaterThan(0)
  })
})

describe('QA: whitespace and CR LF only saved differences keep markers', () => {
  it.each([
    ['CR LF line breaks', sampleReview.content.replace(/\n/g, '\r\n')],
    ['leading and trailing blank lines', `\n\n${sampleReview.content}\n\n\n`],
    ['trailing spaces and tabs at the end', `${sampleReview.content} \t `],
    ['CR LF plus surrounding whitespace', `  \r\n${sampleReview.content.replace(/\n/g, '\r\n')}\r\n  `]
  ])('%s', async (_label, code) => {
    await openWith(detailOf('r1', review(), savedEdit({ code })))
    expect(lastFinding()?.length).toBeGreaterThan(0)
    expect(runButton()).toBeDisabled()
  })

  it('a real inner change after a whitespace-only prefix is stale', async () => {
    await openWith(detailOf('r1', review(), savedEdit({ code: `\n${sampleReview.content}// x\n` })))
    expect(lastFinding()).toEqual([])
    expect(runButton()).toBeEnabled()
  })
})

describe('QA: stale flag recomputed when a new analysis arrives (deviation)', () => {
  it('reload during a run: hidden while pending, markers return when the run completes, no reload', async () => {
    const NEW_CODE = 'y = 2\n'
    const saved = savedEdit({ code: NEW_CODE })
    const { services } = createFakeServices()
    // The reload lands while the run is pending: the old analysis is still the analyzed code.
    services.review.get.mockResolvedValueOnce({
      ...detailOf('r1', review({ status: 'pending', finding: [] }), saved),
      analyzedContent: sampleReview.content,
      analyzedLanguage: sampleReview.language
    })
    // The run finishes: the saved code is now the analyzed code, with findings.
    services.review.get.mockResolvedValue(detailOf('r1', review({ content: NEW_CODE }), saved))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })

    await waitFor(() => expect(screen.getByText('Completed', { exact: true })).toBeInTheDocument(), { timeout: 6000 })
    await waitFor(() => expect(lastFinding()?.length).toBeGreaterThan(0))
    expect(runButton()).toBeDisabled()
  })

  it('an upload while a run is pending stays stale after the run completes', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    services.review.get.mockResolvedValueOnce(detailOf('r1', review()))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })
    await user.type(editor(), '// typed')
    // The run analyzes the typed code; the next GET returns it completed.
    const typed = `${sampleReview.content}// typed`
    services.review.get.mockResolvedValue(detailOf('r1', review({ content: typed }), savedEdit({ code: typed })))
    await user.click(runButton())
    await waitFor(() => expect(services.review.run).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'stub upload' }))
    expect(lastFinding()).toEqual([])

    await waitFor(() => expect(screen.getByText('Completed', { exact: true })).toBeInTheDocument(), { timeout: 6000 })
    expect(editor()).toHaveValue(UPLOAD_CODE)
    expect(lastFinding()).toEqual([])
  })

  it('a poll that returns the same analysis does not clear the stale flag', async () => {
    const saved = savedEdit({ code: 'z = 3\n' })
    const { services } = createFakeServices()
    // Every poll answers pending with the same (old) analysis and its findings.
    services.review.get.mockImplementation(async () => detailOf('r1', review({ status: 'pending' }), saved))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })
    expect(lastFinding()).toEqual([])
    await waitFor(() => expect(services.review.get.mock.calls.length).toBeGreaterThan(1), { timeout: 6000 })
    expect(lastFinding()).toEqual([])
  })
})

describe('QA: reverting a stale saved edit (documents current behavior, see QA finding)', () => {
  it('typing the analyzed code back keeps the markers hidden while Run review becomes disabled', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review(), savedEdit({ code: `${sampleReview.content}q` })))
    expect(lastFinding()).toEqual([])
    expect(runButton()).toBeEnabled()

    await user.type(editor(), '{Backspace}')

    expect(editor()).toHaveValue(sampleReview.content)
    // Dead end: the editor shows the analyzed code, yet no markers, and Run review cannot refresh them.
    expect(lastFinding()).toEqual([])
    expect(runButton()).toBeDisabled()
  })
})

describe('QA: Run again hint edge cases', () => {
  it('a language-only change on a failed review hides the hint and enables Run review', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review({ status: 'failed' })))
    expect(hint()).toBeInTheDocument()
    expect(sampleReview.language).not.toBe('Go')
    await user.click(screen.getByRole('button', { name: 'stub language' }))
    expect(hint()).not.toBeInTheDocument()
    expect(runButton()).toBeEnabled()
  })

  it('an upload on a cancelled review hides the hint', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review({ status: 'cancelled' })))
    expect(hint()).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'stub upload' }))
    expect(hint()).not.toBeInTheDocument()
    expect(runButton()).toBeEnabled()
  })

  it('a whitespace-only edit on a failed review keeps the hint and Run review disabled', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review({ status: 'failed' })))
    await user.type(editor(), '   {Enter}{Enter}')
    expect(hint()).toBeInTheDocument()
    expect(runButton()).toBeDisabled()
  })

  it('typing an edit and reverting it brings the hint back', async () => {
    const user = userEvent.setup()
    await openWith(detailOf('r1', review({ status: 'failed' })))
    await user.type(editor(), 'q')
    expect(hint()).not.toBeInTheDocument()
    await user.type(editor(), '{Backspace}')
    expect(hint()).toBeInTheDocument()
    expect(runButton()).toBeDisabled()
  })

  it.each(['pending', 'queued', 'in_progress', 'completed'] as const)('no hint on a %s review', async (status) => {
    await openWith(detailOf('r1', review({ status })))
    expect(hint()).not.toBeInTheDocument()
  })

  it('rapid double click on Run review after an edit on a failed review runs once', async () => {
    const user = userEvent.setup()
    const { services } = await openWith(detailOf('r1', review({ status: 'failed' })))
    await user.type(editor(), '// edit')
    await user.dblClick(runButton())
    await waitFor(() => expect(services.review.run).toHaveBeenCalled())
    expect(services.review.run).toHaveBeenCalledTimes(1)
  })
})
