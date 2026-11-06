import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import ReviewTabs from '../../src/components/ReviewTabs'
import { EDITOR_THEME_ID } from '../../src/lib/editorHighlight'
import { AppError } from '../../src/models/app-error'
import { ERROR_CODE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { generatedTestFileList, sampleReview } from '../utils/sampleData'
import { renderWithStore } from '../utils/renderWithStore'

const monacoProps = vi.fn()

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value: string; language: string; theme: string }) => {
    monacoProps(props)
    return <div data-testid="monaco">{props.value}</div>
  }
}))

const [first, second] = generatedTestFileList
let writeText: ReturnType<typeof vi.fn>

function lastEditorProps() {
  return monacoProps.mock.calls.at(-1)?.[0] as { value: string; language: string; theme: string }
}

async function renderTab() {
  const user = userEvent.setup()
  // user-event installs its own clipboard on setup, so stub after it
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderWithStore(
    <>
      <ReviewTabs reviewId="r1" review={sampleReview} code={sampleReview.content} onCodeChange={() => {}} language="TypeScript" languageList={['TypeScript']} onLanguageChange={() => {}} />
      <Toaster />
    </>
  )
  await user.click(screen.getByRole('tab', { name: /Generated tests/ }))
  return user
}

beforeEach(() => {
  monacoProps.mockClear()
  writeText = vi.fn().mockResolvedValue(undefined)
})

describe('Generated tests tab', () => {
  it('shows the file count from the data in the tab label', () => {
    renderWithStore(
      <ReviewTabs reviewId="r1" review={sampleReview} code={sampleReview.content} onCodeChange={() => {}} language="TypeScript" languageList={['TypeScript']} onLanguageChange={() => {}} />
    )

    expect(screen.getByRole('tab', { name: `Generated tests (${generatedTestFileList.length})` })).toBeInTheDocument()
  })

  it('offers Jest, Vitest and Mocha in the framework dropdown', async () => {
    await renderTab()

    const options = within(screen.getByRole('combobox', { name: 'Framework' })).getAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual(['Jest', 'Vitest', 'Mocha'])
  })

  it('lets several test types be checked and unchecked', async () => {
    const user = await renderTab()
    const unit = screen.getByRole('checkbox', { name: 'Unit Tests' })
    const edge = screen.getByRole('checkbox', { name: 'Edge Cases' })

    expect(unit).toBeChecked()
    await user.click(unit)
    await user.click(edge)

    expect(unit).not.toBeChecked()
    expect(edge).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Error Cases' })).toBeChecked()
  })

  it('lists source files in bold with the language below', async () => {
    await renderTab()

    const list = screen.getByRole('list', { name: 'Tests generated for' })

    expect(within(list).getByText(first.sourceFile)).toHaveClass('font-bold')
    expect(within(list).getAllByText('TypeScript')).toHaveLength(2)
  })

  it('passes the active test file to the editor with the shared editor theme', async () => {
    await renderTab()

    expect(lastEditorProps()).toMatchObject({ value: first.code, language: 'typescript', theme: EDITOR_THEME_ID })
    expect(screen.getByRole('heading', { name: first.testFile })).toBeInTheDocument()
  })

  it('switches the editor content and header when a file is clicked', async () => {
    const user = await renderTab()

    await user.click(screen.getByRole('button', { name: new RegExp(second.sourceFile) }))

    expect(lastEditorProps().value).toBe(second.code)
    expect(screen.getByRole('heading', { name: second.testFile })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(second.sourceFile) })).toHaveAttribute('aria-pressed', 'true')
  })

  it('copies the shown tests and toasts', async () => {
    const user = await renderTab()

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(first.code)
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
  })

  it('shows an error toast when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = await renderTab()

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByText('Could not copy to clipboard')).toBeInTheDocument()
  })

  it('copies all files separated by a header per file', async () => {
    const user = await renderTab()

    await user.click(screen.getByRole('button', { name: 'Copy all test files' }))

    expect(writeText).toHaveBeenCalledWith(
      `// ---- ${first.testFile} ----\n${first.code}\n// ---- ${second.testFile} ----\n${second.code}`
    )
  })

})

// Regenerate goes through the store: POST /api/review/{id}/generated-test, then the returned
// files replace the review's, so the editor shows the new code.
describe('Generated tests Regenerate', () => {
  async function openReview(services = createFakeServices().services) {
    const user = userEvent.setup()
    const result = renderWithStore(<App />, { route: '/review/r1', services })
    await user.click(await screen.findByRole('tab', { name: /Generated tests/ }))
    return { user, ...result }
  }

  it('shows loading, then the regenerated code and a toast', async () => {
    const { services } = createFakeServices()
    let finish: () => void = () => {}
    const regenerated = generatedTestFileList.map((file) => ({ ...file, code: file.altCode, altCode: file.code }))
    services.review.regenerateTest.mockImplementation(() => new Promise((resolve) => (finish = () => resolve(regenerated))))
    const { user, store } = await openReview(services)

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))

    // Plan 034: an unchanged choice sends no body (the server uses the stored configuration).
    expect(services.review.regenerateTest).toHaveBeenCalledWith('r1', undefined)
    expect(screen.getByRole('button', { name: 'Regenerating...' })).toBeDisabled()
    expect(lastEditorProps().value).toBe(first.code)
    finish()

    expect(await screen.findByText('Tests regenerated')).toBeInTheDocument()
    expect(lastEditorProps().value).toBe(first.altCode)
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    expect(store.getState().review.current?.review?.generatedTest).toEqual(regenerated)
  })

  it('regenerates on the fake backend and a second click brings the first code back', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/review/r1' })
    await user.click(await screen.findByRole('tab', { name: /Generated tests/ }))

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await vi.waitFor(() => expect(lastEditorProps().value).toBe(first.altCode))
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))

    await vi.waitFor(() => expect(lastEditorProps().value).toBe(first.code))
  })

  it('keeps the code and shows one error toast when regenerating fails', async () => {
    const { services, toast } = createFakeServices()
    services.review.regenerateTest.mockRejectedValue(
      AppError.fromResponse(409, { error: { code: 'conflict', message: 'not completed' } })
    )
    const { user } = await openReview(services)

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toMatch(/^Could not regenerate the tests\./)
    expect(lastEditorProps().value).toBe(first.code)
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    expect(screen.queryByText('Tests regenerated')).not.toBeInTheDocument()
    expect(ERROR_CODE.testRegenerate).toBe('test_regenerate')
  })
})
