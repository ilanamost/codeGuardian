import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import ContactSupportForm from '../../src/components/ContactSupportForm'
import { SUPPORT_EMAIL, SUPPORT_MESSAGE } from '../../src/lib/help.constants'
import { openMailApp } from '../../src/lib/openMailApp'
import { AppError } from '../../src/models/app-error'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 032: Submit Request stores the request (ticket), then opens the user's mail app once with
// a ready mailto: link; the form keeps its values and offers Copy message and Copy address.

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('../../src/lib/openMailApp', () => ({ openMailApp: vi.fn() }))

const opened = vi.mocked(openMailApp)
const description = 'The review never finishes'
const demoSentence = 'no message was sent'
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(async () => undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

function setupUser() {
  const user = userEvent.setup()
  // user-event installs its own clipboard on setup, so stub after it
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Other' }))
  await user.type(screen.getByLabelText('Describe the problem'), description)
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await fill(user)
  await user.click(screen.getByRole('button', { name: 'Submit request' }))
}

function renderApiMode() {
  const fake = createFakeServices()
  const result = renderWithStore(<ContactSupportForm />, { services: fake.services })
  return { ...result, submit: fake.services.support.submit, errorToast: fake.toast }
}

function openedLink(): URL {
  expect(opened).toHaveBeenCalledTimes(1)
  return new URL(opened.mock.calls[0]?.[0] ?? '')
}

describe('ContactSupportForm with the real backend', () => {
  it('stores the request, then opens the mail app once with the ticket in the subject', async () => {
    const user = setupUser()
    const { submit } = renderApiMode()
    submit.mockResolvedValueOnce({ ticket: 'SUP-1001' })

    await fillAndSubmit(user)

    const banner = await screen.findByRole('status')
    expect(submit).toHaveBeenCalledTimes(1)
    const link = openedLink()
    expect(link.protocol).toBe('mailto:')
    expect(link.pathname).toBe(SUPPORT_EMAIL)
    expect(link.searchParams.get('subject')).toBe('[SUP-1001] Other (Normal)')
    expect(link.searchParams.get('body')).toContain('Ticket: SUP-1001\r\n')
    expect(link.searchParams.get('body')).toContain(`From: john@company.com\r\n`)
    expect(link.searchParams.get('body')?.endsWith(description)).toBe(true)

    expect(banner).toHaveTextContent(SUPPORT_MESSAGE.outcome('SUP-1001'))
    expect(banner).not.toHaveTextContent(demoSentence)
    expect(screen.getByTestId('support-address')).toHaveTextContent(SUPPORT_EMAIL)
    expect(toast.success).toHaveBeenCalledWith('Your mail app should open with the message. Press Send there to contact support. Ticket SUP-1001.')
  })

  it('keeps every typed value after a submit', async () => {
    const user = setupUser()
    renderApiMode()
    await fill(user)
    await user.type(screen.getByLabelText('Review ID (optional)'), 'r4')
    await user.click(screen.getByRole('radio', { name: /^High/ }))

    await user.click(screen.getByRole('button', { name: 'Submit request' }))
    await screen.findByRole('status')

    expect(screen.getByLabelText('Describe the problem')).toHaveValue(description)
    expect(screen.getByLabelText('Review ID (optional)')).toHaveValue('r4')
    expect(screen.getByLabelText('Email address')).toHaveValue('john@company.com')
    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^High/ })).toBeChecked()
    expect(openedLink().searchParams.get('body')).toContain('Review ID: r4\r\n')
  })

  it('opens the mail app once per submit: a second submit opens it again', async () => {
    const user = setupUser()
    renderApiMode()
    await fillAndSubmit(user)
    await screen.findByRole('status')

    await user.click(screen.getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2))
  })

  it('two back-to-back clicks send one request and open the mail app once', async () => {
    const user = setupUser()
    const { submit } = renderApiMode()
    let resolve: (value: { ticket: string }) => void = () => undefined
    submit.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await fill(user)

    const button = screen.getByRole('button', { name: 'Submit request' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.submit(button.closest('form') as HTMLFormElement)
    await act(async () => { resolve({ ticket: 'SUP-2001' }) })

    expect(submit).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('Enter pressed twice sends one request and the button is disabled while it runs', async () => {
    const user = setupUser()
    const { submit } = renderApiMode()
    submit.mockImplementationOnce(() => new Promise(() => undefined))
    await fill(user)

    await user.type(screen.getByLabelText('Email address'), '{Enter}{Enter}')

    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Submitting...' })).toBeDisabled()
    expect(opened).not.toHaveBeenCalled()
  })

  it('an invalid submit opens nothing and sends nothing', async () => {
    const user = setupUser()
    const { submit } = renderApiMode()

    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    expect(screen.getByText('Select an issue type')).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a 429 shows the wait toast, opens nothing and keeps the values', async () => {
    const user = setupUser()
    const { submit, errorToast } = renderApiMode()
    submit.mockRejectedValueOnce(AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'Too many', details: { retryAfterSecond: 120 } } }))

    await fillAndSubmit(user)

    await waitFor(() => expect(errorToast.error).toHaveBeenCalledWith('Could not submit your request. Too many support requests. Try again in 2 minutes.'))
    expect(opened).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Describe the problem')).toHaveValue(description)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('the outcome disappears once the form is edited again', async () => {
    const user = setupUser()
    renderApiMode()
    await fillAndSubmit(user)
    await screen.findByRole('status')

    await user.type(screen.getByLabelText('Describe the problem'), 'x')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument()
  })
})

describe('ContactSupportForm copy buttons', () => {
  it('Copy message puts the subject and the full body on the clipboard', async () => {
    const user = setupUser()
    const { submit } = renderApiMode()
    submit.mockResolvedValueOnce({ ticket: 'SUP-1005' })
    await fillAndSubmit(user)

    await user.click(await screen.findByRole('button', { name: 'Copy message' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0]?.[0] as string
    expect(text.startsWith('[SUP-1005] Other (Normal)\r\n\r\nTicket: SUP-1005\r\n')).toBe(true)
    expect(text.endsWith(description)).toBe(true)
    expect(toast.success).toHaveBeenLastCalledWith(SUPPORT_MESSAGE.messageCopied)
  })

  it('Copy address puts the support address on the clipboard', async () => {
    const user = setupUser()
    renderApiMode()
    await fillAndSubmit(user)

    await user.click(await screen.findByRole('button', { name: 'Copy address' }))

    expect(writeText).toHaveBeenCalledWith(SUPPORT_EMAIL)
    expect(toast.success).toHaveBeenLastCalledWith(SUPPORT_MESSAGE.addressCopied)
  })

  it('a refused clipboard shows the error toast and no success toast', async () => {
    const user = setupUser()
    const { errorToast } = renderApiMode()
    writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    await fillAndSubmit(user)
    vi.mocked(toast.success).mockClear()

    await user.click(await screen.findByRole('button', { name: 'Copy address' }))

    await waitFor(() => expect(errorToast.error).toHaveBeenCalledWith('Could not copy to clipboard'))
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('ContactSupportForm on the fake backend (demo ticket)', () => {
  it('opens the mail app with the demo ticket and never says no message was sent', async () => {
    const user = setupUser()
    renderWithStore(<ContactSupportForm />)

    await fillAndSubmit(user)

    const banner = await screen.findByRole('status', {}, { timeout: 3000 })
    expect(banner).toHaveTextContent(/^Your mail app should open with the message\. Press Send there to contact support\. Ticket SUP-\d{4}\.$/)
    expect(screen.queryByText(new RegExp(demoSentence))).not.toBeInTheDocument()
    const link = openedLink()
    expect(link.pathname).toBe(SUPPORT_EMAIL)
    expect(link.searchParams.get('subject')).toMatch(/^\[SUP-\d{4}\] Other \(Normal\)$/)
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument()
  })
})

describe('SUPPORT_MESSAGE.outcome', () => {
  it('names the ticket, or no ticket when there is none', () => {
    expect(SUPPORT_MESSAGE.outcome('SUP-0001')).toBe('Your mail app should open with the message. Press Send there to contact support. Ticket SUP-0001.')
    expect(SUPPORT_MESSAGE.outcome(null)).toBe('Your mail app should open with the message. Press Send there to contact support.')
  })
})
