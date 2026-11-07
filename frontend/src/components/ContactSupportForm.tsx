import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'
import CopyButton from './CopyButton'
import RadioGroup from './RadioGroup'
import { descriptionMax, validateSupportRequest } from '../lib/validateSupportRequest'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { selectSupport, submitSupportRequest, supportReset } from '../store/support.slice'
import { defaultSupportPriority, issueTypeOptionList, priorityOptionList, SUPPORT_EMAIL, SUPPORT_MESSAGE } from '../lib/help.constants'
import { openMailApp } from '../lib/openMailApp'
import { buildSupportMail, supportMailText, type SupportMail } from '../lib/supportMailto'
import { useAccount } from '../lib/useAccount'
import type { IssueType, SupportErrors, SupportPriority, SupportRequest } from '../types'

// The email starts as the account's (GET /api/account) once it has loaded.
function emptyRequest(email = ''): SupportRequest {
  return { issueType: '', email, reviewId: '', priority: defaultSupportPriority, description: '' }
}

const inputClass =
  'w-full rounded-md border border-input-border bg-surface px-3 py-2 text-base sm:text-sm outline-none focus:outline-2 focus:outline-primary'

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-critical">
      {message}
    </p>
  )
}

export default function ContactSupportForm() {
  const { account } = useAccount()
  const accountEmail = account?.email ?? ''
  const [request, setRequest] = useState<SupportRequest>(() => emptyRequest(accountEmail))
  const [touched, setTouched] = useState<Partial<Record<keyof SupportRequest, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const dispatch = useAppDispatch()
  const { status, ticket } = useAppSelector(selectSupport)
  // Plan 032: the message the mail app was opened with (for the copy buttons).
  const [mail, setMail] = useState<SupportMail | null>(null)
  // QA 031 F4: a second click or Enter before the first submit finished does nothing.
  const submittingRef = useRef(false)
  const sending = status === 'loading'

  // The account can arrive after the first render: fill the email unless the user typed one.
  useEffect(() => {
    if (accountEmail) setRequest((current) => (current.email ? current : { ...current, email: accountEmail }))
  }, [accountEmail])

  // A ticket from an earlier visit is not shown again.
  useEffect(() => {
    dispatch(supportReset())
    return () => {
      dispatch(supportReset())
    }
  }, [dispatch])

  const allError = validateSupportRequest(request)
  const error: SupportErrors = {}
  for (const key of Object.keys(allError) as (keyof SupportRequest)[]) {
    if (submitted || touched[key]) error[key] = allError[key]
  }

  function update<K extends keyof SupportRequest>(key: K, value: SupportRequest[K]) {
    setRequest((current) => ({ ...current, [key]: value }))
    // The outcome (and its copy buttons) belongs to the submitted values: editing hides it.
    if (ticket) dispatch(supportReset())
    setMail(null)
  }

  function blur(key: keyof SupportRequest) {
    setTouched((current) => ({ ...current, [key]: true }))
  }

  // Plan 032: store the request (ticket), then open the user's mail app once with a ready message.
  // The app sends nothing itself. A failure (also a 429) is reported by the store (error toast).
  // The form keeps its values either way.
  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(allError).length > 0 || submittingRef.current) return
    submittingRef.current = true
    try {
      const result = await dispatch(submitSupportRequest(request))
      if (!submitSupportRequest.fulfilled.match(result)) return
      const newMail = buildSupportMail({ to: SUPPORT_EMAIL, ticket: result.payload.ticket, request })
      setMail(newMail)
      toast.success(SUPPORT_MESSAGE.outcome(result.payload.ticket))
      openMailApp(newMail.link)
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Contact Support</h2>
      <p className="mb-6 text-sm text-text-muted">Tell us what went wrong and we'll help you resolve it.</p>
      {ticket && mail && (
        <div className="mb-6 flex flex-col gap-3 rounded-md border border-border bg-primary-soft p-3 text-sm text-text">
          <p role="status" className="flex items-start gap-2 font-medium">
            <Mail size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {SUPPORT_MESSAGE.outcome(ticket)}
          </p>
          <p>
            {SUPPORT_MESSAGE.addressLabel}{' '}
            <span data-testid="support-address" className="font-semibold break-all">
              {mail.to}
            </span>
          </p>
          <p className="text-text-muted">{SUPPORT_MESSAGE.noMailApp}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={supportMailText(mail)} label={SUPPORT_MESSAGE.copyMessage} variant="soft" successMessage={SUPPORT_MESSAGE.messageCopied} />
            <CopyButton text={mail.to} label={SUPPORT_MESSAGE.copyAddress} variant="soft" successMessage={SUPPORT_MESSAGE.addressCopied} />
          </div>
        </div>
      )}
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div onBlur={() => blur('issueType')}>
          <RadioGroup<IssueType | ''>
            legend="Issue type"
            name="issue-type"
            optionList={issueTypeOptionList}
            value={request.issueType}
            onChange={(value) => update('issueType', value)}
          />
          <FieldError id="issue-type-error" message={error.issueType} />
        </div>

        <div>
          <label htmlFor="support-email" className="mb-1 block text-sm font-semibold">
            Email address
          </label>
          <input
            id="support-email"
            type="email"
            autoComplete="email"
            value={request.email}
            aria-invalid={Boolean(error.email)}
            aria-describedby={error.email ? 'support-email-error' : undefined}
            onChange={(event) => update('email', event.target.value)}
            onBlur={() => blur('email')}
            className={inputClass}
          />
          <FieldError id="support-email-error" message={error.email} />
        </div>

        <div>
          <label htmlFor="support-review-id" className="mb-1 block text-sm font-semibold">
            Review ID (optional)
          </label>
          <input
            id="support-review-id"
            type="text"
            value={request.reviewId}
            aria-invalid={Boolean(error.reviewId)}
            aria-describedby={error.reviewId ? 'support-review-id-error' : 'support-review-id-hint'}
            onChange={(event) => update('reviewId', event.target.value)}
            onBlur={() => blur('reviewId')}
            className={inputClass}
          />
          <p id="support-review-id-hint" className="mt-1 text-xs text-text-muted">
            Helps support locate the affected review.
          </p>
          <FieldError id="support-review-id-error" message={error.reviewId} />
        </div>

        <RadioGroup<SupportPriority>
          legend="Priority"
          name="priority"
          optionList={priorityOptionList}
          value={request.priority}
          onChange={(value) => update('priority', value)}
        />

        <div>
          <label htmlFor="support-description" className="mb-1 block text-sm font-semibold">
            Describe the problem
          </label>
          <textarea
            id="support-description"
            rows={5}
            maxLength={descriptionMax + 500}
            value={request.description}
            aria-invalid={Boolean(error.description)}
            aria-describedby={error.description ? 'support-description-error' : undefined}
            onChange={(event) => update('description', event.target.value)}
            onBlur={() => blur('description')}
            className={inputClass}
          />
          <FieldError id="support-description-error" message={error.description} />
        </div>

        <button
          type="submit"
          disabled={sending}
          aria-busy={sending}
          className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {sending ? 'Submitting...' : 'Submit request'}
        </button>
      </form>
    </div>
  )
}
