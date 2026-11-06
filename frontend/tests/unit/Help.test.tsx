import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import HelpPage from '../../src/pages/HelpPage'
import { openMailApp } from '../../src/lib/openMailApp'
import { validateSupportRequest } from '../../src/lib/validateSupportRequest'
import type { SupportRequest } from '../../src/types'
import { renderWithStore } from '../utils/renderWithStore'

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

// Plan 032: a submit opens the user's mail app; jsdom cannot follow a mailto: link.
vi.mock('../../src/lib/openMailApp', () => ({ openMailApp: vi.fn() }))

function renderHelp(path = '/help') {
  return renderWithStore(<HelpPage />, { route: path })
}

const valid: SupportRequest = {
  issueType: 'other',
  email: 'a@b.co',
  reviewId: '',
  priority: 'normal',
  description: 'Something is broken here'
}

describe('validateSupportRequest', () => {
  it('accepts a valid request', () => {
    expect(validateSupportRequest(valid)).toEqual({})
  })

  it('flags each invalid field', () => {
    const errors = validateSupportRequest({ ...valid, issueType: '', email: 'nope', reviewId: 'a b!', description: 'short' })
    expect(Object.keys(errors).sort()).toEqual(['description', 'email', 'issueType', 'reviewId'])
  })

  // QA 032 F1: the backend accepts at most 254 characters.
  it.each([
    ['254 characters', `${'a'.repeat(249)}@b.co`, undefined],
    ['255 characters', `${'a'.repeat(250)}@b.co`, 'Use at most 254 characters'],
    ['254 multi-byte characters', `${'測'.repeat(249)}@b.co`, undefined],
    ['255 with spaces around (trimmed to 254 first)', `  ${'a'.repeat(249)}@b.co `, undefined]
  ])('an email of %s', (_label, email, message) => {
    expect(validateSupportRequest({ ...valid, email }).email).toBe(message)
  })
})

describe('HelpPage', () => {
  it('shows the create-review guide by default and switches topics', async () => {
    renderHelp()
    expect(screen.getByRole('heading', { name: 'How to Create a New Review' })).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Main Features' }))

    expect(screen.getByRole('heading', { name: 'Main Features' })).toBeInTheDocument()
  })

  it('opens a common issue with its four sections and links to Contact Support', async () => {
    const user = userEvent.setup()
    renderHelp('/help?topic=common-issues')

    await user.click(screen.getByRole('button', { name: /Unable to upload code/ }))

    for (const name of ['What happened', 'Possible causes', 'How to fix it', 'Still stuck?']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Contact Support' }))
    expect(screen.getByRole('heading', { name: 'Contact Support' })).toBeInTheDocument()
  })

  it('filters the error table and shows an empty state', async () => {
    const user = userEvent.setup()
    renderHelp('/help?topic=error-messages')
    expect(screen.getAllByRole('row')).toHaveLength(8)

    await user.type(screen.getByRole('searchbox', { name: 'Search error messages' }), 'timed out')
    expect(screen.getAllByRole('row')).toHaveLength(2)

    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('No matching errors')).toBeInTheDocument()
  })

  it('validates the support form, then submits, opens the mail app and keeps the values', async () => {
    const user = userEvent.setup()
    renderHelp('/help?topic=contact')
    const form = screen.getByRole('button', { name: 'Submit request' }).closest('form')!

    await user.click(screen.getByRole('button', { name: 'Submit request' }))
    expect(within(form).getByText('Select an issue type')).toBeInTheDocument()
    expect(within(form).getByText('Describe the problem', { selector: 'p' })).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
    expect(openMailApp).not.toHaveBeenCalled()

    await user.click(screen.getByRole('radio', { name: 'Other' }))
    await user.type(screen.getByLabelText('Describe the problem'), 'The review never finishes')
    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Ticket SUP-\d{4}/))
    expect(toast.success).toHaveBeenCalled()
    expect(openMailApp).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openMailApp).mock.calls[0]?.[0]).toMatch(/^mailto:/)
    // Plan 032: the values stay, so the user can copy or send again.
    expect(screen.getByLabelText('Describe the problem')).toHaveValue('The review never finishes')
    expect(screen.getByLabelText('Email address')).toHaveValue('john@company.com')
  })

  it('fills the email from the account (GET /api/account), unless the user typed one first', async () => {
    const user = userEvent.setup()
    renderHelp('/help?topic=contact')

    await waitFor(() => expect(screen.getByLabelText('Email address')).toHaveValue('john@company.com'))
    await user.clear(screen.getByLabelText('Email address'))
    await user.type(screen.getByLabelText('Email address'), 'me@example.com')
    expect(screen.getByLabelText('Email address')).toHaveValue('me@example.com')
  })
})

describe('HelpPage topic menu', () => {
  it('toggles the topics menu and closes it after choosing a topic', async () => {
    const user = userEvent.setup()
    renderHelp()
    const toggle = screen.getByRole('button', { name: /Help topics menu/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('tab', { name: 'Error Messages' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Error Messages')
  })
})
