// Plan 032: the `mailto:` link that opens the user's mail app with a ready support message.
// A pure function: no DOM, no store. Free text (email, review ID, description) only ever goes into
// the percent-encoded body value; the scheme is a constant, the recipient is the configured
// address and the subject is built from the form's labels and the ticket, so user text can never
// add a header or a recipient.
import type { SupportRequest } from '../types'
import { issueTypeOptionList, priorityOptionList, SUPPORT_MAIL_TEXT, SUPPORT_PRIORITY_SHORT_LABEL } from './help.constants'

export const MAILTO_SCHEME = 'mailto:'
// Many mail apps refuse links over about 2 000 characters.
export const MAILTO_MAX_LENGTH = 1800

const LINE_BREAK = '\r\n'
// A server ticket: SUP and up to 12 digits (a longer one is not trusted, and would not fit the cap).
const ticketPattern = /^SUP-\d{1,12}$/
const lineBreakPattern = /\r\n|\r|\n/g
// A lone UTF-16 surrogate makes encodeURIComponent throw: it becomes U+FFFD.
const loneSurrogatePattern = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export interface SupportMailInput {
  to: string
  // The stored request's ticket (SUP-NNNN), or null when there is none.
  ticket: string | null
  request: SupportRequest
}

export interface SupportMail {
  to: string
  subject: string
  // The body in the link, shortened when the link would be too long.
  body: string
  // The body with the full description (for Copy message).
  fullBody: string
  link: string
  shortened: boolean
}

function wellFormed(value: string): string {
  return value.replace(loneSurrogatePattern, '�')
}

function withoutLineBreak(value: string): string {
  return wellFormed(value).replace(/[\r\n]+/g, ' ').trim()
}

function encode(value: string): string {
  return encodeURIComponent(wellFormed(value))
}

function labelOf<T extends string>(optionList: { value: T; label: string }[], value: T | ''): string {
  return optionList.find((option) => option.value === value)?.label ?? ''
}

function validTicket(ticket: string | null): string | null {
  return ticket && ticketPattern.test(ticket) ? ticket : null
}

export function supportMailSubject(ticket: string | null, request: SupportRequest): string {
  const issue = labelOf(issueTypeOptionList, request.issueType)
  const priority = SUPPORT_PRIORITY_SHORT_LABEL[request.priority] ?? ''
  const valid = validTicket(ticket)
  return withoutLineBreak(`${valid ? `[${valid}] ` : ''}${issue} (${priority})`)
}

interface HeadPart {
  ticket: string | null
  request: SupportRequest
  email: string
  reviewId: string
}

function headLineList({ ticket, request, email, reviewId }: HeadPart): string[] {
  const valid = validTicket(ticket)
  return [
    ...(valid ? [`${SUPPORT_MAIL_TEXT.ticket}: ${valid}`] : []),
    `${SUPPORT_MAIL_TEXT.issueType}: ${labelOf(issueTypeOptionList, request.issueType)}`,
    `${SUPPORT_MAIL_TEXT.priority}: ${labelOf(priorityOptionList, request.priority)}`,
    `${SUPPORT_MAIL_TEXT.from}: ${email}`,
    ...(reviewId ? [`${SUPPORT_MAIL_TEXT.reviewId}: ${reviewId}`] : [])
  ]
}

function bodyOf(headList: string[], description: string, shortened: boolean): string {
  const tail = shortened ? [SUPPORT_MAIL_TEXT.shortened] : []
  return [...headList, '', `${SUPPORT_MAIL_TEXT.description}:`, description, ...tail].join(LINE_BREAK)
}

// The longest prefix (in whole code points, never half a surrogate pair) for which `fits` holds;
// `fits` must hold for a shorter prefix whenever it holds for a longer one.
function longestFitting(text: string, fits: (prefix: string) => boolean): string {
  const codePointList = Array.from(text)
  const prefixOf = (count: number) => codePointList.slice(0, count).join('').trimEnd()
  let low = 0
  let high = codePointList.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(prefixOf(middle))) low = middle
    else high = middle - 1
  }
  return prefixOf(low)
}

// A shortened head value is marked, so support can tell it from the real value.
function cut(value: string, prefix: string): string {
  return prefix === value ? value : `${prefix}${SUPPORT_MAIL_TEXT.cutMark}`
}

export function buildSupportMail({ to, ticket, request }: SupportMailInput): SupportMail {
  const recipient = withoutLineBreak(to)
  const subject = supportMailSubject(ticket, request)
  const email = withoutLineBreak(request.email)
  const reviewId = withoutLineBreak(request.reviewId)
  const description = wellFormed(request.description.trim()).replace(lineBreakPattern, LINE_BREAK)
  // `@` stays literal in the address (RFC 6068), as some mail apps do not decode %40 there.
  const prefix = `${MAILTO_SCHEME}${encode(recipient).replace(/%40/g, '@')}?subject=${encode(subject)}&body=`
  const linkOf = (body: string) => `${prefix}${encode(body)}`
  const fits = (body: string) => linkOf(body).length <= MAILTO_MAX_LENGTH
  const headOf = (emailPart: string, reviewIdPart: string) => headLineList({ ticket, request, email: emailPart, reviewId: reviewIdPart })
  const shortBody = (head: string[], text: string) => bodyOf(head, text, true)

  const fullBody = bodyOf(headOf(email, reviewId), description, false)
  if (fits(fullBody)) {
    return { to: recipient, subject, body: fullBody, fullBody, link: linkOf(fullBody), shortened: false }
  }
  const done = (body: string) => ({ to: recipient, subject, body, fullBody, link: linkOf(body), shortened: true })

  // 1. Cut the description to the longest that fits.
  const fullHead = headOf(email, reviewId)
  if (fits(shortBody(fullHead, ''))) {
    return done(shortBody(fullHead, longestFitting(description, (text) => fits(shortBody(fullHead, text)))))
  }

  // QA 032 F1: a long (or multi-byte) email or review ID alone can exceed the cap. With no room
  // left for the description, 2. cut the sender email, then 3. the review ID. The recipient,
  // subject and labels are never cut (they are short and fixed). Copy message keeps the full text.
  const withEmail = (emailPart: string) => shortBody(headOf(cut(email, emailPart), reviewId), '')
  if (fits(withEmail(''))) {
    return done(withEmail(longestFitting(email, (emailPart) => fits(withEmail(emailPart)))))
  }
  const withReviewId = (reviewIdPart: string) => shortBody(headOf(cut(email, ''), cut(reviewId, reviewIdPart)), '')
  return done(withReviewId(longestFitting(reviewId, (reviewIdPart) => fits(withReviewId(reviewIdPart)))))
}

// What Copy message puts on the clipboard: the subject, then the full body.
export function supportMailText(mail: SupportMail): string {
  return `${mail.subject}${LINE_BREAK}${LINE_BREAK}${mail.fullBody}`
}
