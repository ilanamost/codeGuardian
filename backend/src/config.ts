import { z } from 'zod'
import { hasQueryOrFragment } from './lib/frontend-base.js'
import { ANALYZER_MODEL_DEFAULT, BOOLEAN_TEXT, CONFIG_KEY, COOKIE_SAMESITE, COOKIE_SAMESITE_LIST, type CookieSameSite, FLAG_DEFAULT, LOG_OPERATION, LogLevel, MODEL_ID_PATTERN, PRODUCTION_ENVIRONMENT, SESSION_TOKEN, TRUST_PROXY_PATTERN } from './utils/constants.js'
import { ERROR_MESSAGE } from './utils/error-messages.js'

// Server configuration, read once at startup from the environment variables (the values live in
// the backend env file; `backend/.env.example` lists them). There are no hard-coded fallbacks: a
// missing or invalid value stops the server with a clear message instead of starting it wrong.
// `ENABLE_TEST_ROUTE` is the one exception: an optional flag that defaults to off. It mounts the
// test-only `POST /api/test/reset` route and is never listed in the example env file.
// `DATABASE_URL` is the other optional value (plan 022): without it the backend runs on the
// in-memory store and warns once that nothing survives a restart.
// `GITHUB_FAKE` (plan 023) is a second test-only flag, off by default and never listed in the
// example env file: "true" answers GitHub imports from the fixed fake GitHub (e2e only).
// `NODE_ENV` (plan 028) is optional: `production` turns on the Secure session cookie.
// A leftover setting of the removed API encryption (plan 041) is ignored: unknown settings are not read.
// `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` (plan 039) are optional: a blank key means "not
// configured" (the stub analyzer runs), a blank model means `ANALYZER_MODEL_DEFAULT`. The key
// is only trimmed, never checked or echoed, so no config error can contain it.
const configSchema = z.object({
  [CONFIG_KEY.port]: z.coerce.number().int().positive(),
  [CONFIG_KEY.frontendUrl]: z.url(),
  [CONFIG_KEY.enableTestRoute]: z
    .stringbool({ truthy: [BOOLEAN_TEXT.true], falsy: [BOOLEAN_TEXT.false], case: 'sensitive' })
    .default(FLAG_DEFAULT.enableTestRoute),
  // Optional (plan 022): unset or blank means the in-memory store.
  [CONFIG_KEY.databaseUrl]: z.string().optional(),
  // Test-only (plan 023): the fake GitHub for e2e. Same strict spelling as ENABLE_TEST_ROUTE.
  [CONFIG_KEY.githubFake]: z
    .stringbool({ truthy: [BOOLEAN_TEXT.true], falsy: [BOOLEAN_TEXT.false], case: 'sensitive' })
    .default(FLAG_DEFAULT.githubFake),
  // Optional (plan 028): exactly `production` means production; anything else is development.
  [CONFIG_KEY.nodeEnv]: z.string().optional(),
  // Optional (plan 042): the rule and the production-only `none` are in `cookieSameSiteOf`, so
  // no message can contain the value.
  [CONFIG_KEY.cookieSameSite]: z.string().optional(),
  // Optional (plan 047): on or off; blank means off. The message never contains the value.
  [CONFIG_KEY.sessionTokenFallback]: z.string().optional(),
  // Optional (plan 049): the whole-number rule is in `trustProxyOf`, so no message can contain the value.
  [CONFIG_KEY.trustProxy]: z.string().optional(),
  // Optional (plan 049): only trimmed, never checked or echoed, like the Anthropic key.
  [CONFIG_KEY.githubApiToken]: z.string().optional(),
  [CONFIG_KEY.anthropicApiKey]: z.string().optional(),
  [CONFIG_KEY.anthropicModel]: z
    .string()
    .optional()
    .refine((value) => value === undefined || value.trim() === '' || MODEL_ID_PATTERN.test(value.trim()), { error: 'must be a model id' }),
  // Plan 040: the GitHub OAuth App. Blank or unset means "not configured"; the all-or-none rule
  // and the URL check are in `githubOAuthOf`, so no message can contain a value.
  [CONFIG_KEY.githubOAuthClientId]: z.string().optional(),
  [CONFIG_KEY.githubOAuthClientSecret]: z.string().optional(),
  [CONFIG_KEY.githubOAuthRedirectUrl]: z.string().optional(),
  // Test-only (plan 040): the fake GitHub sign-in client. Same strict spelling as GITHUB_FAKE.
  [CONFIG_KEY.githubOAuthFake]: z
    .stringbool({ truthy: [BOOLEAN_TEXT.true], falsy: [BOOLEAN_TEXT.false], case: 'sensitive' })
    .default(FLAG_DEFAULT.githubOAuthFake)
})

// The GitHub OAuth App settings (plan 040). The secret is never logged, returned or put in an error.
export type GithubOAuthConfig = { clientId: string, clientSecret: string, redirectUrl: string }

export type AppConfig = {
  port: number
  frontendUrl: string
  enableTestRoute: boolean
  // GitHub imports answered by `lib/github-fake.ts`, with no network (e2e only).
  githubFake: boolean
  // Never logged or returned; see `store/create-store.ts`.
  databaseUrl?: string
  // NODE_ENV=production (plan 028): the session cookie gets Secure and the `__Host-` name.
  production: boolean
  // COOKIE_SAMESITE (plan 042): `lax` unless set; `none` only in production.
  cookieSameSite: CookieSameSite
  // SESSION_TOKEN_FALLBACK (plan 047): sign-in and register may return `sessionToken`. Off unless set to on.
  sessionTokenFallback: boolean
  // GITHUB_API_TOKEN (plan 049): undefined when unset or blank. Sent only to api.github.com as
  // `Authorization: Bearer`; never logged, returned or put in an error message.
  githubApiToken?: string
  // TRUST_PROXY (plan 049): the number of proxy hops whose X-Forwarded-For is trusted; 0 is off.
  trustProxy: number
  // ANTHROPIC_API_KEY (plan 039): undefined when unset or blank. Never logged, returned or
  // put in an error message.
  anthropicApiKey?: string
  // ANTHROPIC_MODEL, or the default model id.
  anthropicModel: string
  // GITHUB_OAUTH_* (plan 040): undefined when all three are blank (GitHub sign-in is off).
  githubOAuth?: GithubOAuthConfig
  // GITHUB_OAUTH_FAKE (plan 040): the sign-in client is the fake one, with no network (e2e only).
  githubOAuthFake: boolean
}

export type Environment = Record<string, string | undefined>

// An invalid configuration. The message names the settings and the rule, never a value.
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

// All three set (a valid redirect URL) means configured, all blank means off, anything else
// stops the server. The message names the settings, never what was set.
function githubOAuthOf(data: z.infer<typeof configSchema>): GithubOAuthConfig | undefined {
  const clientId = data[CONFIG_KEY.githubOAuthClientId]?.trim() ?? ''
  const clientSecret = data[CONFIG_KEY.githubOAuthClientSecret]?.trim() ?? ''
  const redirectUrl = data[CONFIG_KEY.githubOAuthRedirectUrl]?.trim() ?? ''
  const setCount = [clientId, clientSecret, redirectUrl].filter((value) => value !== '').length
  if (setCount === 0) return undefined
  if (setCount < 3) throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.githubOAuthPartial))
  if (!URL.canParse(redirectUrl) || !/^https?:$/.test(new URL(redirectUrl).protocol)) {
    throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.githubOAuthRedirectInvalid))
  }
  return { clientId, clientSecret, redirectUrl }
}

// Blank or unset is `lax`. Anything else must be exactly lax, strict or none, and `none` (which
// browsers accept only with Secure) needs NODE_ENV=production. The messages never echo the value.
function cookieSameSiteOf(data: z.infer<typeof configSchema>): CookieSameSite {
  const value = data[CONFIG_KEY.cookieSameSite]?.trim() ?? ''
  if (value === '') return COOKIE_SAMESITE.lax
  if (!COOKIE_SAMESITE_LIST.includes(value)) throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.cookieSameSiteInvalid))
  if (value === COOKIE_SAMESITE.none && data[CONFIG_KEY.nodeEnv] !== PRODUCTION_ENVIRONMENT) {
    throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.cookieSameSiteNeedProduction))
  }
  return value as CookieSameSite
}

// Blank or `off` is off, `on` is on, anything else stops the server. The message never echoes the value.
function sessionTokenFallbackOf(data: z.infer<typeof configSchema>): boolean {
  const value = data[CONFIG_KEY.sessionTokenFallback]?.trim() ?? ''
  if (value === '' || value === SESSION_TOKEN.off) return false
  if (value === SESSION_TOKEN.on) return true
  throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.sessionTokenFallbackInvalid))
}

// Blank or 0 is off, a whole number of hops (digits only) is that many, anything else stops the
// server. The message never echoes the value.
function trustProxyOf(data: z.infer<typeof configSchema>): number {
  const value = data[CONFIG_KEY.trustProxy]?.trim() ?? ''
  if (value === '') return 0
  if (!TRUST_PROXY_PATTERN.test(value)) throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.trustProxyInvalid))
  return Number(value)
}

export function loadConfig(environment: Environment): AppConfig {
  const result = configSchema.safeParse(environment)
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')
    throw new ConfigError(ERROR_MESSAGE.configInvalid(detail))
  }
  const data = result.data
  if (hasQueryOrFragment(data[CONFIG_KEY.frontendUrl])) throw new ConfigError(ERROR_MESSAGE.configInvalid(ERROR_MESSAGE.frontendUrlQueryOrFragment))
  return {
    port: data[CONFIG_KEY.port],
    frontendUrl: data[CONFIG_KEY.frontendUrl],
    enableTestRoute: data[CONFIG_KEY.enableTestRoute],
    githubFake: data[CONFIG_KEY.githubFake],
    databaseUrl: data[CONFIG_KEY.databaseUrl]?.trim() || undefined,
    production: data[CONFIG_KEY.nodeEnv] === PRODUCTION_ENVIRONMENT,
    cookieSameSite: cookieSameSiteOf(data),
    sessionTokenFallback: sessionTokenFallbackOf(data),
    githubApiToken: data[CONFIG_KEY.githubApiToken]?.trim() || undefined,
    trustProxy: trustProxyOf(data),
    anthropicApiKey: data[CONFIG_KEY.anthropicApiKey]?.trim() || undefined,
    anthropicModel: data[CONFIG_KEY.anthropicModel]?.trim() || ANALYZER_MODEL_DEFAULT,
    githubOAuth: githubOAuthOf(data),
    githubOAuthFake: data[CONFIG_KEY.githubOAuthFake]
  }
}

export type StartupSink = {
  error(line: string): void
  exit(code: number): never
}

// For `index.ts` (QA 031 F3): an invalid configuration is one structured log line, like the
// database startup error, then exit code 1. No stack trace; the line names settings, never a
// value. Anything that is not a `ConfigError` is logged with the generic internal message.
// `environment` may be a function (plan 042: it reads the env files), so its failures are
// reported the same way.
export function loadConfigOrExit(environment: Environment | (() => Environment), sink: StartupSink): AppConfig {
  try {
    return loadConfig(typeof environment === 'function' ? environment() : environment)
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : ERROR_MESSAGE.internal
    sink.error(JSON.stringify({ level: LogLevel.Error, operation: LOG_OPERATION.startup, message }))
    return sink.exit(1)
  }
}
