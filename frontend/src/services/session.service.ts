import { API_PATH } from '../lib/api.constants'
import { githubOAuthOf, isAccountDto, isSessionDto } from '../models/account.model'
import type { AccountDto, SessionDto, SignInDto } from '../models/dto'
import { parseDto } from '../models/review.model'
import { del, get, post, type DataSource } from './data-source'

// The server-side session (plan 028, contract 0.8.0). The session id lives in an
// HttpOnly cookie that the browser sends (api.service uses `credentials: 'include'`); no code
// here reads or stores it.
export interface SessionService {
  // GET /api/session: the signed-in account, or a 401 AppError when there is no valid session.
  restore(): Promise<SessionDto>
  // POST /api/session: one generic 401 for an unknown user name and a wrong password.
  signIn(input: SignInDto): Promise<AccountDto>
  // DELETE /api/session: ends the session on the server and clears the cookie.
  signOut(): Promise<void>
  // Plan 040: GET /api/health `githubOAuth`; a missing value is false.
  githubSignIn(): Promise<boolean>
  // Plan 048: POST /api/auth/github/exchange. Swaps the one-time code of the GitHub return URL for a
  // session token, which the data source keeps only when the cookie did not stick (plan 047). The
  // token is never returned. Any failure is an AppError.
  exchangeGithubCode(code: string, signal?: AbortSignal): Promise<void>
  // Cancels the data source's requests still in flight (sign-out, session ended; QA D1).
  abortAll(): void
}

export function createSessionService(source: DataSource): SessionService {
  return {
    async restore() {
      return parseDto(await get<unknown>(source, API_PATH.session), isSessionDto)
    },
    async signIn(input) {
      return parseDto(await post<unknown>(source, API_PATH.session, { username: input.username, password: input.password }), isAccountDto)
    },
    async signOut() {
      await del(source, API_PATH.session)
    },
    async githubSignIn() {
      return githubOAuthOf(await get<unknown>(source, API_PATH.health, { background: true }))
    },
    async exchangeGithubCode(code, signal) {
      await post<unknown>(source, API_PATH.githubExchange, { code }, { background: true, signal })
    },
    abortAll() {
      source.abortAll?.()
    }
  }
}
