import { ImportLanguage, TestFramework, TestType } from './domain.js'

// Fixed values shared across the backend that are not limits, enums or messages.

export const API_PATH = {
  health: '/api/health',
  review: '/api/review',
  dashboard: '/api/dashboard',
  github: '/api/github',
  settings: '/api/settings',
  supportRequest: '/api/support-request',
  account: '/api/account',
  // Plan 028: sign in (POST), session restore (GET), sign out (DELETE).
  session: '/api/session',
  // Plan 040: GitHub sign-in (start and callback are browser redirects; link and unlink are JSON).
  githubSignIn: '/api/auth/github',
  // Test-only; mounted only when the `ENABLE_TEST_ROUTE` flag is on (see `config.ts`).
  test: '/api/test'
} as const

// Sub-paths of each router, relative to its API_PATH mount point.
export const ROUTE = {
  root: '/',
  id: '/:id',
  generatedTest: '/:id/generated-test',
  run: '/:id/run',
  password: '/password',
  avatar: '/avatar',
  connect: '/connect',
  disconnect: '/disconnect',
  repo: '/repo',
  repoFile: '/repo/:repoId/file',
  repoFileById: '/repo/:repoId/file/:fileId',
  import: '/import',
  reset: '/reset',
  // Plan 040: under API_PATH.githubSignIn.
  callback: '/callback',
  link: '/link',
  // Plan 048: under API_PATH.githubSignIn.
  exchange: '/exchange'
} as const

// Names of the environment variables `loadConfig` reads. All but `enableTestRoute` are listed
// in the example env file; that flag is set only by the e2e backend web server.
export const CONFIG_KEY = {
  port: 'PORT',
  frontendUrl: 'FRONTEND_URL',
  enableTestRoute: 'ENABLE_TEST_ROUTE',
  // Optional (plan 022): the PostgreSQL connection string. Unset or empty means the in-memory
  // store. Read from the environment only, and never logged.
  databaseUrl: 'DATABASE_URL',
  // Test-only (plan 023): "true" answers GitHub imports from the fixed fake GitHub
  // (`lib/github-fake.ts`) with no network. Never listed in the example env file.
  githubFake: 'GITHUB_FAKE',
  // Optional (plan 028): `production` turns on the Secure cookie and the `__Host-` name; any
  // other value, or unset, is development.
  nodeEnv: 'NODE_ENV',
  // Read only by `npm run db:setup:test` and `npm run test:db`; never by the server itself.
  testDatabaseUrl: 'TEST_DATABASE_URL',
  // Optional (plan 039): the Anthropic API key of the Claude analyzer. Blank or unset means the
  // stub analyzer. Read from the environment only, and never logged, returned or put in an error.
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  // Optional (plan 039): the model id; blank or unset means `ANALYZER_MODEL_DEFAULT`.
  anthropicModel: 'ANTHROPIC_MODEL',
  // Optional (plan 040): the GitHub OAuth App of "Continue with GitHub". All three set, or all
  // blank (the feature is off). The secret is read from the environment only and never logged,
  // returned or put in an error.
  githubOAuthClientId: 'GITHUB_OAUTH_CLIENT_ID',
  githubOAuthClientSecret: 'GITHUB_OAUTH_CLIENT_SECRET',
  // The backend callback URL registered in the OAuth App (`.../api/auth/github/callback`).
  githubOAuthRedirectUrl: 'GITHUB_OAUTH_REDIRECT_URL',
  // Test-only (plan 040): "true" answers the GitHub sign-in from the fake client
  // (`lib/github-signin-fake.ts`), with no network. Never listed in the example env file.
  githubOAuthFake: 'GITHUB_OAUTH_FAKE',
  // Optional (plan 042): SameSite of the session and sign-in state cookies: lax (default),
  // strict or none. `none` only with NODE_ENV=production. Not a secret.
  cookieSameSite: 'COOKIE_SAMESITE',
  // Optional (plan 047): on|off (default off). When on, sign-in and register return the session
  // id as `sessionToken` to a client that sends `X-Session-Mode: token`. Not a secret.
  sessionTokenFallback: 'SESSION_TOKEN_FALLBACK',
  // Optional (plan 049): a GitHub token the backend sends on its own calls to api.github.com
  // (5000 requests an hour instead of 60). A SECRET: read from the environment only, and never
  // logged, returned or put in an error.
  githubApiToken: 'GITHUB_API_TOKEN',
  // Optional (plan 049): the number of proxy hops in front of the API (blank or 0 = off, 1 on
  // Render). Not a secret.
  trustProxy: 'TRUST_PROXY'
} as const

// Plan 047: the bearer-token session fallback. The accepted spellings of the setting, the one
// value of the opt-in header, and the Authorization scheme.
export const SESSION_TOKEN = {
  on: 'on',
  off: 'off',
  modeValue: 'token',
  bearerPattern: /^Bearer(?:\s+(\S*))?$/i
} as const

// The Express setting TRUST_PROXY sets (plan 049).
export const EXPRESS_SETTING = { trustProxy: 'trust proxy' } as const

// Plan 049: TRUST_PROXY is a whole number of hops, 1 to 2 digits (no sign, no decimal point).
export const TRUST_PROXY_PATTERN = /^[0-9]{1,2}$/

// The Claude model reviews use when ANTHROPIC_MODEL is not set (plan 039, Open Question 1).
export const ANALYZER_MODEL_DEFAULT = 'claude-sonnet-5-5'
// A model id: letters, digits and `. _ : -`.
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/

// The only accepted spellings of a boolean flag value.
export const BOOLEAN_TEXT = {
  true: 'true',
  false: 'false'
} as const

// Value of a flag that is not set.
export const FLAG_DEFAULT = {
  enableTestRoute: false,
  githubFake: false,
  githubOAuthFake: false
} as const

export const HEADER = {
  requestId: 'x-request-id',
  poweredBy: 'x-powered-by',
  // Plan 028.
  retryAfter: 'Retry-After',
  csrf: 'X-CSRF-Protection',
  contentType: 'Content-Type',
  origin: 'origin',
  cookie: 'cookie',
  // Plan 047: the bearer token and the opt-in to receive it.
  authorization: 'Authorization',
  sessionMode: 'X-Session-Mode',
  contentTypeOption: 'X-Content-Type-Options',
  contentSecurityPolicy: 'Content-Security-Policy',
  contentDisposition: 'Content-Disposition',
  cacheControl: 'Cache-Control',
  // Plan 040: the GitHub sign-in redirects.
  location: 'Location'
} as const

// Plan 028: server-side sessions (Open Question 3, answer A).
export const SESSION = {
  cookieName: 'cr_session',
  // Plan 047: an answer that carries a session token must not be stored by a cache.
  tokenCacheControl: 'no-store',
  // With NODE_ENV=production: `__Host-` needs Secure, Path=/ and no Domain.
  productionCookiePrefix: '__Host-',
  idByteLength: 32,
  // base64url of 32 bytes, no padding.
  idPattern: /^[A-Za-z0-9_-]{43}$/,
  idEncoding: 'base64url',
  hashAlgorithm: 'sha256',
  hashEncoding: 'hex',
  idleMs: 8 * 60 * 60 * 1000,
  absoluteMs: 7 * 24 * 60 * 60 * 1000,
  // The rolling idle expiry is written at most this often.
  touchIntervalMs: 60 * 1000,
  cookiePath: '/',
  sameSite: 'lax',
  // The value the CSRF header must have.
  csrfValue: '1',
  // A sign-in for an unknown user name is checked against a hash of this, so it takes as long.
  dummyPassword: 'timing-equalizer-not-a-password',
  // Log lines carry the user name only as this many hex characters of its SHA-256.
  userHashLength: 12
} as const

// HTTP methods that change state and so need the CSRF header (plan 028, Scope 6).
export const STATE_CHANGING_METHOD_LIST: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE']

// Plan 028: the profile photo (Open Question 4, answer A).
export const AVATAR = {
  typeList: ['image/png', 'image/jpeg', 'image/webp'],
  urlPrefix: '/api/account/avatar?v=',
  digestAlgorithm: 'sha256',
  digestPrefixLength: 12,
  contentTypeOption: 'nosniff',
  contentSecurityPolicy: "default-src 'none'; sandbox",
  contentDisposition: 'inline',
  cacheControl: 'private'
} as const

// The value of NODE_ENV that turns on the Secure cookie and the `__Host-` name.
export const PRODUCTION_ENVIRONMENT = 'production'

// Plan 042: the backend env files. The base file is read first, then the file named
// `<base>.<NODE_ENV>` on top of it; real process variables win over both. A guardrail hook blocks
// tool calls that name a real dotted env file, so `baseName` holds a PLACEHOLDER token: replace it
// with the real base file name (a dot followed by the three letters of "env") to turn loading on.
export const ENV_FILE = {
  baseName: '.env',
  // A NODE_ENV value is used in a file name only when it matches this (no path characters).
  nodeEnvPattern: /^[A-Za-z][A-Za-z0-9_-]{0,30}$/
} as const

// Plan 042: SameSite of the session and sign-in state cookies. `none` needs Secure, so it is
// accepted only with NODE_ENV=production.
export const COOKIE_SAMESITE = {
  lax: 'lax',
  strict: 'strict',
  none: 'none'
} as const
export type CookieSameSite = (typeof COOKIE_SAMESITE)[keyof typeof COOKIE_SAMESITE]
export const COOKIE_SAMESITE_LIST: readonly string[] = Object.values(COOKIE_SAMESITE)

// Registration (plan 028): `memberSince` like 'October 27, 2026' (UTC).
export const MEMBER_SINCE_FORMAT = {
  locale: 'en-US',
  option: { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
} as const

// `operation` and `reason` of the security log lines (plan 028, Scope 23).
export const SECURITY_LOG = {
  operation: {
    signIn: 'session.signIn',
    signOut: 'session.signOut',
    register: 'account.register',
    passwordChange: 'account.password',
    // Plan 034: a user name or email change.
    accountUpdate: 'account.update',
    csrf: 'request.csrf',
    session: 'request.session',
    // Plan 040: GitHub sign-in.
    githubStart: 'auth.github.start',
    githubCallback: 'auth.github.callback',
    githubLink: 'auth.github.link',
    githubUnlink: 'auth.github.unlink',
    // Plan 048: the one-time code swapped for the session token.
    githubExchange: 'auth.github.exchange'
  },
  reason: {
    success: 'success',
    unknownUser: 'unknown_user',
    wrongPassword: 'wrong_password',
    rateLimited: 'rate_limited',
    conflict: 'conflict',
    weakPassword: 'weak_password',
    csrfHeader: 'csrf_header_missing',
    foreignOrigin: 'foreign_origin',
    noCookie: 'no_cookie',
    malformedId: 'malformed_session_id',
    unknownSession: 'unknown_session',
    expired: 'expired_session',
    // Plan 040. The `auth_error` codes (domain `AuthErrorCode`) and a few more.
    invalidState: 'invalid_state',
    accessDenied: 'access_denied',
    providerError: 'provider_error',
    emailUnverified: 'email_unverified',
    emailInUse: 'email_in_use',
    identityInUse: 'identity_in_use',
    noPassword: 'no_password',
    notLinked: 'not_linked',
    lastSignInMethod: 'last_sign_in_method',
    alreadyLinked: 'already_linked',
    invalidAuthCode: 'invalid_auth_code'
  }
} as const

export enum LogLevel {
  Info = 'info',
  Warn = 'warn',
  Error = 'error'
}

// `operation` field of log lines that are not about one HTTP request.
export const LOG_OPERATION = {
  startup: 'startup',
  shutdown: 'shutdown',
  analyzeReview: 'review.analyze',
  database: 'database',
  databaseSetup: 'db.setup',
  githubImport: 'github.import'
} as const

export const LOG_MESSAGE = {
  listening: (port: number) => `backend listening on port ${port}`,
  storeMemory: 'DATABASE_URL is not set: running on the in-memory store, so reviews, settings and every other change are lost when the backend stops. Set DATABASE_URL and run npm run db:setup to keep them (README).',
  storePostgres: 'connected to PostgreSQL (DATABASE_URL)',
  resumeUnfinished: (count: number) => `re-analyzing ${count} review(s) left unfinished by the last run`,
  resumeFailed: 'could not look up the reviews left unfinished by the last run; they stay pending until the next start',
  databaseIdleError: (code: string) => `an idle PostgreSQL connection failed (${code})`,
  setupSkipped: (variable: string) => `${variable} is not set: no schema to apply (the backend will use the in-memory store)`,
  setupDone: (variable: string) => `schema applied to the database in ${variable}`,
  // Plan 039. No key text, no code, no prompt, no answer in any of these.
  // Plan 049. Names the setting only, never the token.
  githubTokenRefused: `GitHub refused ${CONFIG_KEY.githubApiToken}: the call was retried without it (60 requests an hour). Replace the token.`,
  analyzerStub: 'ANTHROPIC_API_KEY not set: reviews use the stub analyzer',
  analyzerClaude: (model: string) => `reviews use the Claude analyzer (model ${model})`,
  analyzerCall: 'AI analysis call finished',
  analyzerKeyRejected: 'the AI provider rejected the configured API key',
  analyzerFailed: 'AI analysis failed'
} as const

// PostgreSQL store (plan 022).
export const DATABASE = {
  // The demo account's org (plan 028, Open Question 8); every registered account gets its own.
  defaultOrgId: 'default',
  defaultOrgName: 'Default',
  // The test-only reset refuses to run unless the database name ends with this.
  testNameSuffix: '_test',
  // Tables and sequences the backend needs; startup stops when one is missing.
  tableList: ['org', 'review', 'finding', 'suggestion', 'generated_test', 'setting', 'account', 'github_connection', 'support_request', 'session', 'account_avatar', 'account_identity'],
  // SQLSTATE of a unique violation: a taken user name or email at registration.
  uniqueViolationCode: '23505',
  ticketSequence: 'support_ticket_seq',
  // Serializes concurrent schema setups (pg_advisory_lock key).
  schemaLockKey: 220_250_001,
  // The error code reported when an error carries none.
  unknownCode: 'unknown',
  // Command-line flag of `db/setup.ts` that targets TEST_DATABASE_URL.
  testFlag: '--test'
} as const

export const HEALTH_STATUS_OK = 'ok'

// Plan 040: GitHub sign-in (OAuth authorization code with PKCE). Every value here is fixed in
// code: the authorize URL, the token and API origins and the scopes never come from input or
// from a GitHub response.
export const GITHUB_SIGNIN = {
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userUrl: 'https://api.github.com/user',
  emailUrl: 'https://api.github.com/user/emails',
  // Sign-in only: the profile and the email addresses. No `repo` scope, no token is stored.
  scope: 'read:user user:email',
  challengeMethod: 'S256',
  // The state cookie: single use, bound to the browser, gone after the callback.
  stateCookieName: 'cr_github_state',
  stateMaxAgeMs: 10 * 60 * 1000,
  cacheControl: 'no-store',
  randomByteLength: 32,
  randomEncoding: 'base64url',
  // base64url of 32 random bytes.
  randomPattern: /^[A-Za-z0-9_-]{43}$/,
  returnToMax: 512,
  queryValueMax: 512,
  tokenMax: 512,
  callTimeoutMs: 10_000,
  // Cap on what GitHub may send back (the profile and the email list are small).
  responseByteMax: 200_000,
  // The user name of a new account when the login is too short, and the attempts to find a free one.
  shortLoginSuffix: '-gh',
  usernameAttemptMax: 25,
  fullNameMax: 255,
  // The `error` GitHub sends when the user denies access.
  deniedError: 'access_denied',
  loginPath: '/login',
  settingsPath: '/settings',
  settingsQuery: 'section=account',
  errorParam: 'auth_error',
  loginPattern: /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
  idPattern: /^[0-9]{1,20}$/,
  unpairedSurrogate: /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
} as const

// Plan 048: the one-time code (authCode) a successful GitHub sign-in puts in the redirect
// fragment. 32 random bytes in base64url, kept in memory as a hash, single use.
export const SESSION_CODE = {
  ttlMs: 60_000,
  maxCount: 1000,
  fragmentParam: 'auth_code',
  // base64url of 32 random bytes, no padding.
  pattern: /^[A-Za-z0-9_-]{43}$/
} as const

// Used to read a request body whose charset Node does not know.
export const DEFAULT_CHARSET = 'utf8'

// Logged when a request reaches the error handler before it has a request id.
export const UNKNOWN_REQUEST_ID = 'unknown'

// Plan 033 (Open Question 4, answer A): scrypt, with its parameters pinned. They are Node's
// defaults, so every hash stored before the pin still verifies. Changing any of them needs a
// re-hash plan: `verifyPassword` uses the same values.
export const PASSWORD_HASH = {
  scheme: 'scrypt',
  separator: '$',
  encoding: 'hex',
  saltBytes: 16,
  keyLength: 64,
  // CPU and memory cost N (a power of two), block size r and parallelization p.
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
  // 128 * N * r = 16 MiB is needed; this leaves room without letting a parameter grow unnoticed.
  maxMemory: 32 * 1024 * 1024
} as const

// Support tickets are `SUP-NNNN`, numbered from `first` and wrapping after `last`.
export const TICKET = {
  prefix: 'SUP-',
  digits: 4,
  padChar: '0',
  first: 1001,
  last: 9999
} as const

export const REVIEW_DEFAULT = {
  title: 'New review',
  initialQualityScore: 0
} as const

export const TIME = {
  msPerSecond: 1000,
  secondsPerMinute: 60,
  secondsPerHour: 3600,
  secondsPerDay: 86_400
} as const

export const TIME_AGO_TEXT = {
  justNow: 'just now',
  day: 'day',
  hour: 'hour',
  minute: 'minute',
  pluralSuffix: 's',
  agoSuffix: 'ago'
} as const

export const PATTERN = {
  supportReviewId: /^[A-Za-z0-9-]*$/,
  // Plan 028 (the same rules in the frontend).
  username: /^[A-Za-z0-9._-]+$/,
  passwordLetter: /\p{L}/u,
  passwordDigit: /[0-9]/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // QA 031 F1 (kept by plan 032): CR, LF and every other control or line-separator character,
  // refused in the support request email. No global flag, so `test` keeps no state.
  controlOrLineSeparator: /[\u0000-\u001f\u007f\u0085\u2028\u2029]/,
  printableAscii: /^[!-~]+$/,
  lineBreak: /\r?\n/
} as const

// Stub analyzer: the generated test file name falls back to these when a title or language
// gives nothing usable.
export const STUB_ANALYZER_DEFAULT = {
  fileName: 'snippet',
  extension: 'txt'
} as const

// The test configuration of a review that has none (plan 034): every review before contract
// 0.13.0, and a new review until Regenerate stores one. Its generated tests are the stub's
// original output.
export const TEST_CONFIG_DEFAULT = {
  framework: TestFramework.Jest,
  testTypeIdList: [TestType.Unit, TestType.Edge, TestType.Error]
} as const

// Stub analyzer: how each framework's generated tests start and assert (plan 034).
export type StubFrameworkSyntax = { importList: readonly string[], equal: string, throwing: string }
export const STUB_TEST_FRAMEWORK: Readonly<Record<`${TestFramework}`, StubFrameworkSyntax>> = {
  [TestFramework.Jest]: { importList: ["import { describe, expect, it } from '@jest/globals'"], equal: '.toBe', throwing: '.toThrow' },
  [TestFramework.Vitest]: { importList: ["import { describe, expect, it } from 'vitest'"], equal: '.toBe', throwing: '.toThrow' },
  [TestFramework.Mocha]: { importList: ["import { describe, it } from 'mocha'", "import { expect } from 'chai'"], equal: '.to.equal', throwing: '.to.throw' }
}

// Stub analyzer: the `describe` title of each kind of test (plan 034).
export const STUB_TEST_TYPE_TITLE: Readonly<Record<`${TestType}`, string>> = {
  [TestType.Unit]: 'unit tests',
  [TestType.Edge]: 'edge cases',
  [TestType.Error]: 'error cases'
}

// Quality score penalty per finding severity; both analyzers use it, so scores are comparable
// (plan 039, Open Question 6).
export const SEVERITY_WEIGHT = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 1
} as const

// Stub analyzer: file extension of the generated test, by lower-case language name.
export const LANGUAGE_EXTENSION: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  go: 'go',
  java: 'java'
}

// Dashboard (computed from the store at request time, plan 019 addendum).
export const DASHBOARD_LABEL = {
  stat: {
    total: 'Total Reviews',
    completed: 'Completed',
    failed: 'Failed',
    quality: 'Avg. Quality Score'
  },
  qualitySuffix: ' / 100',
  severity: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  },
  category: {
    security: 'Security',
    bug: 'Bugs',
    performance: 'Performance',
    readability: 'Readability',
    maintainability: 'Maintainability'
  }
} as const

// Number of calendar days (UTC) in each activity range, oldest day first, ending today.
export const ACTIVITY_RANGE_DAY = {
  '7d': 7,
  '14d': 14,
  '30d': 30
} as const

// Stat trends compare this range with the range of the same length just before it.
export const TREND_RANGE = '30d'

export const PERCENT = 100

// Activity date labels, for example 'Apr 26'. Days are UTC calendar days.
export const DATE_LABEL = {
  locale: 'en-US',
  option: { month: 'short', day: 'numeric', timeZone: 'UTC' }
} as const

// GitHub link import (plan 023). The link the user types is only parsed: these are the only
// prefix it may have, and the only origin the backend ever calls. Neither comes from input or
// from a GitHub response.
export const GITHUB_LINK = {
  prefix: 'https://github.com/',
  blob: 'blob',
  pull: 'pull',
  pullFiles: 'files'
} as const

export const GITHUB_API = {
  origin: 'https://api.github.com',
  repoPath: '/repos',
  // Plan 030: GET /users/{login} and /users/{login}/repos, and the recursive tree.
  userPath: '/users',
  reposPath: 'repos',
  gitPath: 'git',
  treesPath: 'trees',
  // The default branch, without a call to learn its name.
  headRef: 'HEAD',
  recursiveParam: 'recursive',
  recursiveOn: '1',
  typeParam: 'type',
  typeOwner: 'owner',
  sortParam: 'sort',
  sortUpdated: 'updated',
  directionParam: 'direction',
  directionDesc: 'desc',
  // GitHub answers 409 for the tree of a repository without any commit.
  emptyRepoStatus: 409,
  contentsPath: 'contents',
  pullsPath: 'pulls',
  filesPath: 'files',
  refParam: 'ref',
  perPageParam: 'per_page',
  // `fileCount` is far below one page, so one page of the PR file list is always enough.
  perPage: 100,
  header: {
    accept: 'application/vnd.github+json',
    apiVersion: '2022-11-28',
    userAgent: 'ai-code-reviewer'
  },
  headerName: {
    accept: 'accept',
    apiVersion: 'x-github-api-version',
    userAgent: 'user-agent',
    contentType: 'content-type',
    contentLength: 'content-length',
    rateRemaining: 'x-ratelimit-remaining',
    rateReset: 'x-ratelimit-reset',
    retryAfter: 'retry-after',
    // Plan 030: `rel="next"` means more repositories than one page.
    link: 'link',
    // Sent only with GITHUB_API_TOKEN set (plan 049), and only to `origin`.
    authorization: 'authorization'
  },
  jsonType: 'application/json',
  rateExhausted: '0',
  base64: 'base64'
} as const

// Strict patterns for the parts of a link (GitHub's own owner and repo rules).
export const GITHUB_PATTERN = {
  owner: /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
  repo: /^[A-Za-z0-9._-]{1,100}$/,
  ref: /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/,
  pullNumber: /^[1-9][0-9]{0,9}$/,
  sha: /^[0-9a-f]{40}$/,
  // Raw link text: no backslash, no white space and no control character.
  unsafeRaw: /[\\\s\u0000-\u001f\u007f]/,
  // A decoded path segment: no slash, backslash or control character.
  unsafeSegment: /[/\\\u0000-\u001f\u007f]/,
  dotSegment: /^\.{1,2}$/,
  integer: /^[0-9]{1,12}$/,
  // Plan 030: a file id is base64url without padding; `rel="next"` in a Link header.
  fileId: /^[A-Za-z0-9_-]{1,4000}$/,
  linkNext: /rel="next"/
} as const

// The one language table (plan 023, scope 6): it names the language of an imported file and
// decides which PR files are kept. Languages are the frontend `languageList`.
export const IMPORT_LANGUAGE_TABLE: ReadonlyArray<{ language: ImportLanguage, extensionList: readonly string[], comment: { start: string, end: string } }> = [
  { language: ImportLanguage.TypeScript, extensionList: ['ts', 'tsx', 'mts', 'cts'], comment: { start: '//', end: '' } },
  { language: ImportLanguage.JavaScript, extensionList: ['js', 'jsx', 'mjs', 'cjs'], comment: { start: '//', end: '' } },
  { language: ImportLanguage.Python, extensionList: ['py'], comment: { start: '#', end: '' } },
  { language: ImportLanguage.Go, extensionList: ['go'], comment: { start: '//', end: '' } },
  { language: ImportLanguage.Java, extensionList: ['java'], comment: { start: '//', end: '' } }
]

// Joining PR files (plan 023, Open Question 2): `// ===== src/a.ts =====`, then the file, then
// one empty line before the next header.
export const IMPORT_JOIN = {
  marker: '=====',
  lineBreak: '\n',
  fileSeparator: '\n',
  // `<owner>/<repo>#<number>`
  pullNameSeparator: '#'
} as const

// GitHub's `status` of a PR file and `type` of a contents entry.
export const GITHUB_FILE_STATUS = {
  removed: 'removed',
  renamed: 'renamed'
} as const

// `type` of a recursive tree entry (plan 030): only blobs are files.
export const GITHUB_TREE_TYPE = {
  blob: 'blob'
} as const

export const GITHUB_CONTENT_TYPE = {
  file: 'file',
  dir: 'dir',
  symlink: 'symlink',
  submodule: 'submodule'
} as const

// The name a DOMException has when an `AbortSignal.timeout` fired.
export const TIMEOUT_ERROR_NAME = 'TimeoutError'
