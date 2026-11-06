import { CONFIG_KEY } from './constants.js'
import { LIMIT } from './limits.js'

// Every error text the backend sends. `error.message` is for developers and logs: the frontend
// shows its own constant for the mapped code (frontend/src/utils/error-messages.ts).

export const ERROR_MESSAGE = {
  bodyTooLarge: 'The request body is too large.',
  bodyNotJson: 'The request body is not valid JSON.',
  urlNotEncoded: 'The request URL is not correctly encoded.',
  requestUnreadable: 'The request could not be read.',
  internal: 'Something failed while handling the request.',
  noRoute: (method: string, path: string) => `No route for ${method} ${path}.`,
  invalidInput: (subject: string, field?: string, message?: string) =>
    `Invalid ${subject}${field ? `: ${field} ${message}` : ''}.`,
  invalidField: (field: string) => `Invalid ${field}.`,

  reviewNotFound: (id: string) => `Review ${id} was not found.`,
  reviewNotSaved: (id: string) => `Review ${id} has no saved edit to rename.`,
  reviewNotCompleted: (id: string, status: string) =>
    `Review ${id} is ${status}; only a completed review has generated tests.`,
  reviewUnfinished: (id: string, status: string) =>
    `Review ${id} is ${status}; wait until it finishes before running it again.`,

  repoNotFound: (repoId: string) => `Repository ${repoId} was not found.`,
  fileNotFound: (fileId: string, repoId: string) => `File ${fileId} was not found in repository ${repoId}.`,

  // GitHub link import (plan 023). None of these ever includes the typed link, GitHub's
  // response text or its headers.
  githubUrlInvalid: (reason: string) => `Not a supported GitHub link: the link ${reason}.`,
  githubNotFound:
    'The GitHub repository, branch, file or pull request was not found, or it is private. A branch name with a slash is not supported: open the file at a commit and paste that link.',
  githubUnsupportedFile: (reason: string) => `The linked file cannot be imported (${reason}).`,
  githubNothingToImport: 'The pull request has no file that can be imported; see details.skippedList.',
  githubLimit: (limit: string, max: number) => `The GitHub import is over the ${limit} limit (${max}).`,
  githubRateLimited: 'GitHub\'s rate limit for unauthenticated requests is used up; try again after details.resetAt.',
  githubUpstream: 'GitHub could not be reached or sent an unexpected answer.',
  // Plan 039. None of these ever holds the provider's response text, the prompt or the code.
  analysisQuota: 'The analysis limit for this account is used up. Try again later.',
  aiUpstream: 'The AI service could not complete the request.',
  aiRateLimited: 'The AI service is busy. Try again in a minute.',
  aiTimeout: (maxMs: number) => `The AI service did not answer in time (${maxMs} ms).`,
  githubTimeout: (limit: string, maxMs: number) => `GitHub did not answer in time (${limit}, ${maxMs} ms).`,

  // The wizard's repository routes (plan 030). They never echo GitHub's response text.
  githubNotConnected: 'No GitHub account is connected; connect one first.',
  githubUserNotFound: 'GitHub has no user with this name.',
  githubRepoNotFound: 'The repository was not found for the connected GitHub user, or it is private.',
  githubFileNotFound: 'The file was not found in the repository, or the repository is private.',
  githubFileUnsupported: (reason: string) => `The file cannot be imported (${reason}).`,

  currentPasswordWrong: 'The current password is not correct.',
  newPasswordSame: 'The new password must be different from the current one.',
  newPasswordWeak: 'The new password does not meet the password rules.',

  // Plan 028. The sign-in and sign-up texts are generic on purpose: they never say whether an
  // account exists or which field is taken.
  signInFailed: 'Incorrect user name or password.',
  sessionRequired: 'Sign in to continue.',
  accountUnavailable: 'This user name or email cannot be used.',
  passwordWeak: 'The password does not meet the password rules.',
  tooManyAttempt: (second: number) => `Too many attempts. Try again in ${second} seconds.`,
  csrfHeaderMissing: 'A state-changing request needs the X-CSRF-Protection: 1 header.',
  originRefused: 'The request origin is not allowed.',
  avatarInvalid: 'The photo must be a PNG, JPEG or WebP image, sent with its own Content-Type.',
  avatarEmpty: 'The photo is empty.',
  avatarNotFound: 'There is no profile photo.',

  configInvalid: (detail: string) => `Invalid server configuration: ${detail}`,
  // Plan 040. Names the settings, never a value.
  githubOAuthPartial: `${CONFIG_KEY.githubOAuthClientId}, ${CONFIG_KEY.githubOAuthClientSecret} and ${CONFIG_KEY.githubOAuthRedirectUrl} must all be set, or all be blank`,
  githubOAuthRedirectInvalid: `${CONFIG_KEY.githubOAuthRedirectUrl} must be an http or https URL`,
  // Plan 042. Names the setting, never its value.
  cookieSameSiteInvalid: `${CONFIG_KEY.cookieSameSite} must be one of: lax, strict, none`,
  cookieSameSiteNeedProduction: `${CONFIG_KEY.cookieSameSite} can use the none option only when ${CONFIG_KEY.nodeEnv} is production`,
  // Plan 043. Names the setting, never its value.
  frontendUrlQueryOrFragment: `${CONFIG_KEY.frontendUrl} must not have a query or a fragment`,
  envFileUnreadable: 'A backend env file could not be read',

  // Plan 040: a GitHub-only account has no password.
  passwordNotSet: 'This account signs in with GitHub and has no password.',
  accountNoPassword: 'This account signs in with GitHub and has no password to confirm the change.',
  githubAlreadyLinked: 'This account already has a GitHub link.',
  githubNotLinked: 'This account has no GitHub link.',
  githubUnlinkLast: 'GitHub is the only way to sign in to this account, so it cannot be unlinked.',

  // PostgreSQL (plan 022). None of these ever includes a connection string or a password:
  // only the variable name and the driver's error code.
  databaseConnect: (variable: string, code: string, hint: string) =>
    `Could not connect to PostgreSQL with ${variable} (${code}): ${hint}`,
  databaseSchemaMissing: (missing: string) =>
    `The database is missing ${missing}. Run npm run db:setup (backend/db/schema.sql) and start again.`,
  databaseFailed: (operation: string, code: string) => `Database operation ${operation} failed (${code}).`,
  resetRefused: (suffix: string) =>
    `The test reset only runs on a database whose name ends in ${suffix}; nothing was changed.`,
  setupVariableMissing: (variable: string) =>
    `${variable} is not set. Create the test database and set ${variable} (README, "PostgreSQL setup").`
} as const

// Why a PostgreSQL connection failed, by driver or SQLSTATE error code (never the raw message,
// which can contain the host, the user or the database name).
export const DATABASE_HINT: Record<string, string> = {
  ECONNREFUSED: 'PostgreSQL is not running, or not listening on that host and port.',
  ENOTFOUND: 'the host name was not found.',
  ETIMEDOUT: 'the connection timed out.',
  ERR_INVALID_URL: 'the connection string is not a valid URL (postgres://user:password@host:5432/name).',
  '28P01': 'the password was rejected.',
  '28000': 'the user may not connect (check the user name and pg_hba.conf).',
  '3D000': 'the database does not exist; create it first (README, "PostgreSQL setup").',
  default: 'check that PostgreSQL is running and that the connection string is right.'
}

// Per-field `details.issue[].message` texts (zod's own messages are used for min, max and type).
export const ISSUE_MESSAGE = {
  invalid: 'is invalid',
  blank: 'must not be blank',
  id: `must be ${LIMIT.id.min} to ${LIMIT.id.max} letters, digits or dashes`,
  email: 'must be a valid email address',
  supportReviewId: 'must contain only letters, digits or dashes',
  passwordWrong: 'is not correct',
  // Plan 034: PUT /api/account.
  passwordMissing: 'is required',
  // Plan 040: PUT /api/account and PUT /api/account/password on a GitHub-only account.
  passwordNotSet: 'is not available: this account has no password',
  accountUpdateEmpty: 'must change the user name, the email or both',
  testTypeRepeated: 'must not repeat a test type',
  passwordSame: 'must differ from the current password',
  // Plan 028 password rules (Open Question 7) and registration.
  passwordLength: `must be ${LIMIT.password.min} to ${LIMIT.password.max} characters`,
  passwordLetterDigit: 'must contain at least one letter and one digit',
  passwordPersonal: 'must not be the user name or the email',
  passwordCommon: 'is too common',
  username: 'must contain only letters, digits, dots, dashes or underscores',
  avatarType: 'must be a PNG, JPEG or WebP image matching its Content-Type',
  avatarEmpty: 'must not be empty',
  // QA AI-43 D1 and D2: PostgreSQL text cannot hold U+0000, and the driver replaces an unpaired
  // surrogate with U+FFFD, so both are refused before any store sees them.
  nulCharacter: 'must not contain a NUL character (U+0000)',
  notWellFormed: 'must be well-formed Unicode text (no unpaired surrogate)'
} as const

// Why a link was refused, for `ERROR_MESSAGE.githubUrlInvalid` and `details.issue[].message`.
// They describe the rule broken, never echo the link.
export const GITHUB_URL_ISSUE = {
  tooLong: `must be at most ${LIMIT.github.urlMax} characters`,
  notGithub: 'must start with https://github.com/ (no other scheme, host, user name or port)',
  unsafeCharacter: 'must not contain a backslash, a control character or white space',
  notWellFormed: 'must be well-formed Unicode text (no unpaired surrogate)',
  emptySegment: 'must not contain an empty path segment',
  badEscape: 'contains a malformed percent-escape',
  unsafeSegment: 'must not contain . or .. segments, or an encoded slash, backslash or control character',
  notFileOrPull: 'must be a file link (/<owner>/<repo>/blob/<ref>/<path>) or a pull request link (/<owner>/<repo>/pull/<number>)',
  owner: `must name an owner of 1 to ${LIMIT.github.ownerMax} letters, digits or inner dashes`,
  repo: `must name a repository of 1 to ${LIMIT.github.repoMax} letters, digits, dots, dashes or underscores`,
  ref: `must name a branch without a slash, a tag or a commit SHA (1 to ${LIMIT.github.refMax} letters, digits, dots, dashes or underscores)`,
  refSlash: 'names a branch with a slash, which cannot be told apart from the file path: open the file at a commit and paste that link',
  pathMissing: 'must name a file after the branch, tag or commit',
  pathTooLong: `must have a file path of at most ${LIMIT.github.pathMax} characters`,
  pullNumber: `must have a pull request number of 1 to ${LIMIT.github.pullNumberDigitMax} digits`
} as const

// Why a wizard path value was refused (plan 030), for `details.issue[].message`.
export const GITHUB_ID_ISSUE = {
  username: `must be a GitHub user name: 1 to ${LIMIT.github.usernameMax} letters or digits, with single hyphens only between them`,
  repoId: `must be a repository name of 1 to ${LIMIT.github.repoMax} letters, digits, dots, dashes or underscores (not . or ..)`,
  fileId: 'must be the base64url id of a file path without . or .. segments, empty segments, a backslash or a control character'
} as const

// Why a single blob link cannot be imported, for `ERROR_MESSAGE.githubUnsupportedFile`.
export const GITHUB_FILE_ISSUE = {
  unsupportedType: 'Unsupported file type',
  binary: 'not a text file',
  folder: 'a folder, not a file',
  symlink: 'a symbolic link',
  submodule: 'a submodule',
  empty: 'an empty file'
} as const

// What a failed body or query was, for `ERROR_MESSAGE.invalidInput`.
export const SUBJECT = {
  review: 'review',
  query: 'query',
  settings: 'settings',
  supportRequest: 'support request',
  passwordChange: 'password change',
  githubImport: 'GitHub import',
  githubConnect: 'GitHub connection',
  registration: 'registration',
  // Plan 034.
  accountUpdate: 'account update',
  testConfig: 'test configuration',
  signIn: 'sign in'
} as const

// Field names used in validation issues.
export const FIELD = {
  id: 'id',
  repoId: 'repoId',
  fileId: 'fileId',
  currentPassword: 'currentPassword',
  newPassword: 'newPassword',
  url: 'url',
  username: 'username',
  password: 'password',
  avatar: 'avatar'
} as const
