import { GITHUB_IMPORT_LIMIT, isGithubImportLimitName, type GithubImportLimitName } from '../lib/github.constants'

// Every user-facing error text lives here (plan 016). Services and components refer to these
// constants; tests/unit/architecture.test.ts fails when an error string is hard-coded elsewhere.
// Wording follows the Help page "Error messages" table (lib/help.constants.ts).

export const ERROR_CODE = {
  network: 'network',
  timeout: 'timeout',
  abort: 'abort',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  validation: 'validation',
  conflict: 'conflict',
  payloadTooLarge: 'payload_too_large',
  rateLimited: 'rate_limited',
  // GitHub link import only (contract 0.7.0): GitHub failed or did not answer in time.
  upstreamError: 'upstream_error',
  upstreamTimeout: 'upstream_timeout',
  server: 'server',
  parse: 'parse',
  storage: 'storage',
  reviewLoad: 'review_load',
  reviewSave: 'review_save',
  reviewDelete: 'review_delete',
  reviewRename: 'review_rename',
  reviewCreate: 'review_create',
  reviewRun: 'review_run',
  reportPdf: 'report_pdf',
  testRegenerate: 'test_regenerate',
  dashboardLoad: 'dashboard_load',
  githubConnect: 'github_connect',
  githubRepoLoad: 'github_repo_load',
  githubFileLoad: 'github_file_load',
  githubDisconnect: 'github_disconnect',
  githubFileImport: 'github_file_import',
  githubLinkImport: 'github_link_import',
  accountLoad: 'account_load',
  passwordChange: 'password_change',
  // Plan 034: PUT /api/account (user name and email).
  accountUpdate: 'account_update',
  signOut: 'sign_out',
  // Plan 028: session restore, sign-in, registration and the profile photo.
  sessionRestore: 'session_restore',
  signIn: 'sign_in',
  register: 'register',
  avatarUpload: 'avatar_upload',
  avatarRemove: 'avatar_remove',
  // Plan 040: link and unlink GitHub sign-in (Settings > Account).
  githubSignInLink: 'github_sign_in_link',
  githubSignInUnlink: 'github_sign_in_unlink',
  settingsLoad: 'settings_load',
  settingsSave: 'settings_save',
  supportSubmit: 'support_submit',
  clipboard: 'clipboard',
  fileType: 'file_type',
  fileSize: 'file_size',
  fileEmpty: 'file_empty',
  // Plan 032: the editor's syntax check could not load (its WebAssembly files).
  syntaxCheck: 'syntax_check',
  unknown: 'unknown'
} as const

export type ErrorCodeKey = keyof typeof ERROR_CODE
export type ErrorCode = (typeof ERROR_CODE)[ErrorCodeKey]

// Complete messages for failures that are not tied to one action, and the first sentence of
// action messages (`reviewSave` etc.), which get a recovery hint appended (see ERROR_HINT).
export const ERROR_MESSAGE: Record<ErrorCodeKey, string> = {
  network: 'Could not reach the server. Check your internet connection and try again.',
  timeout: 'Request timed out. Retry and check your connection.',
  abort: 'The request was cancelled.',
  unauthorized: 'Unauthorized. Sign in again.',
  forbidden: 'You do not have access to this item.',
  notFound: 'Not found. It may have been deleted.',
  validation: 'The request was rejected as invalid. Check your input and try again.',
  conflict: 'This item was changed elsewhere. Refresh and try again.',
  payloadTooLarge: 'The request is too large. Shorten the code and try again.',
  rateLimited: 'Too many requests. Wait a moment and try again.',
  upstreamError: 'GitHub is unavailable or sent an unexpected answer. Try again later.',
  upstreamTimeout: 'GitHub took too long to answer. Try again.',
  server: 'Something went wrong on the server. Please try again.',
  parse: 'Received an unexpected response. Please try again.',
  storage: 'Browser storage is unavailable, check your browser settings and try again.',
  reviewLoad: 'Could not load the review.',
  reviewSave: 'Could not save the review.',
  reviewDelete: 'Could not delete the review.',
  reviewRename: 'Could not rename the review.',
  reviewCreate: 'Could not start the review.',
  reviewRun: 'Could not run the review.',
  reportPdf: 'Could not create the PDF report.',
  testRegenerate: 'Could not regenerate the tests.',
  dashboardLoad: 'Could not load the dashboard.',
  githubConnect: 'GitHub authorization failed.',
  githubRepoLoad: 'Could not load your GitHub repositories.',
  githubFileLoad: 'Could not load the repository files.',
  githubDisconnect: 'Could not switch the GitHub account.',
  githubFileImport: 'Could not import the file.',
  githubLinkImport: 'Could not import the GitHub link.',
  accountLoad: 'Could not load your account.',
  passwordChange: 'Could not update your password.',
  accountUpdate: 'Could not update your account.',
  signOut: 'Could not sign out.',
  sessionRestore: 'Could not check your session.',
  signIn: 'Could not sign in.',
  register: 'Could not create the account.',
  avatarUpload: 'Could not upload the photo.',
  avatarRemove: 'Could not remove the photo.',
  githubSignInLink: 'Could not start GitHub sign-in.',
  githubSignInUnlink: 'Could not remove GitHub sign-in.',
  settingsLoad: 'Could not load your settings.',
  settingsSave: 'Could not save your settings.',
  supportSubmit: 'Could not submit your request.',
  clipboard: 'Could not copy to clipboard',
  // A code file the editor rejects (plan 021). The first two are the Help error table's message
  // and action (lib/help.constants.ts errorList).
  fileType: 'Unsupported file type. Upload a supported source-code file.',
  fileSize: 'File size exceeds limit. Reduce the file size or submit a smaller snippet.',
  fileEmpty: 'The file is empty. Choose a file that contains code.',
  syntaxCheck: 'Syntax errors cannot be shown right now. The editor still works.',
  unknown: 'Something went wrong. Retry, and if it persists, contact support.'
}

// Recovery hints appended to action messages, chosen by what failed underneath.
export const ERROR_HINT = {
  storage: ERROR_MESSAGE.storage,
  network: 'Check your internet connection and try again.',
  timeout: 'The request timed out, please try again.',
  unauthorized: 'Sign in again.',
  forbidden: 'You do not have permission to do this.',
  notFound: 'It may have been deleted.',
  validation: 'Check your input and try again.',
  conflict: 'It was changed elsewhere, refresh and try again.',
  payloadTooLarge: 'It is too large, shorten it and try again.',
  rateLimited: 'Too many requests, wait a moment and try again.',
  upstreamError: 'GitHub is unavailable or sent an unexpected answer, try again later.',
  upstreamTimeout: 'GitHub took too long to answer, please try again.',
  server: 'The server had a problem, please try again shortly.',
  parse: 'The server sent an unexpected response, please try again.',
  retry: 'Please try again.'
} as const

const hintByCause: Partial<Record<ErrorCode, string>> = {
  storage: ERROR_HINT.storage,
  network: ERROR_HINT.network,
  timeout: ERROR_HINT.timeout,
  unauthorized: ERROR_HINT.unauthorized,
  forbidden: ERROR_HINT.forbidden,
  not_found: ERROR_HINT.notFound,
  validation: ERROR_HINT.validation,
  conflict: ERROR_HINT.conflict,
  payload_too_large: ERROR_HINT.payloadTooLarge,
  rate_limited: ERROR_HINT.rateLimited,
  upstream_error: ERROR_HINT.upstreamError,
  upstream_timeout: ERROR_HINT.upstreamTimeout,
  server: ERROR_HINT.server,
  parse: ERROR_HINT.parse
}

const keyByCode = Object.fromEntries(Object.entries(ERROR_CODE).map(([key, code]) => [code, key])) as Record<
  ErrorCode,
  ErrorCodeKey
>

// The ERROR_CODE to message map.
export const MESSAGE_BY_CODE = Object.fromEntries(
  Object.entries(ERROR_CODE).map(([key, code]) => [code, ERROR_MESSAGE[key as ErrorCodeKey]])
) as Record<ErrorCode, string>

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(keyByCode, value)
}

// Codes that name an action ("Could not save the review.") rather than a cause.
const actionCodeList: ErrorCode[] = [
  ERROR_CODE.reviewLoad,
  ERROR_CODE.reviewSave,
  ERROR_CODE.reviewDelete,
  ERROR_CODE.reviewRename,
  ERROR_CODE.reviewCreate,
  ERROR_CODE.reviewRun,
  ERROR_CODE.reportPdf,
  ERROR_CODE.testRegenerate,
  ERROR_CODE.dashboardLoad,
  ERROR_CODE.githubConnect,
  ERROR_CODE.githubRepoLoad,
  ERROR_CODE.githubFileLoad,
  ERROR_CODE.githubDisconnect,
  ERROR_CODE.githubFileImport,
  ERROR_CODE.githubLinkImport,
  ERROR_CODE.accountLoad,
  ERROR_CODE.passwordChange,
  ERROR_CODE.accountUpdate,
  ERROR_CODE.signOut,
  ERROR_CODE.sessionRestore,
  ERROR_CODE.signIn,
  ERROR_CODE.register,
  ERROR_CODE.avatarUpload,
  ERROR_CODE.avatarRemove,
  ERROR_CODE.githubSignInLink,
  ERROR_CODE.githubSignInUnlink,
  ERROR_CODE.settingsLoad,
  ERROR_CODE.settingsSave,
  ERROR_CODE.supportSubmit
]

export function isActionCode(code: ErrorCode): boolean {
  return actionCodeList.includes(code)
}

const formatCount = (value: number) => value.toLocaleString('en-US')

// Hints of a failed GitHub link import that say more than the general ones (ERROR_HINT).
export const GITHUB_LINK_HINT = {
  notFound: 'The repository, file or pull request was not found or is private.',
  validation: 'Use a public file link with a supported language, or a pull request link.',
  rateLimited: "GitHub's limit of requests without sign-in is used up. Try again in an hour.",
  limit: {
    fileChar: `A file is over ${formatCount(GITHUB_IMPORT_LIMIT.fileChar)} characters.`,
    totalChar: `The code is over ${formatCount(GITHUB_IMPORT_LIMIT.totalChar)} characters in total.`,
    fileCount: `The pull request changes more than ${formatCount(GITHUB_IMPORT_LIMIT.fileCount)} files.`
  } satisfies Record<GithubImportLimitName, string>
} as const

const githubLinkHintByCause: Partial<Record<ErrorCode, string>> = {
  not_found: GITHUB_LINK_HINT.notFound,
  validation: GITHUB_LINK_HINT.validation,
  rate_limited: GITHUB_LINK_HINT.rateLimited
}

// Hints of a failed GitHub Integration wizard step (plan 030, contract 0.9.0) that say more than
// the general ones: an unknown user name, no connected account (409) and GitHub's rate limit.
export const GITHUB_WIZARD_HINT = {
  userNotFound: 'No GitHub user has this name. Check the spelling and try again.',
  usernameInvalid: 'Use a GitHub user name: letters, digits and single hyphens.',
  notConnected: 'No GitHub account is connected. Connect one and try again.',
  repoNotFound: 'The repository or file was not found or is private.',
  rateLimited: GITHUB_LINK_HINT.rateLimited,
  fileChar: GITHUB_LINK_HINT.limit.fileChar
} as const

const githubWizardHintByCode: Partial<Record<ErrorCode, Partial<Record<ErrorCode, string>>>> = {
  github_connect: {
    not_found: GITHUB_WIZARD_HINT.userNotFound,
    validation: GITHUB_WIZARD_HINT.usernameInvalid,
    rate_limited: GITHUB_WIZARD_HINT.rateLimited
  },
  github_repo_load: {
    conflict: GITHUB_WIZARD_HINT.notConnected,
    rate_limited: GITHUB_WIZARD_HINT.rateLimited
  },
  github_file_load: {
    conflict: GITHUB_WIZARD_HINT.notConnected,
    not_found: GITHUB_WIZARD_HINT.repoNotFound,
    rate_limited: GITHUB_WIZARD_HINT.rateLimited
  },
  github_file_import: {
    conflict: GITHUB_WIZARD_HINT.notConnected,
    not_found: GITHUB_WIZARD_HINT.repoNotFound,
    rate_limited: GITHUB_WIZARD_HINT.rateLimited,
    payload_too_large: GITHUB_WIZARD_HINT.fileChar
  }
}

// Hints of a refused profile photo (plan 028): the size limit and the accepted types.
export const AVATAR_HINT = {
  payloadTooLarge: 'The photo is over 2 MB. Choose a smaller image.',
  validation: 'Use a PNG, JPEG or WebP image.'
} as const

const avatarHintByCause: Partial<Record<ErrorCode, string>> = {
  payload_too_large: AVATAR_HINT.payloadTooLarge,
  validation: AVATAR_HINT.validation,
  file_type: AVATAR_HINT.validation,
  file_empty: AVATAR_HINT.validation,
  file_size: AVATAR_HINT.payloadTooLarge
}

// The wait a 429 names (`details.retryAfterSecond`), in seconds below a minute, else in minutes.
function waitText(second: number): string {
  if (second < 60) return `${second} second${second === 1 ? '' : 's'}`
  const minute = Math.ceil(second / 60)
  return `${minute} minute${minute === 1 ? '' : 's'}`
}

// Plan 031: the hint of a refused support request (429, 5 per account per hour, contract 0.10.0).
export const SUPPORT_HINT = {
  rateLimited: (second?: number) =>
    second ? `Too many support requests. Try again in ${waitText(second)}.` : 'Too many support requests. Try again later.'
} as const

// Plan 039: hints of the actions that run an analysis (contract 0.14.0). A 429 is the account's
// hourly analysis quota; `resetAt` (ISO date-time) is when it frees up. Regenerate also answers
// 502 and 504 when the AI service fails or takes too long.
export const ANALYSIS_HINT = {
  quota: (resetAt?: string) => {
    const time = resetAt ? timeText(resetAt) : undefined
    return time ? `Your hourly limit of AI reviews is used up. Try again after ${time}.` : 'Your hourly limit of AI reviews is used up. Try again later.'
  },
  upstreamError: 'The AI service is busy or unreachable. Try again in a minute.',
  upstreamTimeout: 'The AI service took too long to answer. Try again.'
} as const

// The local clock time of an ISO date-time ("2:35 PM"), or undefined when it does not parse.
function timeText(iso: string): string | undefined {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const analysisActionList: ErrorCode[] = [ERROR_CODE.reviewCreate, ERROR_CODE.reviewRun, ERROR_CODE.testRegenerate]

function analysisHintFor(code: ErrorCode, cause?: ErrorCode, resetAt?: string): string | undefined {
  if (!analysisActionList.includes(code)) return undefined
  if (cause === ERROR_CODE.rateLimited) return ANALYSIS_HINT.quota(resetAt)
  if (code !== ERROR_CODE.testRegenerate) return undefined
  if (cause === ERROR_CODE.upstreamError) return ANALYSIS_HINT.upstreamError
  if (cause === ERROR_CODE.upstreamTimeout) return ANALYSIS_HINT.upstreamTimeout
  return undefined
}

function hintFor(code: ErrorCode, cause?: ErrorCode, limit?: string, retryAfterSecond?: number, resetAt?: string): string {
  const analysisHint = analysisHintFor(code, cause, resetAt)
  if (analysisHint) return analysisHint
  if (code === ERROR_CODE.supportSubmit && cause === ERROR_CODE.rateLimited) return SUPPORT_HINT.rateLimited(retryAfterSecond)
  if (code === ERROR_CODE.avatarUpload && cause && avatarHintByCause[cause]) return avatarHintByCause[cause]
  if (code === ERROR_CODE.githubLinkImport && cause) {
    if (cause === ERROR_CODE.payloadTooLarge && isGithubImportLimitName(limit)) return GITHUB_LINK_HINT.limit[limit]
    const hint = githubLinkHintByCause[cause]
    if (hint) return hint
  }
  const wizardHint = cause && githubWizardHintByCode[code]?.[cause]
  if (wizardHint) return wizardHint
  return (cause && hintByCause[cause]) ?? ERROR_HINT.retry
}

// Builds the text shown to the user: an action message plus a hint for the cause, or the
// cause message alone when no action is known. `limit` is the 413 `details.limit` (GitHub import),
// `retryAfterSecond` the 429 `details.retryAfterSecond` (support request), `resetAt` the 429
// `details.resetAt` (analysis quota, plan 039).
export function buildUserMessage(code: ErrorCode, cause?: ErrorCode, limit?: string, retryAfterSecond?: number, resetAt?: string): string {
  if (!isActionCode(code)) return MESSAGE_BY_CODE[code]
  return `${MESSAGE_BY_CODE[code]} ${hintFor(code, cause, limit, retryAfterSecond, resetAt)}`
}

// Titles and texts of whole-page error states.
export const PAGE_ERROR_MESSAGE = {
  reviewNotFound: 'Review not found',
  reviewNotFoundDetail: 'There is no review with this id.',
  reviewUnavailable: 'Review unavailable',
  accountUnavailable: 'Account details are unavailable.',
  sessionUnavailable: 'Could not check your session. Check your connection and try again.',
  dashboardUnavailable: 'Dashboard unavailable',
  retry: 'Retry'
} as const

// Developer texts: the `error.message` of the backend's error bodies, as it words them (the unit
// tests' fake backend answers with the same texts), and of internal AppErrors. Never shown to the user (see ERROR_MESSAGE).
export const DEV_ERROR_MESSAGE = {
  noSuchReview: 'No such review',
  noSuchRepo: 'No such repository',
  noSuchFile: 'No such file in this repository',
  noSavedReview: 'No saved review to rename',
  noRoute: (method: string, path: string) => `No route for ${method} ${path}`,
  invalidReview: 'Invalid review',
  invalidSavedReview: 'Invalid saved review',
  invalidName: 'Invalid name',
  invalidId: 'Invalid id',
  invalidSupportRequest: 'Invalid support request',
  invalidPasswordChange: 'Invalid password change',
  invalidAccountUpdate: 'Invalid account update',
  invalidTestConfig: 'Invalid test configuration',
  invalidSettings: 'Invalid settings',
  cancelled: 'cancelled by caller',
  githubFileCount: 'Import 1 to 20 files at a time',
  reviewNotCompleted: 'Only a completed review has generated tests',
  currentPasswordWrong: 'The current password is not correct',
  newPasswordSame: 'The new password must differ',
  newPasswordWeak: 'The new password does not follow the password rules',
  invalidAvatar: 'The photo must be a PNG, JPEG or WebP image',
  avatarTooLarge: 'The photo is larger than 2 MB',
  missingReviewId: 'Missing review id',
  missingAnalyzed: 'Missing analyzedContent or analyzedLanguage',
  reviewUnfinished: 'The review is still pending, queued or in progress',
  githubLinkInvalid: 'Not a supported GitHub link',
  githubNotFound: 'The repository, branch, file or pull request does not exist or is private',
  // The wizard routes (plan 030), worded as on the backend.
  githubNotConnected: 'No GitHub account is connected',
  githubUsernameInvalid: 'Not a valid GitHub user name',
  githubUserNotFound: 'No GitHub user with this name'
} as const

// `details.issue[].message` texts, as the backend words them.
export const DEV_ISSUE_MESSAGE = {
  invalid: 'is invalid',
  id: 'must be 1 to 64 letters, digits or dashes',
  passwordWrong: 'is not correct',
  passwordSame: 'must differ from the current password'
} as const

// Inline form validation texts (shown next to the field, not as toasts).
export const FORM_ERROR_MESSAGE = {
  issueTypeRequired: 'Select an issue type',
  emailRequired: 'Email address is required',
  emailInvalid: 'Enter a valid email address',
  // QA 032 F1: the backend's 254-character limit for the support email.
  supportEmailTooLong: (max: number) => `Use at most ${max} characters`,
  reviewIdInvalid: 'Use letters, numbers and dashes only',
  descriptionRequired: 'Describe the problem',
  descriptionTooShort: (min: number) => `Use at least ${min} characters`,
  descriptionTooLong: (max: number) => `Use at most ${max} characters`,
  passwordTooShort: (min: number) => `Password must be at least ${min} characters.`,
  passwordMismatch: 'Passwords do not match.',
  codeTooLong: (max: number, length: number) =>
    `Code is too long: ${length.toLocaleString('en-US')} characters. Use at most ${max.toLocaleString('en-US')} characters.`,
  currentPasswordRequired: 'Enter your current password.',
  // Shown next to the field the server named in `details.issue[].field` (422).
  currentPasswordWrong: 'Current password is not correct.',
  newPasswordRejected: 'Choose a new password that is different from the current one.',
  // The GitHub link field (plan 023), checked before anything is sent.
  githubLinkRequired: 'Paste a GitHub link.',
  githubLinkInvalid: 'Use a https://github.com link to a file (…/blob/<branch>/<path>) or a pull request (…/pull/<number>).',
  // Plan 034: the wizard imports at most this many ticked files at a time (the pull-request limit).
  githubFileLimit: (max: number) => `Select at most ${max} files. Untick some files and try again.`,
  // The GitHub user-name field of the wizard's connect card (plan 030), checked before anything is sent.
  githubUsernameRequired: 'Enter a GitHub user name.',
  githubUsernameInvalid: 'Use up to 39 letters, digits or single hyphens, not at the start or end.',
  // Login and register forms (plan 028), checked before anything is sent.
  usernameRequired: 'Enter your user name.',
  usernameTooLong: (max: number) => `Use at most ${max} characters.`,
  passwordRequired: 'Enter your password.',
  passwordTooLong: (max: number) => `Password must be at most ${max} characters.`,
  usernameLength: (min: number, max: number) => `User name must be ${min} to ${max} characters.`,
  usernameCharacter: 'Use letters, numbers, dots, dashes and underscores only.',
  emailTooLong: (max: number) => `Email address must be at most ${max} characters.`,
  confirmPasswordRequired: 'Confirm your password.',
  // The password rules (Open Question 7), in the order the server checks them.
  passwordLength: (min: number, max: number) => `Password must be ${min} to ${max} characters.`,
  passwordLetterDigit: 'Password must contain at least one letter and one digit.',
  passwordPersonal: 'Password must not be your user name or email address.',
  passwordCommon: 'This password is too common. Choose another one.'
} as const

// Messages of the login and register pages and of a session that ended (plan 028). The 401 of a
// sign-in is one generic text for an unknown user and a wrong password.
export const SESSION_ERROR_MESSAGE = {
  signInFailed: 'Incorrect user name or password.',
  registerConflict: 'This user name or email cannot be used.',
  sessionEnded: 'Your session has ended. Sign in again.',
  rateLimited: (second?: number) => {
    if (!second) return 'Too many attempts. Wait a few minutes and try again.'
    const minute = Math.ceil(second / 60)
    return second < 60
      ? `Too many attempts. Try again in ${second} second${second === 1 ? '' : 's'}.`
      : `Too many attempts. Try again in ${minute} minute${minute === 1 ? '' : 's'}.`
  },
  // A 422 the client checks did not catch (the server is the authority).
  invalid: 'Check the fields and try again.'
} as const

// Inline field errors for a 422 whose `details.issue[]` names a field, by field name.
export const FIELD_ERROR_MESSAGE: Record<string, string> = {
  currentPassword: FORM_ERROR_MESSAGE.currentPasswordWrong,
  newPassword: FORM_ERROR_MESSAGE.newPasswordRejected
}

// Plan 034: the Account edit form's fields the server can name in a 422 (PUT /api/account). A
// wrong or missing current password is a 422 on `currentPassword`.
export const ACCOUNT_FIELD_ERROR_MESSAGE: Record<string, string> = {
  username: FORM_ERROR_MESSAGE.usernameCharacter,
  email: FORM_ERROR_MESSAGE.emailInvalid,
  currentPassword: FORM_ERROR_MESSAGE.currentPasswordWrong
}

// The register form's fields the server can name in a 422 (POST /api/account).
export const REGISTER_FIELD_ERROR_MESSAGE: Record<string, string> = {
  username: FORM_ERROR_MESSAGE.usernameCharacter,
  email: FORM_ERROR_MESSAGE.emailInvalid,
  password: 'Choose a password that follows the rules below.'
}
