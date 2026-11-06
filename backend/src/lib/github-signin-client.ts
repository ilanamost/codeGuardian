import { z } from 'zod'
import type { FetchLike } from './github-fetch.js'
import { GITHUB_API, GITHUB_SIGNIN } from '../utils/constants.js'

// The GitHub side of "Continue with GitHub" (plan 040), behind a narrow interface so the tests
// use the fake in `github-signin-fake.ts` and never reach github.com. The access token lives in
// memory for one callback request and is dropped: it is never stored, logged or returned.

// What the sign-in keeps of a GitHub user. `id` is GitHub's numeric user id (the identity key,
// never the login, which can be renamed and reused). `email` is the verified primary email.
export type GithubProfile = {
  id: string
  login: string
  name: string | null
  email: string | null
  emailVerified: boolean
}

export interface GithubSignInClient {
  // Trades the authorization code (and the PKCE verifier) for an access token.
  exchangeCode(code: string, verifier: string): Promise<string>
  fetchProfile(accessToken: string): Promise<GithubProfile>
}

// Any failure on the GitHub side. The message is fixed text: nothing GitHub sent is kept, so it
// is safe to log, and the callback turns it into `provider_error`.
export class GithubSignInError extends Error {
  constructor() {
    super('GitHub sign-in failed.')
    this.name = 'GithubSignInError'
  }
}

export type GithubSignInClientOption = {
  fetch: FetchLike
  clientId: string
  clientSecret: string
  redirectUrl: string
  callTimeoutMs?: number
}

const tokenSchema = z.object({ access_token: z.string().min(1).max(GITHUB_SIGNIN.tokenMax) })
const userSchema = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().regex(GITHUB_SIGNIN.loginPattern),
  name: z.string().nullable().optional()
})
const emailListSchema = z.array(z.object({
  email: z.string(),
  primary: z.boolean(),
  verified: z.boolean()
}))

// Reads the body through a byte counter that stops at the cap; a longer answer is a failure.
async function readCapped(response: Response, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get(GITHUB_API.headerName.contentLength))
  if (Number.isFinite(declared) && declared > GITHUB_SIGNIN.responseByteMax) throw new GithubSignInError()
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunkList: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      if (signal.aborted) throw new GithubSignInError()
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > GITHUB_SIGNIN.responseByteMax) throw new GithubSignInError()
      chunkList.push(value)
    }
  } catch (error) {
    reader.cancel().catch(() => undefined)
    throw error
  }
  return Buffer.concat(chunkList).toString('utf8')
}

// The real client over Node's `fetch`: redirects are not followed, every call has a timeout,
// the answer must be JSON and is size-capped, and only the fields below are ever read.
export function createGithubSignInClient(option: GithubSignInClientOption): GithubSignInClient {
  const timeoutMs = option.callTimeoutMs ?? GITHUB_SIGNIN.callTimeoutMs

  async function call(url: string, init: RequestInit): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      const response = await option.fetch(url, { ...init, redirect: 'manual', signal })
      // Not 2xx, a redirect included (it is never followed).
      if (!response.ok) throw new GithubSignInError()
      const type = response.headers.get(GITHUB_API.headerName.contentType) ?? ''
      if (!type.toLowerCase().includes(GITHUB_API.jsonType)) throw new GithubSignInError()
      return JSON.parse(await readCapped(response, signal)) as unknown
    } catch (error) {
      if (error instanceof GithubSignInError) throw error
      // A timeout, a network failure or a body that is not JSON: one fixed error.
      throw new GithubSignInError()
    }
  }

  function apiHeader(accessToken: string): Record<string, string> {
    return {
      [GITHUB_API.headerName.accept]: GITHUB_API.header.accept,
      [GITHUB_API.headerName.apiVersion]: GITHUB_API.header.apiVersion,
      [GITHUB_API.headerName.userAgent]: GITHUB_API.header.userAgent,
      [GITHUB_API.headerName.authorization]: `Bearer ${accessToken}`
    }
  }

  return {
    async exchangeCode(code, verifier) {
      const body = await call(GITHUB_SIGNIN.tokenUrl, {
        method: 'POST',
        headers: {
          [GITHUB_API.headerName.accept]: GITHUB_API.jsonType,
          [GITHUB_API.headerName.contentType]: GITHUB_API.jsonType,
          [GITHUB_API.headerName.userAgent]: GITHUB_API.header.userAgent
        },
        body: JSON.stringify({
          client_id: option.clientId,
          client_secret: option.clientSecret,
          code,
          redirect_uri: option.redirectUrl,
          code_verifier: verifier
        })
      })
      // GitHub answers a bad code with 200 and `{ error }`: that has no `access_token`.
      const parsed = tokenSchema.safeParse(body)
      if (!parsed.success) throw new GithubSignInError()
      return parsed.data.access_token
    },

    async fetchProfile(accessToken) {
      const user = userSchema.safeParse(await call(GITHUB_SIGNIN.userUrl, { method: 'GET', headers: apiHeader(accessToken) }))
      if (!user.success) throw new GithubSignInError()
      const emailList = emailListSchema.safeParse(await call(GITHUB_SIGNIN.emailUrl, { method: 'GET', headers: apiHeader(accessToken) }))
      if (!emailList.success) throw new GithubSignInError()
      // Only the verified primary email counts; the public profile email is never used.
      const primary = emailList.data.find((item) => item.primary && item.verified)
      return {
        id: String(user.data.id),
        login: user.data.login,
        name: user.data.name ?? null,
        email: primary?.email ?? null,
        emailVerified: primary !== undefined
      }
    }
  }
}
