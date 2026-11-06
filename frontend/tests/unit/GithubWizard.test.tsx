import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/components/Sidebar'
import GithubWizardPage from '../../src/pages/GithubWizardPage'
import App from '../../src/App'
import { AppError } from '../../src/models/app-error'
import { fixtureData } from '../utils/fixtureData'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco" data-language={language}>
      {value}
    </div>
  )
}))

function renderApp(services?: ReturnType<typeof createFakeServices>['services']) {
  return renderWithStore(<App />, { route: '/github', services })
}

function renderPage() {
  return renderWithStore(
    <>
      <GithubWizardPage />
      <Toaster />
    </>
  )
}

// Plan 030: Connect asks for the GitHub user name (the fixture account is john-doe).
async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'GitHub user name' }), fixtureData.githubAccount.login)
  await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
}

async function goToFileStep(user: ReturnType<typeof userEvent.setup>) {
  await connect(user)
  await user.click(screen.getByRole('radio', { name: 'backend-api' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
}

describe('GitHub Integration wizard', () => {
  it('starts disconnected with the repository list hidden', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Select Repository' })).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Repositories' })).not.toBeInTheDocument()
  })

  // Plan 030: the account's user name and display name (contract 0.9.0 has no email).
  it('connects the account with its user name and shows its user name', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('textbox', { name: 'GitHub user name' })).toBeInTheDocument()
    await connect(user)

    expect(screen.getByText('Connected as john-doe')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('returns to the connect state on switch account', async () => {
    const user = userEvent.setup()
    renderPage()
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Switch account' }))

    expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument()
  })

  it('asks the server to disconnect on switch account', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderApp(services)
    await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('button', { name: 'Switch account' }))

    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    expect(services.github.disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the account and shows one error toast when switching fails', async () => {
    const user = userEvent.setup()
    const { services, toast } = createFakeServices()
    services.github.disconnect.mockRejectedValue(AppError.fromResponse(500, { error: { code: 'internal_error', message: 'x' } }))
    renderApp(services)
    await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('button', { name: 'Switch account' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toMatch(/^Could not switch the GitHub account\./)
    expect(screen.getByText(/^Connected as /)).toBeInTheDocument()
  })

  it('filters repositories by name', async () => {
    const user = userEvent.setup()
    renderPage()
    await connect(user)
    await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'API')

    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'backend-api' })).toBeInTheDocument()
  })

  it('shows an empty state when no repository matches', async () => {
    const user = userEvent.setup()
    renderPage()
    await connect(user)
    await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'zzz')

    expect(screen.getByText('No repositories match')).toBeInTheDocument()
  })

  it('disables Next until a repository is selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await connect(user)

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'mobile-app' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('goes to the file step with the chosen repository', async () => {
    const user = userEvent.setup()
    renderPage()
    await goToFileStep(user)

    expect(screen.getByRole('heading', { name: 'Select File' })).toBeInTheDocument()
    expect(screen.getByText('backend-api')).toBeInTheDocument()
    expect(screen.getByText('Select file').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('enables Approve once a file is selected', async () => {
    const user = userEvent.setup()
    renderPage()
    await goToFileStep(user)

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('resets to the first step on Cancel', async () => {
    const user = userEvent.setup()
    renderPage()
    await goToFileStep(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('heading', { name: 'Select Repository' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('imports the file on Approve and opens it as a new review in the editor', async () => {
    const user = userEvent.setup()
    renderApp()
    await goToFileStep(user)
    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Imported src/server.ts from backend-api')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Review Results' })).toBeInTheDocument()
    expect(screen.getByTestId('review-name')).toHaveTextContent('src/server.ts')
    expect(screen.getByTestId('monaco')).toHaveTextContent(fixtureData.githubFileContentById['be-1'].split('\n')[0])
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'typescript')
    expect(screen.getByRole('button', { name: 'Run review' })).toBeEnabled()
  })

  it('stays on the file step with one error toast when the import fails', async () => {
    const user = userEvent.setup()
    const { services, toast } = createFakeServices()
    services.github.listFile.mockResolvedValue({ items: [{ id: 'be-1', path: 'src/server.ts', language: 'TypeScript' }], truncated: false })
    services.github.getFile.mockRejectedValue(AppError.fromResponse(404, { error: { code: 'not_found', message: 'x' } }))
    renderApp(services)
    await user.type(await screen.findByRole('textbox', { name: 'GitHub user name' }), 'john-doe')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('checkbox', { name: 'src/server.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toMatch(/^Could not import the file\./)
    expect(services.github.getFile).toHaveBeenCalledWith('repo', 'be-1')
    expect(screen.getByRole('heading', { name: 'Select File' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })
})

describe('GitHub Integration sidebar link', () => {
  it('links to /github and highlights when active', () => {
    renderWithStore(<Sidebar />, { route: '/github' })

    const link = screen.getByRole('link', { name: 'GitHub Integration' })
    expect(link).toHaveAttribute('href', '/github')
    expect(link).toHaveClass('bg-sidebar-active')
  })

  it('navigates to the wizard page from the sidebar', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/' })
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'GitHub Integration' }))

    expect(screen.getByRole('heading', { name: 'Select Repository' })).toBeInTheDocument()
  })

  it('lets several files be selected and deselected at once', async () => {
    const user = userEvent.setup()
    renderPage()
    await goToFileStep(user)

    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    await user.click(screen.getByRole('checkbox', { name: 'src/routes/user.ts' }))
    expect(screen.getByRole('checkbox', { name: 'src/server.ts' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'src/routes/user.ts' })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    expect(screen.getByRole('checkbox', { name: 'src/server.ts' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'src/routes/user.ts' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it('imports every selected file when several are approved (plan 034)', async () => {
    const user = userEvent.setup()
    renderApp()
    await goToFileStep(user)
    await user.click(screen.getByRole('checkbox', { name: 'scripts/seed.py' }))
    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Imported 2 files from backend-api')).toBeInTheDocument()
    const list = await screen.findByRole('navigation', { name: 'Imported files' })
    expect(within(list).getAllByRole('button')).toHaveLength(2)
    expect(await screen.findByTestId('review-name')).toHaveTextContent('src/server.ts')
  })

  it('describes the page as importing files only', () => {
    renderPage()

    expect(screen.getByText('Connect your GitHub account and import files for review.')).toBeInTheDocument()
  })

  it('lets the user close the import toast with its close button', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/github' })
    await goToFileStep(user)
    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Imported src/server.ts from backend-api')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close toast' })).toBeInTheDocument()
  })

  it('goes back to the previous step from the stepper and keeps the repository', async () => {
    const user = userEvent.setup()
    renderPage()
    await goToFileStep(user)

    expect(screen.queryByRole('button', { name: 'Select file' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select repository' }))

    expect(screen.getByRole('heading', { name: 'Select Repository' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'backend-api' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    expect(screen.getByText('Select repository').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('clears the chosen files when another repository is picked after going back', async () => {
    const user = userEvent.setup()
    renderPage()
    await goToFileStep(user)
    await user.click(screen.getByRole('checkbox', { name: 'src/server.ts' }))
    await user.click(screen.getByRole('button', { name: 'Select repository' }))
    await user.click(screen.getByRole('radio', { name: 'mobile-app' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })
})
