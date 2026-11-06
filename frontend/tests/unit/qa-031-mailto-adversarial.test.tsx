import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContactSupportForm from '../../src/components/ContactSupportForm'
import { SUPPORT_EMAIL, SUPPORT_MAIL_TEXT } from '../../src/lib/help.constants'
import { buildSupportMail, MAILTO_MAX_LENGTH, supportMailText } from '../../src/lib/supportMailto'
import type { SupportRequest } from '../../src/types'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStore } from '../utils/renderWithStore'

// QA plan 032: adversarial checks the implementing agent did not run.

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

// The form tests record the hand-off; the openMailApp tests load the real module with importActual.
vi.mock('../../src/lib/openMailApp', () => ({ openMailApp: vi.fn() }))

const base: SupportRequest = {
  issueType: 'account',
  email: 'john@company.com',
  reviewId: 'r-1',
  priority: 'low',
  description: 'Something is broken here'
}

function mailOf(change: Partial<SupportRequest> = {}, ticket: string | null = 'SUP-1001') {
  return buildSupportMail({ to: SUPPORT_EMAIL, ticket, request: { ...base, ...change } })
}

// Split a link the way a naive mail app does: raw `?` and `&`, before any decoding.
function rawParts(link: string) {
  const [head, ...queryList] = link.split('?')
  const query = queryList.join('?')
  const pairList = query.split('&').map((pair) => pair.split('='))
  return { head: head ?? '', nameList: pairList.map(([name]) => name), pairList }
}

const separatorList = ['\r\n', '\n', '\r', '\u2028', '\u2029', '\u0085', '\u000b', '\u000c', '\u0000']

describe('QA 032: no raw separator or header can reach the link', () => {
  const attackList = [
    '\r\nBcc: x@y.z',
    '%0D%0ABcc: x@y.z',
    '%0d%0abcc:x@y.z',
    '\u2028Bcc: x@y.z',
    '\u2029Cc: x@y.z',
    '\u0085To: x@y.z',
    '&cc=x@y.z&bcc=x@y.z',
    '?to=x@y.z',
    '#&to=x@y.z',
    '%26cc%3Dx%40y.z',
    '=?utf-8?b?QmNjOiB4QHkueg==?='
  ]

  it.each(attackList.flatMap((attack) => (['email', 'reviewId', 'description'] as const).map((field) => [field, attack] as const)))(
    '%s holding %j adds no query parameter and no recipient',
    (field, attack) => {
      const value = field === 'description' ? `Long enough text ${attack} tail` : `a${attack}@b.co`
      const mail = mailOf({ [field]: value })
      const { head, nameList } = rawParts(mail.link)
      expect(head).toBe(`mailto:${SUPPORT_EMAIL}`)
      expect(nameList).toEqual(['subject', 'body'])
      for (const separator of separatorList) expect(mail.link.includes(separator)).toBe(false)
      const url = new URL(mail.link)
      expect([...url.searchParams.keys()]).toEqual(['subject', 'body'])
      expect(url.pathname).toBe(SUPPORT_EMAIL)
      expect(url.searchParams.get('subject')).toBe('[SUP-1001] Account or login (Low)')
      // The email and review ID stay on their own body line. (A line break the user typed in the
      // description is kept, but it is body text inside one encoded value, never a header.)
      const body = url.searchParams.get('body') ?? ''
      if (field !== 'description') expect(body.split('\r\n').some((line) => /^(bcc|cc|to):/i.test(line))).toBe(false)
    }
  )

  it.each([
    'SUP-1\r\nBcc: x@y.z',
    'SUP-1&cc=x@y.z',
    'SUP-1?bcc=x@y.z',
    'SUP-1\u2028',
    '<b>SUP-1</b>',
    'sup-1001',
    'SUP-',
    ''
  ])('a ticket %j that is not SUP-NNNN is left out of the subject and the body', (ticket) => {
    const mail = mailOf({}, ticket)
    const url = new URL(mail.link)
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body'])
    expect(url.searchParams.get('subject')).toBe('Account or login (Low)')
    expect(url.searchParams.get('body')).not.toContain(SUPPORT_MAIL_TEXT.ticket)
  })

  it('a hostile recipient constant cannot add a query either (CR/LF stripped, rest encoded)', () => {
    const mail = buildSupportMail({ to: 'a@b.co\r\n?bcc=x@y.z&cc=x@y.z', ticket: null, request: base })
    expect(rawParts(mail.link).nameList).toEqual(['subject', 'body'])
    expect(mail.link).not.toMatch(/[\r\n]/)
  })
})

describe('QA 032: round-trip of awkward text', () => {
  it.each([
    'a&b?c#d%e=f+g;h/i:j@k',
    '100% done = %ZZ %0 %',
    'emoji 🎉 and astral 𝒳 and RTL مرحبا and combining é',
    'tabs\tand  double  spaces',
    'line one\nline two\r\nline three\rline four',
    '+++ plus signs are not spaces +++'
  ])('%j comes back unchanged (line breaks as CRLF)', (text) => {
    const mail = mailOf({ description: text })
    const body = new URL(mail.link).searchParams.get('body') ?? ''
    const decoded = decodeURIComponent(rawParts(mail.link).pairList[1]?.[1] ?? '')
    const expected = text.trim().replace(/\r\n|\r|\n/g, '\r\n')
    expect(decoded.endsWith(expected)).toBe(true)
    // URLSearchParams turns `+` into a space; decodeURIComponent (RFC 6068) does not. The builder
    // encodes `+` as %2B, so both readings agree.
    expect(body.endsWith(expected)).toBe(true)
  })
})

describe('QA 032: the length cap', () => {
  it.each([
    ['2 000 ASCII characters', 'x'.repeat(2000)],
    ['2 000 percent signs (3 encoded characters each)', '%'.repeat(2000)],
    ['1 000 emoji (12 encoded characters each)', '🎉'.repeat(1000)],
    ['2 000 CJK characters (9 encoded characters each)', '測'.repeat(2000)],
    ['2 000 newlines between words', 'ab\n'.repeat(666)]
  ])('%s: link at most 1 800, note at the end, full text kept for Copy message', (_name, description) => {
    const mail = mailOf({ description, reviewId: 'r'.repeat(64) })
    expect(mail.shortened).toBe(true)
    expect(mail.link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(mail.body.endsWith(SUPPORT_MAIL_TEXT.shortened)).toBe(true)
    expect(() => decodeURIComponent(mail.link.slice(mail.link.indexOf('body=') + 5))).not.toThrow()
    expect(supportMailText(mail).endsWith(description.trim().replace(/\n/g, '\r\n'))).toBe(true)
    expect(supportMailText(mail)).not.toContain(SUPPORT_MAIL_TEXT.shortened)
  })

  // FINDING F1 (low), fixed: the cap once shortened only the description. An email the backend
  // accepts (254 characters, any non-space character) made of multi-byte characters encodes to more
  // than 1 800 characters on its own; the builder now also shortens the sender email and review ID.
  it('an email of 254 multi-byte characters (backend-valid) still gives a link of at most 1 800', () => {
    const email = `${'測'.repeat(240)}@b.co`
    const mail = mailOf({ email, description: 'x'.repeat(2000) })
    expect(mail.link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
  })
})

describe('QA 032: openMailApp only follows a mailto: link', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function openerWithSpy() {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const { openMailApp } = await vi.importActual<typeof import('../../src/lib/openMailApp')>('../../src/lib/openMailApp')
    return { openMailApp, assign }
  }

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'http://evil.example/mailto:',
    'https://example.com',
    'data:text/html,<script>alert(1)</script>',
    ' mailto:a@b.co',
    '//mailto:a@b.co',
    'mailto',
    ''
  ])('ignores %j', async (link) => {
    const { openMailApp, assign } = await openerWithSpy()
    openMailApp(link)
    expect(assign).not.toHaveBeenCalled()
  })

  it('follows the built link exactly once', async () => {
    const { openMailApp, assign } = await openerWithSpy()
    const { link } = mailOf()
    openMailApp(link)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(link)
  })
})

describe('QA 032: the form under pressure', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  async function opener() {
    const module = await import('../../src/lib/openMailApp')
    return vi.mocked(module.openMailApp)
  }

  function fillFast(description: string) {
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }))
    fireEvent.change(screen.getByLabelText('Describe the problem'), { target: { value: description } })
  }

  it('ten rapid submits during a slow store answer send one request and open the mail app once', async () => {
    const opened = await opener()
    const fake = createFakeServices()
    let resolve: (value: { ticket: string }) => void = () => undefined
    fake.services.support.submit.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    renderWithStore(<ContactSupportForm />, { services: fake.services })
    fillFast('A slow store answer test')
    const form = screen.getByRole('button', { name: /Submit/ }).closest('form') as HTMLFormElement

    for (let index = 0; index < 10; index += 1) fireEvent.submit(form)
    await act(async () => { resolve({ ticket: 'SUP-3001' }) })
    await screen.findByRole('status')
    for (let index = 0; index < 3; index += 1) await act(async () => { await Promise.resolve() })

    expect(fake.services.support.submit).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('the mock data source (400 ms delay) with a double submit opens the mail app once', async () => {
    const opened = await opener()
    renderWithStore(<ContactSupportForm />)
    await waitFor(() => expect(screen.getByLabelText('Email address')).not.toHaveValue(''))
    fillFast('Fake backend double submit')
    const form = screen.getByRole('button', { name: /Submit/ }).closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)
    await screen.findByRole('status', {}, { timeout: 3000 })

    expect(opened).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/no message was sent/i)).not.toBeInTheDocument()
  })

  it('a 2 000-character description: the link is shortened, the textarea and Copy message keep the full text', async () => {
    const opened = await opener()
    const user = userEvent.setup()
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const fake = createFakeServices()
    renderWithStore(<ContactSupportForm />, { services: fake.services })
    const description = `${'long text & 100% = ok? #'.repeat(83)}end`.slice(0, 2000)
    fillFast(description)

    await user.click(screen.getByRole('button', { name: 'Submit request' }))
    await screen.findByRole('status')

    const link = opened.mock.calls[0]?.[0] ?? ''
    expect(link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(new URL(link).searchParams.get('body')?.endsWith(SUPPORT_MAIL_TEXT.shortened)).toBe(true)
    expect(screen.getByLabelText('Describe the problem')).toHaveValue(description)

    await user.click(screen.getByRole('button', { name: 'Copy message' }))
    const copied = writeText.mock.calls[0]?.[0] as string
    expect(copied.endsWith(description)).toBe(true)
    expect(copied).not.toContain(SUPPORT_MAIL_TEXT.shortened)
  })

  it('a failing store (500) opens nothing, shows no outcome and keeps the values', async () => {
    const opened = await opener()
    const fake = createFakeServices()
    fake.services.support.submit.mockRejectedValueOnce(new Error('boom'))
    renderWithStore(<ContactSupportForm />, { services: fake.services })
    fillFast('Store failure test text')

    fireEvent.submit(screen.getByRole('button', { name: /Submit/ }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(fake.toast.error).toHaveBeenCalled())

    expect(opened).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Describe the problem')).toHaveValue('Store failure test text')
    // The button is usable again (the ref guard was released).
    expect(screen.getByRole('button', { name: 'Submit request' })).not.toBeDisabled()
  })
})
