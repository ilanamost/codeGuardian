import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import GithubSignInButton from '../components/GithubSignInButton'
import PasswordChecklist from '../components/PasswordChecklist'
import PasswordField from '../components/PasswordField'
import SignInLayout from '../components/SignInLayout'
import TextField from '../components/TextField'
import { ROUTE_PATH } from '../lib/route.constants'
import { SESSION_TEXT } from '../lib/session.constants'
import {
  hasFieldError,
  registerFieldErrorOf,
  registerMessageOf,
  validateRegistration,
  type RegistrationFieldError,
  type RegistrationInput
} from '../lib/sessionForm'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { register, registerErrorCleared, selectSession } from '../store/session.slice'

const emptyInput: RegistrationInput = { username: '', email: '', password: '', confirmPassword: '' }

// /register (plan 028): user name, email, password and confirm password, with
// the password rules as a live checklist. Confirm password is checked here and never sent. A
// successful registration signs the user in (Open Question 6), and the SignedOutOnly wrapper
// sends them to the page they asked for, or `/`.
export default function RegisterPage() {
  const dispatch = useAppDispatch()
  const location = useLocation()
  const checklistId = useId()
  const { registerStatus, registerError } = useAppSelector(selectSession)
  const [input, setInput] = useState<RegistrationInput>(emptyInput)
  const [fieldError, setFieldError] = useState<RegistrationFieldError>({})
  const pending = registerStatus === 'loading'
  const message = registerMessageOf(registerError)
  const serverField = registerFieldErrorOf(registerError).field

  useEffect(() => () => {
    dispatch(registerErrorCleared())
  }, [dispatch])

  function edit(field: keyof RegistrationInput) {
    return (value: string) => {
      setInput((current) => ({ ...current, [field]: value }))
      if (fieldError[field]) setFieldError((current) => ({ ...current, [field]: undefined }))
      if (registerError) dispatch(registerErrorCleared())
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const error = validateRegistration(input)
    setFieldError(error)
    if (hasFieldError(error)) return
    await dispatch(register({ username: input.username.trim(), email: input.email.trim(), password: input.password }))
  }

  return (
    <SignInLayout title={SESSION_TEXT.registerTitle} subtitle={SESSION_TEXT.registerSubtitle}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate aria-label={SESSION_TEXT.registerTitle}>
        <TextField
          label={SESSION_TEXT.username}
          value={input.username}
          onChange={edit('username')}
          autoComplete="username"
          error={fieldError.username ?? serverField.username}
        />
        <TextField
          label={SESSION_TEXT.email}
          type="email"
          value={input.email}
          onChange={edit('email')}
          autoComplete="email"
          error={fieldError.email ?? serverField.email}
        />
        <PasswordField
          label={SESSION_TEXT.password}
          value={input.password}
          onChange={edit('password')}
          autoComplete="new-password"
          error={fieldError.password ?? serverField.password}
          describedBy={checklistId}
        />
        <PasswordChecklist id={checklistId} password={input.password} owner={{ username: input.username, email: input.email }} />
        <PasswordField
          label={SESSION_TEXT.confirmPassword}
          value={input.confirmPassword}
          onChange={edit('confirmPassword')}
          autoComplete="new-password"
          error={fieldError.confirmPassword}
        />
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
          <UserPlus size={16} aria-hidden="true" />
          {pending ? SESSION_TEXT.registering : SESSION_TEXT.register}
        </button>
      </form>
      <GithubSignInButton />
      <p className="text-sm text-text-muted">
        {SESSION_TEXT.haveAccount}{' '}
        <Link to={ROUTE_PATH.login} state={location.state} className="font-medium text-primary hover:text-primary-hover">
          {SESSION_TEXT.backToSignIn}
        </Link>
      </p>
    </SignInLayout>
  )
}
