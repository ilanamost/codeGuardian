import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { canRunReview, hasUnanalyzedChange, isSavedFindingStale, needsChangeToRunAgain, type RunReviewInput } from '../../src/lib/reviewRun'
import { EDITOR_TEXT, REVIEW_LIMIT, REVIEW_TEXT } from '../../src/lib/review.constants'
import { AppError } from '../../src/models/app-error'
import { unfinishedStatusList } from '../../src/models/review.model'
import { ERROR_CODE, ERROR_MESSAGE, ERROR_HINT } from '../../src/utils/error-messages'
import { createFakeServices, detailOf } from '../utils/fakeServices'
import { sampleReview } from '../utils/sampleData'
import { renderWithStoreSettled } from '../utils/renderWithStore'

// Plan 021 revision 1 (AI-41): Run review on an existing review re-analyzes it in place, enabled
// only when the code or language differs from what was last analyzed.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language, onChange }: { value: string; language: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" data-language={language} value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

const base: RunReviewInput = {
  code: 'const a = 1\n',
  language: 'TypeScript',
  analyzedContent: 'const a = 1\n',
  analyzedLanguage: 'TypeScript',
  status: 'completed',
  busy: false
}

describe('canRunReview', () => {
  it('is disabled while the code and language are what was analyzed', () => {
    expect(canRunReview(base)).toBe(false)
  })

  it('is enabled after a code change (typing, paste or upload) or a language change', () => {
    expect(canRunReview({ ...base, code: 'const a = 2\n' })).toBe(true)
    expect(canRunReview({ ...base, language: 'JavaScript' })).toBe(true)
  })

  it('ignores whitespace at the ends and CR LF line breaks, and is disabled again after a revert', () => {
    expect(canRunReview({ ...base, code: '  const a = 1\n\n' })).toBe(false)
    expect(canRunReview({ ...base, code: 'const a = 1\r\n', analyzedContent: 'const a = 1\n' })).toBe(false)
    expect(hasUnanalyzedChange({ ...base, code: 'const a = 1 ' })).toBe(false)
    expect(hasUnanalyzedChange({ ...base, code: 'const  a = 1' })).toBe(true)
  })

  it.each(unfinishedStatusList)('is disabled while the review is %s', (status) => {
    expect(canRunReview({ ...base, code: 'changed', status })).toBe(false)
  })

  it('is enabled for a failed or cancelled review with a change', () => {
    expect(canRunReview({ ...base, code: 'changed', status: 'failed' })).toBe(true)
    expect(canRunReview({ ...base, code: 'changed', status: 'cancelled' })).toBe(true)
  })

  // Plan 025, decision 1: a failed review is not run again without an edit or an upload.
  it('is disabled for a failed or cancelled review with unchanged code and language', () => {
    expect(canRunReview({ ...base, status: 'failed' })).toBe(false)
    expect(canRunReview({ ...base, status: 'cancelled' })).toBe(false)
    expect(canRunReview({ ...base, status: 'failed', language: 'Go' })).toBe(true)
    expect(canRunReview({ ...base, status: 'cancelled', language: 'Go' })).toBe(true)
  })

  it('is disabled for empty or too long code, and while saving or running', () => {
    expect(canRunReview({ ...base, code: '   ' })).toBe(false)
    expect(canRunReview({ ...base, code: 'a'.repeat(REVIEW_LIMIT.contentMax + 1) })).toBe(false)
    expect(canRunReview({ ...base, code: 'changed', busy: true })).toBe(false)
  })
})

describe('needsChangeToRunAgain', () => {
  it('is true only for a failed or cancelled review with no change', () => {
    expect(needsChangeToRunAgain({ ...base, status: 'failed' })).toBe(true)
    expect(needsChangeToRunAgain({ ...base, status: 'cancelled' })).toBe(true)
    expect(needsChangeToRunAgain({ ...base, status: 'failed', code: 'changed' })).toBe(false)
    expect(needsChangeToRunAgain({ ...base, status: 'cancelled', language: 'Go' })).toBe(false)
    expect(needsChangeToRunAgain(base)).toBe(false)
    expect(needsChangeToRunAgain({ ...base, status: 'pending' })).toBe(false)
  })
})

describe('isSavedFindingStale', () => {
  const analyzed = { analyzedContent: base.analyzedContent, analyzedLanguage: base.analyzedLanguage }

  it('is false without a saved edit, or when it matches the analyzed code (whitespace and CR LF aside)', () => {
    expect(isSavedFindingStale(null, analyzed)).toBe(false)
    expect(isSavedFindingStale({ code: 'const a = 1\r\n ', language: 'TypeScript' }, analyzed)).toBe(false)
  })

  it('is true when the saved code or language differs', () => {
    expect(isSavedFindingStale({ code: 'const a = 2\n', language: 'TypeScript' }, analyzed)).toBe(true)
    expect(isSavedFindingStale({ code: base.code, language: 'Go' }, analyzed)).toBe(true)
  })
})

const runButton = () => screen.getByRole('button', { name: REVIEW_TEXT.runButton })
const saveButton = () => screen.getByRole('button', { name: REVIEW_TEXT.saveButton })
const editor = () => screen.getByTestId('monaco')

describe('Run review on an existing review (fake backend)', () => {
  it('shows Run review next to Save review, disabled until the code or language changes', async () => {
    const user = userEvent.setup()
    await renderWithStoreSettled(<App />, { route: '/review/r1' })
    expect(runButton()).toBeDisabled()
    expect(saveButton()).toBeEnabled()

    await user.type(editor(), 'x')
    expect(runButton()).toBeEnabled()

    await user.type(editor(), '{Backspace}')
    expect(runButton()).toBeDisabled()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Go')
    expect(runButton()).toBeEnabled()
  })

  it('is enabled after a paste and after an upload', async () => {
    const user = userEvent.setup()
    await renderWithStoreSettled(<App />, { route: '/review/r1' })

    await user.click(editor())
    await user.paste('// pasted')
    expect(runButton()).toBeEnabled()

    await user.upload(screen.getByLabelText(EDITOR_TEXT.fileInput), new File(['print(1)\n'], 'main.py'))
    await waitFor(() => expect(editor()).toHaveValue('print(1)\n'))
    expect(runButton()).toBeEnabled()
  })

  it('re-analyzes in place: the started toast, pending, then completed with the same id', async () => {
    const user = userEvent.setup()
    const { store } = await renderWithStoreSettled(<App />, { route: '/review/r1' })

    await user.upload(screen.getByLabelText(EDITOR_TEXT.fileInput), new File(['package main\n'], 'main.go'))
    await waitFor(() => expect(runButton()).toBeEnabled())
    await user.click(runButton())

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(REVIEW_TEXT.started))
    expect(store.getState().review.current).toMatchObject({ id: 'r1', analyzedContent: 'package main\n', analyzedLanguage: 'Go' })
    expect(await screen.findByText('Completed', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(store.getState().review.current?.id).toBe('r1')
    expect(store.getState().review.current?.review?.finding.length).toBeGreaterThan(0)
    // The code is now what was analyzed.
    expect(runButton()).toBeDisabled()
    expect(editor()).toHaveValue('package main\n')
  })

  it('a Save keeps Run review enabled, because a save does not analyze', async () => {
    const user = userEvent.setup()
    await renderWithStoreSettled(<App />, { route: '/review/r1' })

    await user.type(editor(), '// edit')
    await user.click(saveButton())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(REVIEW_TEXT.saved))
    expect(runButton()).toBeEnabled()
  })

  it('a saved but not analyzed edit opens with Run review enabled', async () => {
    const user = userEvent.setup()
    const first = await renderWithStoreSettled(<App />, { route: '/review/r1' })
    await user.type(editor(), '// edit')
    await user.click(saveButton())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(REVIEW_TEXT.saved))
    first.unmount()

    // A new page load: the saved edit is the editor code, the findings still belong to the old code.
    await renderWithStoreSettled(<App />, { route: '/review/r1' })
    expect((editor() as HTMLTextAreaElement).value).toContain('// edit')
    expect(runButton()).toBeEnabled()
  })

  it('is disabled for an unfinished review', async () => {
    await renderWithStoreSettled(<App />, { route: '/review/r7' })
    expect(runButton()).toBeDisabled()
  })

  it('keeps a single Run review button (and no Save review) on /review/new', async () => {
    await renderWithStoreSettled(<App />, { route: '/review/new' })
    expect(screen.getAllByRole('button', { name: REVIEW_TEXT.runButton })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: REVIEW_TEXT.saveButton })).not.toBeInTheDocument()
  })
})

describe('Run review with fake services', () => {
  it('sends the edit to review.run and polls the review until it finishes', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })
    services.review.get.mockClear()

    await user.clear(editor())
    await user.type(editor(), 'const changed = 1')
    await user.click(runButton())

    await waitFor(() => expect(services.review.run).toHaveBeenCalledWith('r1', { name: sampleReview.title, language: 'TypeScript', code: 'const changed = 1' }))
    await waitFor(() => expect(services.review.get).toHaveBeenCalledWith('r1', expect.anything()), { timeout: 4000 })
  })

  it('reports a failed run with the review_run error toast and keeps the code', async () => {
    const user = userEvent.setup()
    const { services, toast: serviceToast } = createFakeServices()
    services.review.run.mockRejectedValueOnce(new AppError({ code: ERROR_CODE.server, kind: 'http', status: 500 }))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })

    await user.type(editor(), 'x')
    await user.click(runButton())

    await waitFor(() => expect(serviceToast.error).toHaveBeenCalledWith(`${ERROR_MESSAGE.reviewRun} ${ERROR_HINT.server}`))
    expect(toast.success).not.toHaveBeenCalledWith(REVIEW_TEXT.started)
    expect((editor() as HTMLTextAreaElement).value).toContain('x')
    expect(runButton()).toBeEnabled()
  })

  it('a 409 from the API (the review became unfinished) is reported', async () => {
    const user = userEvent.setup()
    const { services, toast: serviceToast } = createFakeServices()
    services.review.run.mockRejectedValueOnce(AppError.fromResponse(409, { error: { code: 'conflict', message: 'unfinished' } }))
    services.review.get.mockResolvedValue(detailOf('r1', structuredClone(sampleReview)))
    await renderWithStoreSettled(<App />, { route: '/review/r1', services })

    await user.type(editor(), 'x')
    await user.click(runButton())

    await waitFor(() => expect(serviceToast.error).toHaveBeenCalledWith(`${ERROR_MESSAGE.reviewRun} ${ERROR_HINT.conflict}`))
  })
})
