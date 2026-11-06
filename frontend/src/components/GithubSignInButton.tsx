import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { GitBranch } from 'lucide-react'
import { githubSignInUrl } from '../lib/github-signin'
import { redirectTargetOf } from '../lib/route.constants'
import { SESSION_TEXT } from '../lib/session.constants'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { fetchGithubSignIn, selectGithubSignIn } from '../store/session.slice'

// Plan 040: "Continue with GitHub" under the login and register forms. A plain link to the
// backend (the browser navigates; this is not a fetch), shown only when GET /api/health says
// GitHub sign-in is configured. The page the guard kept is sent along as `returnTo`.
export default function GithubSignInButton() {
  const dispatch = useAppDispatch()
  const location = useLocation()
  const enabled = useAppSelector(selectGithubSignIn)

  useEffect(() => {
    dispatch(fetchGithubSignIn())
  }, [dispatch])

  if (!enabled) return null

  return (
    <>
      <div className="flex items-center gap-3 text-xs text-text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {SESSION_TEXT.orDivider}
        <span className="h-px flex-1 bg-border" />
      </div>
      <a
        href={githubSignInUrl(redirectTargetOf(location.state))}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-page-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <GitBranch size={16} aria-hidden="true" />
        {SESSION_TEXT.continueWithGithub}
      </a>
    </>
  )
}
