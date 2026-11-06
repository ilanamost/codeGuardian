import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { REVIEW_TEXT } from '../../src/lib/review.constants'
import type { Finding } from '../../src/types'
import { renderWithStoreSettled } from '../utils/renderWithStore'

// QA rounds 2 and 3 (D4, D5): after an upload replaced the reviewed code, the Summary editor marks
// no findings, through tab switches, Regenerate and Save, until a new Run review.
// CodeEditor is replaced by a stub that records the `finding` it gets and can load a file.
const editorFinding = vi.hoisted(() => [] as (Finding[] | undefined)[])

vi.mock('../../src/components/CodeEditor', () => ({
  default: ({
    value,
    readOnly = true,
    finding,
    onFileLoad
  }: {
    value: string
    readOnly?: boolean
    finding?: Finding[]
    onFileLoad?: (file: { fileName: string; content: string; language: string }) => void
  }) => {
    if (!readOnly) editorFinding.push(finding)
    return (
      <div data-testid={readOnly ? 'readonly-editor' : 'summary-editor'}>
        {value}
        {onFileLoad && (
          <button type="button" onClick={() => onFileLoad({ fileName: 'clean.py', content: 'x = 1\n', language: 'Python' })}>
            stub upload
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

describe('Stale findings after an upload', () => {
  it('marks the review findings until a file replaces the code', async () => {
    const user = userEvent.setup()
    await renderWithStoreSettled(<App />, { route: '/review/r1' })
    expect(lastFinding()?.length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'stub upload' }))

    expect(lastFinding()).toEqual([])
    // Key issues still list the review's findings.
    expect(screen.getByRole('button', { name: REVIEW_TEXT.viewAllFindings })).toBeInTheDocument()
  })

  it('stays cleared after a tab switch, Regenerate and Save review', async () => {
    const user = userEvent.setup()
    await renderWithStoreSettled(<App />, { route: '/review/r1' })
    await user.click(screen.getByRole('button', { name: 'stub upload' }))

    await user.click(screen.getByRole('tab', { name: /Generated tests/ }))
    await user.click(screen.getByRole('button', { name: REVIEW_TEXT.regenerate }))
    await waitFor(() => expect(screen.getByRole('button', { name: REVIEW_TEXT.regenerate })).toBeEnabled())
    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(screen.getByTestId('summary-editor')).toHaveTextContent('x = 1')
    expect(lastFinding()).toEqual([])

    await user.click(screen.getByRole('button', { name: REVIEW_TEXT.saveButton }))
    await waitFor(() => expect(screen.getByRole('button', { name: REVIEW_TEXT.saveButton })).toBeEnabled())
    expect(lastFinding()).toEqual([])
  })
})
