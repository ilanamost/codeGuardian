import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { ACCOUNT_TEXT } from '../../src/lib/account.constants'
import { validateAccountUpdate, validateRegistration } from '../../src/lib/sessionForm'
import { AppError } from '../../src/models/app-error'
import { fixtureData } from '../utils/fixtureData'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { createAccountService } from '../../src/services/account.service'
import { FORM_ERROR_MESSAGE, SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 034, Workstream A: the user name and email are edited in Settings > Account (the current
// password is required), and the sidebar profile is a link to that panel.

const settingsRoute = '/settings?section=account'

function field(name: string) {
  return screen.getByLabelText(name, { selector: 'input' })
}

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel }))
  return screen.getByRole('form', { name: ACCOUNT_TEXT.editHeading })
}

async function fillAndSave(user: ReturnType<typeof userEvent.setup>, value: { username?: string; email?: string; password?: string }) {
  if (value.username !== undefined) {
    await user.clear(field(ACCOUNT_TEXT.username))
    if (value.username) await user.type(field(ACCOUNT_TEXT.username), value.username)
  }
  if (value.email !== undefined) {
    await user.clear(field(ACCOUNT_TEXT.email))
    if (value.email) await user.type(field(ACCOUNT_TEXT.email), value.email)
  }
  if (value.password) await user.type(field(ACCOUNT_TEXT.currentPassword), value.password)
  await user.click(screen.getByRole('button', { name: ACCOUNT_TEXT.saveDetails }))
}

const conflict = () => AppError.fromResponse(409, { error: { code: 'conflict', message: 'taken' } })

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Account edit (plan 034)', () => {
  it('opens Edit mode with the current values and an empty current password; Cancel restores the panel', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: settingsRoute, services })

    await openEdit(user)
    expect(field(ACCOUNT_TEXT.username)).toHaveValue(fixtureData.account.username)
    expect(field(ACCOUNT_TEXT.email)).toHaveValue(fixtureData.account.email)
    expect(field(ACCOUNT_TEXT.currentPassword)).toHaveValue('')
    expect(field(ACCOUNT_TEXT.currentPassword)).toHaveAttribute('type', 'password')

    await user.type(field(ACCOUNT_TEXT.username), 'x')
    await user.click(screen.getByRole('button', { name: ACCOUNT_TEXT.cancelDetails }))

    expect(screen.queryByRole('form', { name: ACCOUNT_TEXT.editHeading })).not.toBeInTheDocument()
    expect(screen.getByTestId('account-username')).toHaveTextContent(fixtureData.account.username)
    expect(services.account.update).not.toHaveBeenCalled()
  })

  // QA 034 F-A1: focus moves to the first field on Edit and back to Edit after Cancel or Save.
  it('moves the focus into the form on Edit and back to the Edit button after Cancel and Save', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: settingsRoute, services })

    await openEdit(user)
    expect(field(ACCOUNT_TEXT.username)).toHaveFocus()
    await user.click(screen.getByRole('button', { name: ACCOUNT_TEXT.cancelDetails }))
    expect(screen.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })).toHaveFocus()

    await openEdit(user)
    expect(field(ACCOUNT_TEXT.username)).toHaveFocus()
    await fillAndSave(user, { password: 'mock-password' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: ACCOUNT_TEXT.editDetailsLabel })).toHaveFocus())
  })

  it('checks the fields inline first and sends nothing while one is wrong', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    renderWithStore(<App />, { route: settingsRoute, services })
    await openEdit(user)

    await fillAndSave(user, { username: 'no', email: 'not-an-email' })

    expect(screen.getByText(FORM_ERROR_MESSAGE.usernameLength(3, 32))).toBeInTheDocument()
    expect(screen.getByText(FORM_ERROR_MESSAGE.emailInvalid)).toBeInTheDocument()
    expect(screen.getByText(FORM_ERROR_MESSAGE.currentPasswordRequired)).toBeInTheDocument()
    expect(services.account.update).not.toHaveBeenCalled()

    await fillAndSave(user, { username: 'bad name!' })
    expect(screen.getByText(FORM_ERROR_MESSAGE.usernameCharacter)).toBeInTheDocument()
    expect(services.account.update).not.toHaveBeenCalled()
  })

  it('saves the trimmed values with the current password; the panel and the sidebar change at once', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    const { store } = renderWithStore(<App />, { route: settingsRoute, services })
    await openEdit(user)

    await fillAndSave(user, { username: '  jane.roe ', email: 'Jane@Example.com ', password: 'mock-password' })

    expect(services.account.update).toHaveBeenCalledWith({ username: 'jane.roe', email: 'Jane@Example.com', currentPassword: 'mock-password' })
    expect(await screen.findByText(ACCOUNT_TEXT.detailsUpdated)).toBeInTheDocument()
    expect(screen.getByTestId('account-username')).toHaveTextContent('jane.roe')
    expect(screen.getByTestId('account-email')).toHaveTextContent('jane@example.com')
    expect(within(screen.getByTestId('sidebar-profile')).getByText('jane@example.com')).toBeInTheDocument()
    expect(store.getState().account.account?.username).toBe('jane.roe')
  })

  it.each([
    ['409 (a taken name or email)', conflict(), SESSION_ERROR_MESSAGE.registerConflict],
    [
      '429 (too many wrong passwords)',
      AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'wait', details: { retryAfterSecond: 120 } } }),
      SESSION_ERROR_MESSAGE.rateLimited(120)
    ]
  ])('shows the %s answer under the form, with no error toast', async (_name, error, message) => {
    const user = userEvent.setup()
    const { services, toast } = createFakeServices()
    services.account.update.mockRejectedValue(error)
    renderWithStore(<App />, { route: settingsRoute, services })
    await openEdit(user)

    await fillAndSave(user, { username: 'jane.roe', password: 'mock-password' })

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('form', { name: ACCOUNT_TEXT.editHeading })).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByTestId('sidebar-profile')).toHaveTextContent(fixtureData.account.email)
  })

  it('marks a wrong current password under its field (422) and clears it on edit', async () => {
    const user = userEvent.setup()
    const { services } = createFakeServices()
    services.account.update.mockRejectedValue(
      AppError.fromResponse(422, { error: { code: 'validation_error', message: 'x', details: { issue: [{ field: 'currentPassword', message: 'is not correct' }] } } })
    )
    renderWithStore(<App />, { route: settingsRoute, services })
    await openEdit(user)

    await fillAndSave(user, { password: 'wrong-password' })

    expect(await screen.findByText(FORM_ERROR_MESSAGE.currentPasswordWrong)).toBeInTheDocument()
    expect(field(ACCOUNT_TEXT.currentPassword)).toHaveAttribute('aria-invalid', 'true')
    await user.type(field(ACCOUNT_TEXT.currentPassword), 'x')
    expect(screen.queryByText(FORM_ERROR_MESSAGE.currentPasswordWrong)).not.toBeInTheDocument()
  })

  it('on the fake backend the update changes the shown account and never calls fetch', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { store } = renderWithStore(<App />, { route: settingsRoute })
    await openEdit(user)

    await fillAndSave(user, { email: 'new@example.com', password: fixtureData.password })

    expect(await screen.findByTestId('account-email')).toHaveTextContent('new@example.com')
    expect(store.getState().account.account?.email).toBe('new@example.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Account update on the fake backend (the backend rules)', () => {
  const service = () => createAccountService(createFixtureDataSource({ data: structuredClone(fixtureData) }))

  it('needs the current password (422 on currentPassword) and checks the fields (422 per field)', async () => {
    const account = service()
    await expect(account.update({ username: 'jane.roe', currentPassword: 'wrong' })).rejects.toMatchObject({
      status: 422,
      issueList: [{ field: 'currentPassword' }]
    })
    await expect(account.update({ username: 'a b', email: 'x', currentPassword: fixtureData.password })).rejects.toMatchObject({
      status: 422,
      issueList: [{ field: 'username' }, { field: 'email' }]
    })
    await expect(account.update({ currentPassword: fixtureData.password })).rejects.toMatchObject({ status: 422 })
  })

  it('answers the updated account (email lower-cased) and GET returns it', async () => {
    const account = service()
    const updated = await account.update({ username: 'jane.roe', email: 'Jane@Example.com', currentPassword: fixtureData.password })
    expect(updated).toMatchObject({ username: 'jane.roe', email: 'jane@example.com', fullName: fixtureData.account.fullName })
    expect(await account.get()).toEqual(updated)
  })
})

describe('Account and registration field rules', () => {
  it('refuses control and line separator characters in an email (contract 0.13.0)', () => {
    for (const email of ['a\u0000@b.co', 'a@b.co\u0085x', 'a b@c.co', 'a@b .co', 'a\u007f@b.co']) {
      expect(validateAccountUpdate({ username: 'jane.roe', email, currentPassword: 'p' }).email).toBe(FORM_ERROR_MESSAGE.emailInvalid)
      expect(validateRegistration({ username: 'jane.roe', email, password: 'long-enough-1', confirmPassword: 'long-enough-1' }).email).toBe(
        FORM_ERROR_MESSAGE.emailInvalid
      )
    }
    expect(validateAccountUpdate({ username: 'jane.roe', email: 'jane@example.com', currentPassword: 'p' })).toEqual({})
  })

  it('applies the 32-character user name and 254-character email limits', () => {
    const error = validateAccountUpdate({ username: 'a'.repeat(33), email: `${'a'.repeat(250)}@b.co`, currentPassword: '' })
    expect(error).toEqual({
      username: FORM_ERROR_MESSAGE.usernameLength(3, 32),
      email: FORM_ERROR_MESSAGE.emailTooLong(254),
      currentPassword: FORM_ERROR_MESSAGE.currentPasswordRequired
    })
  })
})

describe('Sidebar profile link (plan 034)', () => {
  it('is a keyboard-focusable link to Settings > Account with an accessible name and hover style', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/' })

    const link = await screen.findByRole('link', { name: ACCOUNT_TEXT.profileLink(fixtureData.account.fullName) })
    expect(link).toHaveAttribute('href', settingsRoute)
    expect(link).toHaveClass('cursor-pointer', 'hover:bg-sidebar-active', 'focus-visible:outline-2')

    link.focus()
    expect(link).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })
})
