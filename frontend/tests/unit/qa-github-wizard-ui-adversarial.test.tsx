import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import GithubWizardPage from '../../src/pages/GithubWizardPage'
import { GITHUB_WIZARD_HINT } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

// QA adversarial pass, plan 030, wizard UI (user-name field).
type Fake = ReturnType<typeof createFakeServices>

function setup(edit?: (services: Fake['services']) => void) {
  const fake = createFakeServices()
  edit?.(fake.services)
  renderWithStore(<GithubWizardPage />, { services: fake.services })
  return { ...fake, user: userEvent.setup() }
}

function httpError(status: number, code: string) {
  return AppError.fromResponse(status, { error: { code, message: 'x' } })
}

function usernameField() {
  return screen.getByRole('textbox', { name: 'GitHub user name' })
}

describe('QA adversarial (plan 030): wizard UI', () => {
  it('a rapid double submit of Connect sends one connect call', async () => {
    let finish: () => void = () => undefined
    const { services, user } = setup((fake) =>
      fake.github.connect.mockImplementation(
        () => new Promise((done) => {
          finish = () => done({ login: 'octocat', name: null })
        })
      )
    )
    await user.type(usernameField(), 'octocat')
    const button = screen.getByRole('button', { name: 'Connect GitHub' })
    await user.click(button)
    await user.click(button)
    await user.type(usernameField(), '{Enter}')
    finish()

    expect(await screen.findByText('Connected as octocat')).toBeInTheDocument()
    expect(services.github.connect).toHaveBeenCalledTimes(1)
  })

  it('a pasted 10 000 character user name is refused in the browser and nothing is sent', async () => {
    const { services, user } = setup()
    await user.click(usernameField())
    await user.paste('a'.repeat(10_000))
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(services.github.connect).not.toHaveBeenCalled()
  })

  // FIXED (was KNOWN DEFECT, QA plan 030, F1): clearIfNotConnected sets selectedRepoId to null in the
  // reducer, and listener.ts isSuperseded() reads that post-reducer state, so the 409 of
  // selectRepo is treated as superseded and its toast is dropped.
  it('FIXED F1, was KNOWN DEFECT: a 409 on the file list (click a repository) shows the not-connected toast', async () => {
    const { toast, user } = setup((fake) => fake.github.listFile.mockRejectedValue(httpError(409, 'conflict')))
    await user.type(usernameField(), 'octocat')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('radio', { name: 'repo' }))

    expect(await screen.findByRole('textbox', { name: 'GitHub user name' })).toBeInTheDocument()
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toContain(GITHUB_WIZARD_HINT.notConnected)
  })

  // FIXED (was KNOWN DEFECT, QA plan 030, F2): only approve() resets the step on a 409; a 409 of the file
  // list after Next leaves the user on an empty "Select File" step with "Repository:" blank.
  it('FIXED F2, was KNOWN DEFECT: a 409 on the file list that arrives after Next goes back to the connect card (not a blank file step)', async () => {
    let fail: () => void = () => undefined
    const { toast, user } = setup((fake) =>
      fake.github.listFile.mockImplementation(
        () => new Promise((_, reject) => {
          fail = () => reject(httpError(409, 'conflict'))
        })
      )
    )
    await user.type(usernameField(), 'octocat')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    await user.click(await screen.findByRole('radio', { name: 'repo' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Select File' })).toBeInTheDocument()

    fail()

    expect(await screen.findByRole('heading', { name: 'Select Repository' })).toBeInTheDocument()
    expect(usernameField()).toBeInTheDocument()
    void toast
  })

  it('connect succeeds but the first repository list is rate limited: the toast names the limit and Connect can be retried', async () => {
    const { services, toast, user } = setup((fake) => fake.github.searchRepo.mockRejectedValueOnce(httpError(429, 'rate_limited')))
    await user.type(usernameField(), 'octocat')
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toContain(GITHUB_WIZARD_HINT.rateLimited)
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(await screen.findByText('Connected as octocat')).toBeInTheDocument()
    expect(services.github.connect).toHaveBeenCalledTimes(2)
  })
})
