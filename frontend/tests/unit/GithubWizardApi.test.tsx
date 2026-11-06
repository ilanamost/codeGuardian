import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import GithubWizardPage from '../../src/pages/GithubWizardPage'
import { FORM_ERROR_MESSAGE, GITHUB_WIZARD_HINT } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 030: the connect card asks for a GitHub user name.
type Fake = ReturnType<typeof createFakeServices>

function setup(edit?: (services: Fake['services']) => void) {
  const fake = createFakeServices()
  edit?.(fake.services)
  renderWithStore(<GithubWizardPage />, { services: fake.services })
  return { ...fake, user: userEvent.setup() }
}

function usernameField() {
  return screen.getByRole('textbox', { name: 'GitHub user name' })
}

async function connectAs(user: ReturnType<typeof userEvent.setup>, username: string) {
  await user.type(usernameField(), username)
  await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
}

function httpError(status: number, code: string) {
  return AppError.fromResponse(status, { error: { code, message: 'x' } })
}

describe('GitHub wizard connect card (API data source)', () => {
  it('shows the user-name field with the public-only note before connecting', () => {
    setup()

    expect(usernameField()).toHaveValue('')
    expect(usernameField()).toHaveAccessibleDescription('Public repositories only. No GitHub sign-in or token is used.')
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Repositories' })).not.toBeInTheDocument()
  })

  it.each([
    ['', FORM_ERROR_MESSAGE.githubUsernameRequired],
    ['   ', FORM_ERROR_MESSAGE.githubUsernameRequired],
    ['-octocat', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['octocat-', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['octo--cat', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['octo cat', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['octo/cat', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['..', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['ö', FORM_ERROR_MESSAGE.githubUsernameInvalid],
    ['x'.repeat(40), FORM_ERROR_MESSAGE.githubUsernameInvalid]
  ])('refuses %j in the browser and sends nothing', async (username, message) => {
    const { services, user } = setup()
    if (username) await user.type(usernameField(), username)
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(usernameField()).toHaveAttribute('aria-invalid', 'true')
    expect(services.github.connect).not.toHaveBeenCalled()
  })

  it('clears the field error as soon as the name is fixed', async () => {
    const { user } = setup()
    await connectAs(user, '-a')
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.clear(usernameField())
    await user.type(usernameField(), 'a')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(usernameField()).toHaveAttribute('aria-invalid', 'false')
  })

  it.each(['a', 'a-b', 'octocat', 'x'.repeat(39)])('connects %s and shows the account instead of the field', async (username) => {
    const { services, user } = setup()
    await connectAs(user, ` ${username} `)

    expect(services.github.connect).toHaveBeenCalledWith(username)
    expect(await screen.findByText('Connected as octocat')).toBeInTheDocument()
    expect(screen.getByText('The Octocat')).toBeInTheDocument()
    expect(screen.getByText('TO')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'GitHub user name' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'repo' })).toBeInTheDocument()
  })

  it('shows the user name when the GitHub account has no display name', async () => {
    const { user } = setup((services) => services.github.connect.mockResolvedValue({ login: 'empty-user', name: null }))
    await connectAs(user, 'empty-user')

    expect(await screen.findByText('Connected as empty-user')).toBeInTheDocument()
    expect(screen.getByText('empty-user')).toBeInTheDocument()
    expect(screen.getByText('E')).toBeInTheDocument()
  })

  it('keeps the field and shows the user-not-found toast for an unknown user', async () => {
    const { toast, user } = setup((services) => services.github.connect.mockRejectedValue(httpError(404, 'not_found')))
    await connectAs(user, 'no-such-user')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toBe(`GitHub authorization failed. ${GITHUB_WIZARD_HINT.userNotFound}`)
    expect(usernameField()).toHaveValue('no-such-user')
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it.each([
    [429, 'rate_limited', GITHUB_WIZARD_HINT.rateLimited],
    [502, 'upstream_error', 'GitHub is unavailable or sent an unexpected answer, try again later.'],
    [504, 'upstream_timeout', 'GitHub took too long to answer, please try again.']
  ])('shows the constant toast for a GitHub %i on connect', async (status, code, hint) => {
    const { toast, user } = setup((services) => services.github.connect.mockRejectedValue(httpError(status, code)))
    await connectAs(user, 'octocat')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toBe(`GitHub authorization failed. ${hint}`)
  })

  it('shows Switch account once connected and returns to the empty field after it', async () => {
    const { services, user } = setup()
    await connectAs(user, 'octocat')
    await user.click(await screen.findByRole('button', { name: 'Switch account' }))

    expect(services.github.disconnect).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('textbox', { name: 'GitHub user name' })).toHaveValue('')
    expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument()
  })
})

describe('GitHub wizard lists (API data source)', () => {
  it('says the repository list is cut when GitHub has more than one page', async () => {
    const { user } = setup((services) =>
      services.github.searchRepo.mockResolvedValue({ items: [{ id: 'repo', name: 'repo', description: '' }], truncated: true })
    )
    await connectAs(user, 'busy-user')

    expect(await screen.findByRole('note')).toHaveTextContent('Showing the first 100 repositories. Search narrows this list only.')
  })

  it('shows no note when the list is complete', async () => {
    const { user } = setup()
    await connectAs(user, 'octocat')

    await screen.findByRole('radio', { name: 'repo' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows an empty state for an account with no public repository, and "no match" for a search', async () => {
    const { services, user } = setup((fake) => fake.github.searchRepo.mockResolvedValue({ items: [], truncated: false }))
    await connectAs(user, 'empty-user')

    expect(await screen.findByText('This account has no public repositories.')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'zz')
    expect(await screen.findByText('No repositories match')).toBeInTheDocument()
    expect(services.github.searchRepo).toHaveBeenLastCalledWith('zz')
  })

  it('says the file list is cut and shows an empty state for a repository without supported files', async () => {
    const { services, user } = setup((fake) => fake.github.listFile.mockResolvedValueOnce({ items: [{ id: 'f1', path: 'a.ts', language: 'TypeScript' }], truncated: true }))
    await connectAs(user, 'octocat')
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('note')).toHaveTextContent('Showing the first 500 files of this repository.')
    expect(screen.getByRole('checkbox', { name: 'a.ts' })).toBeInTheDocument()

    services.github.listFile.mockResolvedValueOnce({ items: [], truncated: false })
    await user.click(screen.getByRole('button', { name: 'Select repository' }))
    services.github.searchRepo.mockResolvedValue({ items: [{ id: 'empty', name: 'empty', description: '' }], truncated: false })
    await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'e')
    await user.click(await screen.findByRole('radio', { name: 'empty' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('No supported files in this repository.')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('GitHub wizard without a connection on the server (409)', () => {
  it('a 409 on search shows the not-connected toast and the connect card again', async () => {
    const { services, toast, user } = setup()
    await connectAs(user, 'octocat')
    await screen.findByRole('radio', { name: 'repo' })
    services.github.searchRepo.mockRejectedValue(httpError(409, 'conflict'))
    await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'r')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error.mock.calls.at(-1)?.[0]).toBe(`Could not load your GitHub repositories. ${GITHUB_WIZARD_HINT.notConnected}`)
    expect(await screen.findByRole('textbox', { name: 'GitHub user name' })).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('a 409 on Import returns to the first step with the connect card', async () => {
    const { toast, user } = setup((services) => services.github.getFile.mockRejectedValue(httpError(409, 'conflict')))
    await connectAs(user, 'octocat')
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('checkbox', { name: 'a.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toBe(`Could not import the file. ${GITHUB_WIZARD_HINT.notConnected}`)
    expect(await screen.findByRole('heading', { name: 'Select Repository' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'GitHub user name' })).toBeInTheDocument()
  })

  it.each([
    [409, 'conflict'],
    [500, 'internal_error']
  ])('a %i file list of a repository the user already left shows no toast and keeps the account', async (status, code) => {
    let fail: () => void = () => undefined
    const { services, toast, user } = setup((fake) =>
      fake.github.searchRepo.mockResolvedValue({
        items: [
          { id: 'old', name: 'old', description: '' },
          { id: 'new', name: 'new', description: '' }
        ],
        truncated: false
      })
    )
    services.github.listFile
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = () => reject(httpError(status, code)))))
      .mockResolvedValueOnce({ items: [{ id: 'f1', path: 'a.ts', language: 'TypeScript' }], truncated: false })
    await connectAs(user, 'octocat')
    await user.click(await screen.findByRole('radio', { name: 'old' }))
    await user.click(screen.getByRole('radio', { name: 'new' }))
    fail()

    await new Promise((done) => setTimeout(done, 50))
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByText('Connected as octocat')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'new' })).toBeChecked()
  })

  it('maps a 413 on Import to the single-file limit', async () => {
    const { toast, user } = setup((services) => services.github.getFile.mockRejectedValue(httpError(413, 'payload_too_large')))
    await connectAs(user, 'octocat')
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('checkbox', { name: 'a.ts' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toBe(`Could not import the file. ${GITHUB_WIZARD_HINT.fileChar}`)
    expect(screen.getByRole('heading', { name: 'Select File' })).toBeInTheDocument()
  })
})
