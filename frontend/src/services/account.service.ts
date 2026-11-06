import { API_PATH } from '../lib/api.constants'
import { isAccountDto, isAvatarPath } from '../models/account.model'
import { AppError } from '../models/app-error'
import type { AccountDto, AccountUpdateDto, PasswordChangeDto, RegistrationDto } from '../models/dto'
import { isRecord, isString } from '../models/guard'
import { parseDto } from '../models/review.model'
import { ERROR_CODE } from '../utils/error-messages'
import { del, get, post, put, type DataSource } from './data-source'

// The signed-in account's profile, registration, the password change and the profile photo.
// A wrong current password rejects with a 422 AppError whose `issueList` names the field
// (`currentPassword`). Sign-out moved to session.service (DELETE /api/session, plan 028).
export interface AccountService {
  get(): Promise<AccountDto>
  // POST /api/account: 201 with the account, already signed in (Open Question 6).
  register(input: RegistrationDto): Promise<AccountDto>
  changePassword(input: PasswordChangeDto): Promise<void>
  // Plan 034: PUT /api/account, the user name and/or email (the current password is required).
  // Answers the updated account; the session stays valid.
  update(input: AccountUpdateDto): Promise<AccountDto>
  // Plan 040: POST /api/auth/github/link answers the GitHub authorize URL to navigate to.
  linkGithub(): Promise<string>
  // Plan 040: DELETE /api/auth/github/link answers the account without the link.
  unlinkGithub(): Promise<AccountDto>
  // PUT /api/account/avatar with the raw image as the body; answers the account with its new avatarUrl.
  uploadAvatar(file: Blob, contentType: string): Promise<AccountDto>
  removeAvatar(): Promise<AccountDto>
  // GET of the account's `avatarUrl` through the one request path. Resolves with its bytes.
  getAvatar(avatarUrl: string, signal?: AbortSignal): Promise<Blob>
}

export function createAccountService(source: DataSource): AccountService {
  return {
    async get() {
      return parseDto(await get<unknown>(source, API_PATH.account), isAccountDto)
    },
    async register(input) {
      return parseDto(await post<unknown>(source, API_PATH.account, { username: input.username, email: input.email, password: input.password }), isAccountDto)
    },
    async changePassword(input) {
      await put(source, API_PATH.accountPassword, { currentPassword: input.currentPassword, newPassword: input.newPassword })
    },
    async update(input) {
      const body: AccountUpdateDto = { currentPassword: input.currentPassword }
      if (input.username !== undefined) body.username = input.username
      if (input.email !== undefined) body.email = input.email
      return parseDto(await put<unknown>(source, API_PATH.account, body), isAccountDto)
    },
    async linkGithub() {
      const answer = await post<unknown>(source, API_PATH.githubSignInLink)
      if (!isRecord(answer) || !isString(answer.url)) throw new AppError({ code: ERROR_CODE.parse, kind: 'parse', message: 'no GitHub url' })
      return answer.url
    },
    async unlinkGithub() {
      return parseDto(await del<unknown>(source, API_PATH.githubSignInLink), isAccountDto)
    },
    async uploadAvatar(file, contentType) {
      return parseDto(await put<unknown>(source, API_PATH.accountAvatar, file, { contentType }), isAccountDto)
    },
    async removeAvatar() {
      return parseDto(await del<unknown>(source, API_PATH.accountAvatar), isAccountDto)
    },
    async getAvatar(avatarUrl, signal) {
      if (!isAvatarPath(avatarUrl)) throw new AppError({ code: ERROR_CODE.parse, kind: 'parse', message: 'not the avatar path' })
      const photo = await get<unknown>(source, avatarUrl, { signal, responseType: 'blob' })
      if (!(photo instanceof Blob)) throw new AppError({ code: ERROR_CODE.parse, kind: 'parse', message: 'the photo is not bytes' })
      return photo
    }
  }
}
