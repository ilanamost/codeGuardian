import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { downloadReportPdf } from '../../src/lib/reportPdf'
import { readSavedReview } from '../utils/reviewStorage'
import { fixtureData } from '../utils/fixtureData'
import { renderWithStoreSettled } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language, onChange }: { value: string; language: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco"
      data-language={language}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  )
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('../../src/lib/reportPdf', () => ({ downloadReportPdf: vi.fn().mockResolvedValue(undefined) }))

function renderReview(path = '/review/r1') {
  return renderWithStoreSettled(<App />, { route: path })
}

// An existing review: /review/new is blank until it is saved (tests/unit/NewReview.test.tsx).
const r1 = fixtureData.reviewById.r1

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Save review', () => {
  it('stores the edited code and shows the toast', async () => {
    const user = userEvent.setup()
    await renderReview()

    await user.type(screen.getByTestId('monaco'), '// edit')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(readSavedReview('r1')?.code).toContain('// edit')
    expect(toast.success).toHaveBeenCalledWith('Review saved')
    expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled()
  })

  it('saves again and toasts again on a second click', async () => {
    const user = userEvent.setup()
    await renderReview()

    await user.click(screen.getByRole('button', { name: 'Save review' }))
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(toast.success).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled()
  })

  it('restores the saved code when the review is opened again', async () => {
    const user = userEvent.setup()
    const first = await renderReview()
    await user.type(screen.getByTestId('monaco'), '// restored')
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    first.unmount()

    await renderReview()

    expect(screen.getByTestId('monaco')).toHaveValue(r1.content + '// restored')
  })

  it('shows an error toast and does not throw when storage is blocked', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await renderReview()

    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(toast.error).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled()
  })
})

// Plan 021 revision 1: on an existing review Run review is the primary action and Save review the
// secondary one.
describe('Run review and Save review button style', () => {
  it('Run review uses the darker primary tokens with white text and a hover state', async () => {
    await renderReview()

    expect(screen.getByRole('button', { name: 'Run review' })).toHaveClass('bg-primary-dark', 'text-white', 'hover:bg-primary-darker')
  })

  it('Save review is the secondary (outlined) button', async () => {
    await renderReview()

    const save = screen.getByRole('button', { name: 'Save review' })
    expect(save).toHaveClass('border-border', 'bg-card')
    expect(save).not.toHaveClass('bg-primary-dark')
  })
})

describe('Review name', () => {
  async function startEdit() {
    const user = userEvent.setup()
    await renderReview()
    await user.click(screen.getByRole('button', { name: 'Edit review name' }))
    return { user, input: screen.getByRole('textbox', { name: 'Review name' }) }
  }

  it('shows the default name with a pencil button', async () => {
    await renderReview()

    expect(screen.getByTestId('review-name')).toHaveTextContent(r1.title)
  })

  it('keeps the full name in a title attribute and truncates it visually', async () => {
    await renderReview()

    expect(screen.getByTestId('review-name')).toHaveAttribute('title', r1.title)
    expect(screen.getByTestId('review-name')).toHaveClass('truncate')
  })

  it('commits a trimmed name on Enter', async () => {
    const { user, input } = await startEdit()

    await user.clear(input)
    await user.type(input, '  My service  {Enter}')

    expect(screen.getByTestId('review-name')).toHaveTextContent('My service')
  })

  it('commits the name on blur', async () => {
    const { user, input } = await startEdit()

    await user.clear(input)
    await user.type(input, 'Blur name')
    await user.tab()

    expect(screen.getByTestId('review-name')).toHaveTextContent('Blur name')
  })

  it('cancels on Escape', async () => {
    const { user, input } = await startEdit()

    await user.clear(input)
    await user.type(input, 'Dropped{Escape}')

    expect(screen.getByTestId('review-name')).toHaveTextContent(r1.title)
  })

  it('keeps the previous name when the new name is empty', async () => {
    const { user, input } = await startEdit()

    await user.clear(input)
    await user.type(input, '   {Enter}')

    expect(screen.getByTestId('review-name')).toHaveTextContent(r1.title)
  })

  it('limits the name to 80 characters', async () => {
    const { input } = await startEdit()

    expect(input).toHaveAttribute('maxlength', '80')
  })

  it('persists the name on Save and restores it when reopened', async () => {
    const { user, input } = await startEdit()
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(readSavedReview('r1')?.name).toBe('Renamed')
  })

  it('uses the name as the PDF title', async () => {
    const { user, input } = await startEdit()
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')

    await user.click(screen.getByRole('button', { name: 'Download report' }))

    expect(downloadReportPdf).toHaveBeenCalledWith('r1', { ...r1, title: 'Renamed' }, 'TypeScript')
  })
})

describe('Download report', () => {
  it('calls the PDF helper with the review id and language', async () => {
    const user = userEvent.setup()
    await renderReview()

    await user.click(screen.getByRole('button', { name: 'Download report' }))

    expect(downloadReportPdf).toHaveBeenCalledWith('r1', r1, 'TypeScript')
  })

  it('shows an error toast when the PDF cannot be created', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadReportPdf).mockRejectedValueOnce(new Error('boom'))
    await renderReview()

    await user.click(screen.getByRole('button', { name: 'Download report' }))

    expect(toast.error).toHaveBeenCalled()
  })
})

describe('View all findings', () => {
  it('switches to the Findings tab and lists every finding', async () => {
    const user = userEvent.setup()
    await renderReview()

    await user.click(screen.getByRole('button', { name: 'View all findings' }))

    expect(screen.getByRole('tab', { name: /^Findings/ })).toHaveAttribute('aria-selected', 'true')
    r1.finding.forEach((item) => expect(screen.getByText(item.message)).toBeInTheDocument())
  })

  it('has a hover style', async () => {
    await renderReview()

    expect(screen.getByRole('button', { name: 'View all findings' })).toHaveClass(
      'hover:text-primary-hover',
      'hover:underline'
    )
  })
})

describe('Scrollbars', () => {
  it('does not scroll the tab row at lg and hides its bar below', async () => {
    await renderReview()

    expect(screen.getByRole('tablist')).toHaveClass('lg:overflow-visible', 'hide-bar')
  })
})
