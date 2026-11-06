import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import GithubSignInButton from '../components/GithubSignInButton'
import PasswordField from '../components/PasswordField'
import SignInLayout from '../components/SignInLayout'
import TextField from '../components/TextField'
import { HTTP_STATUS } from '../lib/api.constants'
import { useAuthError } from '../lib/github-signin'
import { ROUTE_PATH } from '../lib/route.constants'
import { AUTH_ERROR_TEXT, SESSION_TEXT } from '../lib/session.constants'
import { signInMessageOf, validateSignIn, type SignInFieldError } from '../lib/sessionForm'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { selectSession, signIn, signInErrorCleared } from '../store/session.slice'

// /login (plan 028). After sign-in the guard's SignedOutOnly wrapper sends the
// user to the page they asked for.
export default function LoginPage() {
  const dispatch = useAppDispatch()
  const location = useLocation()
  const { signInStatus, signInError } = useAppSelector(selectSession)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldError, setFieldError] = useState<SignInFieldError>({})
  const pending = signInStatus === 'loading'
  const message = signInMessageOf(signInError)
  // Plan 040: a failed GitHub sign-in comes back as /login?auth_error=<code>.
  const authError = useAuthError()

  // An answer of an earlier visit no longer applies.
  useEffect(() => () => {
    dispatch(signInErrorCleared())
  }, [dispatch])

  function edit(setValue: (value: string) => void, field: keyof SignInFieldError) {
    return (value: string) => {
      setValue(value)
      if (fieldError[field]) setFieldError((current) => ({ ...current, [field]: undefined }))
      if (signInError) dispatch(signInErrorCleared())
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const error = validateSignIn(username, password)
    setFieldError(error)
    if (error.username || error.password) return
    const result = await dispatch(signIn({ username: username.trim(), password }))
    if (signIn.rejected.match(result) && result.payload?.status === HTTP_STATUS.unauthorized) setPassword('')
  }

  return (
    <SignInLayout title={SESSION_TEXT.signInTitle} subtitle={SESSION_TEXT.signInSubtitle}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate aria-label={SESSION_TEXT.signInTitle}>
        <TextField
          label={SESSION_TEXT.username}
          value={username}
          onChange={edit(setUsername, 'username')}
          autoComplete="username"
          error={fieldError.username}
        />
        <PasswordField
          label={SESSION_TEXT.password}
          value={password}
          onChange={edit(setPassword, 'password')}
          autoComplete="current-password"
          error={fieldError.password}
        />
        {authError && !message && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-error-text">
            {AUTH_ERROR_TEXT[authError]}
          </p>
        )}
        {message && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-error-text">
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          <LogIn size={16} aria-hidden="true" />
          {pending ? SESSION_TEXT.signingIn : SESSION_TEXT.signIn}
        </button>
      </form>
      <GithubSignInButton />
      <p className="text-sm text-text-muted">
        {SESSION_TEXT.noAccount}{' '}
        <Link to={ROUTE_PATH.register} state={location.state} className="font-medium text-primary hover:text-primary-hover">
          {SESSION_TEXT.createAccount}
        </Link>
      </p>
    </SignInLayout>
  )
}
