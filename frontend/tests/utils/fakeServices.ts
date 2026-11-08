import { vi } from 'vitest'
import type { ThemeMode, AccountDto, AnalyzerKind, AccountUpdateDto, GithubAccountDto, GithubFileListDto, GithubImportDto, GithubRepoListDto, RegistrationDto, ReviewDetailDto, SessionDto, SignInDto, ReviewDto, SaveReviewDto, SavedReviewDto } from '../../src/models/dto'
import { AppSettings } from '../../src/models/settings.model'
import { fixtureData } from './fixtureData'
import { generatedTestFileList, sampleReview } from './sampleData'
import { recentReviewList, activityByRange, categoryCountList, dashboardStatList, severityCountList } from './sampleData'
import type { Services } from '../../src/services'
import { createNotificationService } from '../../src/services/notification.service'

// A review detail as GET answers it: by default its findings belong to its own code and language.
export function detailOf(id: string, review: ReviewDto, saved: SavedReviewDto | null = null): ReviewDetailDto {
  return { id, review, saved, analyzedContent: review.content, analyzedLanguage: review.language }
}

// Services with vi.fn() methods for store tests: resolve with mock data unless a test overrides them.
export function createFakeServices() {
  const toast = { success: vi.fn(), error: vi.fn() }
  const services = {
    review: {
      list: vi.fn(async () => structuredClone(recentReviewList)),
      get: vi.fn(async (id: string): Promise<ReviewDetailDto | null> => detailOf(id, structuredClone(sampleReview))),
      create: vi.fn(async () => detailOf('c1', structuredClone(sampleReview))),
      // Run review: the review saved with the edit and restarted (pending, empty results).
      run: vi.fn(async (id: string, input: SaveReviewDto): Promise<ReviewDetailDto> => {
        const review: ReviewDto = {
          ...structuredClone(sampleReview),
          status: 'pending',
          language: input.language,
          content: input.code,
          findingCount: [],
          finding: [],
          suggestion: [],
          generatedTest: []
        }
        return detailOf(id, review, { ...input, savedAt: 't' })
      }),
      save: vi.fn(async (_id: string, input: { name?: string; language: string; code: string }) => ({ ...input, savedAt: 't' })),
      rename: vi.fn(async (_id: string, name: string) => ({ name, language: 'Go', code: 'a', savedAt: 't' })),
      delete: vi.fn(async () => undefined),
      analyzer: vi.fn(async (): Promise<AnalyzerKind> => 'stub'),
      // The stub analyzer's swap: each file's code and variant change places.
      regenerateTest: vi.fn(async (_id: string) => generatedTestFileList.map((file) => ({ ...file, code: file.altCode, altCode: file.code })))
    },
    dashboard: {
      get: vi.fn(async () => structuredClone({ statList: dashboardStatList, severityCountList, categoryCountList, activityByRange }))
    },
    github: {
      // Contract 0.9.0 shapes: the account is { login, name } and the lists are { items, truncated }.
      connect: vi.fn(async (_username?: string): Promise<GithubAccountDto> => ({ login: 'octocat', name: 'The Octocat' })),
      disconnect: vi.fn(async () => undefined),
      getFile: vi.fn(async (_repoId: string, fileId: string) => ({ id: fileId, path: 'a.ts', language: 'TypeScript', content: 'const a = 1\n' })),
      searchRepo: vi.fn(async (_query: string): Promise<GithubRepoListDto> => ({ items: [{ id: 'repo', name: 'repo', description: '' }], truncated: false })),
      listFile: vi.fn(async (_repoId: string): Promise<GithubFileListDto> => ({ items: [{ id: 'f1', path: 'a.ts', language: 'TypeScript' }], truncated: false })),
      // POST /api/github/import: one file, nothing skipped, unless a test overrides it.
      importLink: vi.fn(async (_url: string): Promise<GithubImportDto> => ({
        name: 'a.ts',
        language: 'TypeScript',
        content: 'const a = 1\n',
        fileList: [{ path: 'src/a.ts', language: 'TypeScript', size: 12 }],
        skippedList: []
      }))
    },
    settings: {
      read: vi.fn(() => AppSettings.defaultDto()),
      get: vi.fn(async () => AppSettings.defaultDto()),
      save: vi.fn(async () => undefined),
      clearCache: vi.fn(() => undefined),
      readTheme: vi.fn((): ThemeMode | undefined => undefined),
      saveTheme: vi.fn((_theme: ThemeMode) => undefined)
    },
    support: {
      submit: vi.fn(async () => ({ ticket: 'SUP-1234' }))
    },
    account: {
      get: vi.fn(async () => structuredClone(fixtureData.account)),
      register: vi.fn(async (input: RegistrationDto): Promise<AccountDto> => ({ ...structuredClone(fixtureData.account), username: input.username, fullName: input.username, email: input.email })),
      changePassword: vi.fn(async (_input: { currentPassword: string; newPassword: string }) => undefined),
      // Plan 034: PUT /api/account answers the account with the sent user name and email.
      update: vi.fn(async (input: AccountUpdateDto): Promise<AccountDto> => ({
        ...structuredClone(fixtureData.account),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {})
      })),
      uploadAvatar: vi.fn(async (_file: Blob, _contentType: string): Promise<AccountDto> => ({ ...structuredClone(fixtureData.account), avatarUrl: '/api/account/avatar?v=abc123' })),
      removeAvatar: vi.fn(async (): Promise<AccountDto> => structuredClone(fixtureData.account)),
      // Plan 033: the photo's bytes (a 1x1 PNG header is enough for the UI).
      // Plan 040: link (the authorize URL) and unlink GitHub sign-in.
      linkGithub: vi.fn(async (): Promise<string> => 'https://github.example/authorize'),
      unlinkGithub: vi.fn(async (): Promise<AccountDto> => ({ ...structuredClone(fixtureData.account), signInMethod: 'password', githubLogin: null })),
      getAvatar: vi.fn(async (_avatarUrl: string, _signal?: AbortSignal): Promise<Blob> => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }))
    },
    // Plan 028: the fixture account is signed in unless a test overrides it.
    session: {
      restore: vi.fn(async (): Promise<SessionDto> => ({ account: structuredClone(fixtureData.account), expiresAt: '2026-10-28T10:00:00.000Z' })),
      signIn: vi.fn(async (_input: SignInDto): Promise<AccountDto> => structuredClone(fixtureData.account)),
      signOut: vi.fn(async () => undefined),
      githubSignIn: vi.fn(async () => false),
      exchangeGithubCode: vi.fn(async (_code: string) => undefined),
      abortAll: vi.fn(() => undefined)
    },
    report: {
      download: vi.fn(async () => undefined)
    },
    notification: createNotificationService({ toast })
  } satisfies Services
  return { services, toast }
}
