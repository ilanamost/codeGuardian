import type { PasswordRuleId } from './password-rule'

// Login, register and session texts (plan 028). Error texts live in utils/error-messages.ts.
export const SESSION_TEXT = {
  checking: 'Checking your session...',
  retry: 'Retry',
  appName: 'CodeGuardian',
  signInTitle: 'Sign in',
  signInSubtitle: 'Sign in to review your code.',
  username: 'User name',
  password: 'Password',
  email: 'Email address',
  confirmPassword: 'Confirm password',
  signIn: 'Sign in',
  signingIn: 'Signing in...',
  noAccount: 'New here?',
  createAccount: 'Create an account',
  registerTitle: 'Create an account',
  registerSubtitle: 'Create an account to start reviewing code.',
  register: 'Create account',
  registering: 'Creating account...',
  haveAccount: 'Already have an account?',
  backToSignIn: 'Sign in',
  passwordRuleHeading: 'Your password must have:',
  ruleMet: 'met',
  ruleNotMet: 'not met',
  // Plan 040: GitHub sign-in.
  continueWithGithub: 'Continue with GitHub',
  orDivider: 'or'
} as const

// Plan 040 (contract 0.15.0): the `auth_error` codes the backend redirects to /login with, and
// one fixed message per code. A code outside the list is read as provider_error.
export const AUTH_ERROR_PARAM = 'auth_error'

export const AUTH_ERROR_CODE_LIST = [
  'invalid_state',
  'access_denied',
  'provider_error',
  'email_unverified',
  'email_in_use',
  'identity_in_use',
  'rate_limited'
] as const

export type AuthErrorCode = (typeof AUTH_ERROR_CODE_LIST)[number]

export const AUTH_ERROR_TEXT: Record<AuthErrorCode, string> = {
  invalid_state: 'The GitHub sign-in expired or was not started here. Please try again.',
  access_denied: 'GitHub sign-in was cancelled. You can try again or sign in with your password.',
  provider_error: 'GitHub could not be reached. Please try again later or sign in with your password.',
  email_unverified: 'Your GitHub account has no verified email address. Verify it on GitHub and try again.',
  email_in_use: 'An account with this email already exists. Sign in with your password, then link GitHub in Settings > Account.',
  identity_in_use: 'This GitHub account is already linked to another account.',
  rate_limited: 'Too many sign-in attempts. Please wait a moment and try again.'
}

// The live checklist of the register form, one line per password rule.
export const PASSWORD_RULE_LABEL: Record<PasswordRuleId, string> = {
  length: '8 to 200 characters',
  letterDigit: 'At least one letter and one digit',
  personal: 'Not your user name or email address',
  common: 'Not a common password'
}
