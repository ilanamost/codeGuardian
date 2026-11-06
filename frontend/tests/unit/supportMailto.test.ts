import { describe, expect, it } from 'vitest'
import { SUPPORT_EMAIL, SUPPORT_MAIL_TEXT } from '../../src/lib/help.constants'
import { buildSupportMail, MAILTO_MAX_LENGTH, MAILTO_SCHEME, supportMailSubject, supportMailText } from '../../src/lib/supportMailto'
import type { SupportRequest } from '../../src/types'

// Plan 032: the mailto link builder. A link is split back into its parts the way a mail app
// reads it: the address before `?`, then `&`-separated `name=value` pairs, each value decoded.

const request: SupportRequest = {
  issueType: 'review_failed',
  email: 'john@company.com',
  reviewId: 'r-42',
  priority: 'high',
  description: 'The review never finishes on my file'
}

function partsOf(link: string) {
  expect(link.startsWith(MAILTO_SCHEME)).toBe(true)
  const rest = link.slice(MAILTO_SCHEME.length)
  const [address, query = ''] = rest.split('?')
  const pairList = query.split('&').map((pair) => pair.split('='))
  return {
    address: decodeURIComponent(address ?? ''),
    rawAddress: address,
    nameList: pairList.map(([name]) => name),
    pairList,
    value: Object.fromEntries(pairList.map(([name, value]) => [name, decodeURIComponent(value ?? '')])) as Record<string, string>
  }
}

function mailOf(change: Partial<SupportRequest> = {}, ticket: string | null = 'SUP-0042') {
  return buildSupportMail({ to: SUPPORT_EMAIL, ticket, request: { ...request, ...change } })
}

describe('buildSupportMail: the normal message', () => {
  it('is a mailto: link to exactly the support address, with only subject and body', () => {
    const { link } = mailOf()
    const part = partsOf(link)

    expect(link.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true)
    expect(part.address).toBe(SUPPORT_EMAIL)
    expect(part.nameList).toEqual(['subject', 'body'])
    expect(part.pairList.every((pair) => pair.length === 2)).toBe(true)
  })

  it('subject: [ticket] issue label (priority label)', () => {
    expect(partsOf(mailOf().link).value.subject).toBe('[SUP-0042] Review failed (High)')
  })

  it('subject without a ticket, or with something that is not a SUP-NNNN ticket', () => {
    expect(partsOf(mailOf({}, null).link).value.subject).toBe('Review failed (High)')
    expect(partsOf(mailOf({}, '<b>x</b>\r\nBcc: x@y.z').link).value.subject).toBe('Review failed (High)')
  })

  it('body: ticket, type, priority, sender, review ID, then the description, with CRLF line breaks', () => {
    const mail = mailOf()

    expect(partsOf(mail.link).value.body).toBe(
      [
        'Ticket: SUP-0042',
        'Issue type: Review failed',
        'Priority: High — blocked from completing my work',
        'From: john@company.com',
        'Review ID: r-42',
        '',
        'Description:',
        'The review never finishes on my file'
      ].join('\r\n')
    )
    expect(mail.link).toContain('%0D%0A')
    expect(mail.shortened).toBe(false)
    expect(mail.body).toBe(mail.fullBody)
  })

  it('leaves out the ticket and review ID lines when there are none', () => {
    const body = partsOf(mailOf({ reviewId: '  ' }, null).link).value.body

    expect(body).not.toContain('Ticket:')
    expect(body).not.toContain('Review ID:')
    expect(body.startsWith('Issue type: Review failed\r\n')).toBe(true)
  })

  it('Copy message text is the subject, a blank line and the full body', () => {
    const mail = mailOf()
    expect(supportMailText(mail)).toBe(`${mail.subject}\r\n\r\n${mail.fullBody}`)
  })
})

describe('buildSupportMail: free text round-trips through the body only', () => {
  it.each([
    ['reserved characters', 'a & b ? c # d % e = f + g / h ; i'],
    ['an encoded-looking text', 'not %0D%0A a break and not %26 an ampersand'],
    ['unicode', 'Ошибка 错误 エラー ✓ 😀 éàü'],
    ['quotes and markup', `"double" 'single' <script>alert(1)</script>`]
  ])('%s', (_label, description) => {
    const mail = mailOf({ description })
    const part = partsOf(mail.link)

    expect(part.nameList).toEqual(['subject', 'body'])
    expect(part.address).toBe(SUPPORT_EMAIL)
    expect(part.value.subject).toBe('[SUP-0042] Review failed (High)')
    expect(part.value.body.endsWith(`\r\n${description}`)).toBe(true)
    // No raw reserved character of the text is left in the link.
    expect(mail.link.slice(mail.link.indexOf('&body=') + 6)).not.toMatch(/[&?#=\s]/)
  })

  it('newlines in the description keep every line, as CRLF', () => {
    const description = 'line one\nline two\r\nline three\rline four'
    const body = partsOf(mailOf({ description }).link).value.body

    expect(body.endsWith('Description:\r\nline one\r\nline two\r\nline three\r\nline four')).toBe(true)
  })

  it('a lone surrogate does not throw: it becomes U+FFFD', () => {
    const body = partsOf(mailOf({ description: 'broken \uD800 text here' }).link).value.body
    expect(body.endsWith('broken � text here')).toBe(true)
  })
})

describe('buildSupportMail: header and recipient injection', () => {
  const injection = '\r\nBcc: x@y.z'

  it.each([
    ['email', { email: `john@company.com${injection}` }],
    ['review ID', { reviewId: `r1${injection}` }],
    ['description', { description: `Please help${injection}\r\nTo: evil@y.z` }],
    ['description with encoded breaks', { description: 'Please help %0D%0ABcc: x@y.z &cc=x@y.z' }]
  ])('in the %s adds no header or recipient', (_label, change) => {
    const mail = mailOf(change)
    const part = partsOf(mail.link)

    expect(part.address).toBe(SUPPORT_EMAIL)
    expect(part.nameList).toEqual(['subject', 'body'])
    expect(part.value.subject).toBe('[SUP-0042] Review failed (High)')
    expect(mail.link).not.toMatch(/[\r\n]/)
    expect(mail.link.toLowerCase()).not.toMatch(/[?&](bcc|cc|to)=/)
  })

  it('the email and review ID stay on their own body line (CR/LF become a space)', () => {
    const body = partsOf(mailOf({ email: `a@b.co${injection}`, reviewId: `r1${injection}` }).link).value.body

    expect(body).toContain('From: a@b.co Bcc: x@y.z\r\n')
    expect(body).toContain('Review ID: r1 Bcc: x@y.z\r\n')
    expect(body.split('\r\n').filter((line) => line.startsWith('Bcc:'))).toEqual([])
  })

  it('CR/LF is removed from the recipient and the subject', () => {
    const mail = buildSupportMail({ to: `${SUPPORT_EMAIL}\r\nBcc: x@y.z`, ticket: 'SUP-1', request })

    expect(mail.to).not.toMatch(/[\r\n]/)
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(partsOf(mail.link).nameList).toEqual(['subject', 'body'])
    expect(supportMailSubject('SUP-1', request)).toBe('[SUP-1] Review failed (High)')
  })
})

describe('buildSupportMail: the length cap', () => {
  it('a 2 000-character description gives a link of at most 1 800 characters ending with the note', () => {
    const description = 'x'.repeat(1990) + ' end text'
    const mail = mailOf({ description })
    const body = partsOf(mail.link).value.body

    expect(description.length).toBeGreaterThanOrEqual(1999)
    expect(mail.link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(mail.shortened).toBe(true)
    expect(body.endsWith(`\r\n${SUPPORT_MAIL_TEXT.shortened}`)).toBe(true)
    // The head lines stay whole; only the description is cut.
    expect(body.startsWith('Ticket: SUP-0042\r\nIssue type: Review failed\r\n')).toBe(true)
    // Copy message keeps the full text.
    expect(mail.fullBody.endsWith(description)).toBe(true)
  })

  it('cuts multi-byte text by whole characters and still decodes', () => {
    const mail = mailOf({ description: '😀é'.repeat(600) })

    expect(mail.link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(() => partsOf(mail.link)).not.toThrow()
    expect(partsOf(mail.link).value.body).toMatch(/(😀é|😀)\r\n\(shortened; the full text is in the form\)$/u)
  })

  // QA 032 F1: the head lines (sender email, review ID) are shortened too when the description
  // alone cannot make room. Emails here are as long as the backend accepts (254 characters).
  const longAscii = `${'a'.repeat(248)}@b.co`
  const longMultiByte = `${'測'.repeat(240)}@b.co`
  it.each([
    ['a long ASCII email', { email: longAscii, description: 'x'.repeat(2000) }, false],
    ['a multi-byte email', { email: longMultiByte, description: 'x'.repeat(2000) }, true],
    ['a multi-byte email and a short description', { email: longMultiByte, description: 'short but valid text' }, true],
    ['worst case: multi-byte email, long review ID, multi-byte description', { email: longMultiByte, reviewId: 'r'.repeat(2000), description: '😀'.repeat(2000) }, true]
  ])('%s: link at most 1 800, the note kept, Copy message holds the full text', (_label, change, emailCut) => {
    const mail = mailOf(change)
    const part = partsOf(mail.link)

    expect(mail.link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(mail.shortened).toBe(true)
    expect(part.address).toBe(SUPPORT_EMAIL)
    expect(part.nameList).toEqual(['subject', 'body'])
    expect(part.value.subject).toBe('[SUP-0042] Review failed (High)')
    expect(part.value.body.endsWith(`\r\n${SUPPORT_MAIL_TEXT.shortened}`)).toBe(true)
    expect(part.value.body.startsWith('Ticket: SUP-0042\r\nIssue type: Review failed\r\nPriority: High')).toBe(true)
    const fromLine = part.value.body.split('\r\n').find((line) => line.startsWith('From: ')) ?? ''
    if (emailCut) expect(fromLine.endsWith(SUPPORT_MAIL_TEXT.cutMark)).toBe(true)
    else expect(fromLine).toBe(`From: ${change.email}`)
    // Copy message keeps every full value.
    const text = supportMailText(mail)
    expect(text).toContain(`From: ${change.email}\r\n`)
    if ('reviewId' in change) expect(text).toContain(`Review ID: ${change.reviewId}\r\n`)
    expect(text.endsWith(change.description)).toBe(true)
    expect(text).not.toContain(SUPPORT_MAIL_TEXT.shortened)
  })

  it('the worst case cuts the review ID after the email is gone', () => {
    const mail = mailOf({ email: longMultiByte, reviewId: 'r'.repeat(2000), description: '😀'.repeat(2000) })
    const lineList = partsOf(mail.link).value.body.split('\r\n')

    expect(lineList).toContain(`From: ${SUPPORT_MAIL_TEXT.cutMark}`)
    expect(lineList.find((line) => line.startsWith('Review ID: '))).toMatch(/^Review ID: r+…$/)
    expect(lineList.slice(-3)).toEqual(['Description:', '', SUPPORT_MAIL_TEXT.shortened])
  })

  it('a ticket longer than 12 digits is not trusted (it could not fit the cap either)', () => {
    expect(partsOf(mailOf({}, `SUP-${'9'.repeat(2000)}`).link).value.subject).toBe('Review failed (High)')
    expect(partsOf(mailOf({}, 'SUP-123456789012').link).value.subject).toBe('[SUP-123456789012] Review failed (High)')
  })

  it('a link just under the cap is not shortened', () => {
    const mail = mailOf({ description: 'y'.repeat(1400) })
    expect(mail.link.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH)
    expect(mail.shortened).toBe(false)
    expect(partsOf(mail.link).value.body).not.toContain(SUPPORT_MAIL_TEXT.shortened)
  })
})
