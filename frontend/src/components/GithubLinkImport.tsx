import { useState, type FormEvent } from 'react'
import { Link } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { GITHUB_LINK_TEXT } from '../lib/github.constants'
import { ROUTE_PATH } from '../lib/route.constants'
import { useMounted } from '../lib/useMounted'
import { parseGithubLink } from '../models/github.model'
import { importGithubLink, selectGithub } from '../store/github.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { FORM_ERROR_MESSAGE } from '../utils/error-messages'

const inputId = 'github-link'
const errorId = 'github-link-error'
const hintId = 'github-link-hint'

function linkError(value: string): string | undefined {
  if (!value.trim()) return FORM_ERROR_MESSAGE.githubLinkRequired
  return parseGithubLink(value) ? undefined : FORM_ERROR_MESSAGE.githubLinkInvalid
}

// "Paste a GitHub link" (plan 023): imports a public file or pull request without a GitHub
// connection. The link's shape is checked here first; the import opens the code in the editor
// as a new, unsaved review, like the wizard's Import. Failures are toasts (store listener).
export default function GithubLinkImport() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const mounted = useMounted()
  const { linkImportStatus } = useAppSelector(selectGithub)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const importing = linkImportStatus === 'loading'

  function change(next: string) {
    setValue(next)
    // Once shown, the field error follows the text, so it clears as soon as the link is fixed.
    if (error) setError(linkError(next))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (importing) return
    const issue = linkError(value)
    setError(issue)
    if (issue) return
    const result = await dispatch(importGithubLink(value.trim()))
    if (!importGithubLink.fulfilled.match(result)) return
    toast.success(GITHUB_LINK_TEXT.imported(result.payload), { description: GITHUB_LINK_TEXT.importedDetail(result.payload) })
    // A user who left the page while the code loaded stays where they went.
    if (mounted.current) navigate(ROUTE_PATH.newReview)
  }

  return (
    <section aria-labelledby="github-link-title" className="mb-6 rounded-md border border-border bg-card p-4 shadow-card md:p-6">
      <h2 id="github-link-title" className="text-base font-bold">
        {GITHUB_LINK_TEXT.title}
      </h2>
      <p id={hintId} className="mb-4 text-sm text-text-muted">
        {GITHUB_LINK_TEXT.description} {GITHUB_LINK_TEXT.limit}
      </p>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3 xs:flex-row xs:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            {GITHUB_LINK_TEXT.label}
          </label>
          <div className="relative">
            <Link size={16} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
            <input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value}
              placeholder={GITHUB_LINK_TEXT.placeholder}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              onChange={(event) => change(event.target.value)}
              className="w-full rounded-md border border-input-border bg-surface py-2 pr-3 pl-9 text-base sm:text-sm outline-none focus:outline-2 focus:outline-primary aria-invalid:border-critical"
            />
          </div>
          {error && (
            <p id={errorId} role="alert" className="mt-1 text-xs break-words text-critical">
              {error}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={importing}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? GITHUB_LINK_TEXT.importing : GITHUB_LINK_TEXT.import}
        </button>
      </form>
    </section>
  )
}
