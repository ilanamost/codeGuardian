import type { AnalyzerResult } from '../analyzer/analyzer.js'
import type { IdentityProvider } from '../utils/domain.js'
import type { CountedSeverity, FailureReason, FindingCategory, FindingCount, GeneratedTestFile, Review, ReviewStatus, SavedReview, Settings, TestConfig } from '../model/dto.js'

// The narrow, async interface every service uses to read and change data (plan 022). Two
// implementations: `MemoryStore` (unit tests, and the fallback when `DATABASE_URL` is not set)
// and `PgStore` (PostgreSQL). Services never see how data is kept. Every method returns copies,
// so a caller can never change stored data by mutating a result.
// Since plan 028 every registered account has its own org; `org_id` is the isolation boundary.

export type ReviewRecord = {
  id: string
  review: Review
  // Epoch milliseconds from the injected clock; drives the History `timeAgo` and the Dashboard
  // activity. Never changes after create.
  createdAt: number
  // Epoch milliseconds of the latest analysis start (create or run); drives `analyzedAgo`.
  analyzedAt: number
  // Increments on every run (plan 021 revision 1). A background analysis that started under an
  // older value is discarded when it finishes, so a late result cannot overwrite a newer run.
  run: number
  saved: SavedReview | null
  deleted: boolean
  // The stored test configuration (plan 034). Absent or null: the review never had one (every
  // review before migration 004), and it reads as `TEST_CONFIG_DEFAULT`.
  testConfig?: TestConfig | null
  // Why the review failed (contract 0.14.0, plan 039); absent or null unless the status is
  // failed. A new run clears it.
  failureReason?: FailureReason | null
}

// One History row before the service formats it.
export type ReviewSummaryRecord = {
  id: string
  title: string
  language: string
  status: ReviewStatus
  createdAt: number
  findingCount: FindingCount[]
}

// A run restarts the analysis of a review with its saved edit (contract 0.6.0).
export type ReviewRestart = {
  saved: SavedReview
  language: string
  content: string
  analyzedAt: number
}

export type RestartResult =
  | { ok: true, run: number }
  | { ok: false, reason: 'not_found' }
  | { ok: false, reason: 'unfinished', status: ReviewStatus }

// One account per org (plan 028): the org id is the account's id.
export type AccountRecord = {
  username: string
  fullName: string
  // Stored lower-cased.
  email: string
  memberSince: string
  // Null for an account that signs in with GitHub only (plan 040, Open Question 4): it has no
  // password and cannot use POST /api/session.
  passwordHash: string | null
  // SHA-256 hex of the profile photo, or null; the service builds `avatarUrl` from it.
  avatarDigest: string | null
  // The linked GitHub login (plan 040), or null; read from the account's `account_identity`.
  githubLogin: string | null
}

// What a store keeps in the account row itself (the photo and the identity have own tables).
export type StoredAccount = Omit<AccountRecord, 'avatarDigest' | 'githubLogin'>

// A sign-in identity of an account (plan 040): the provider's numeric user id is the key, the
// login is only for display and is refreshed at each sign-in. No token is ever kept.
export type IdentityRecord = {
  provider: `${IdentityProvider}`
  providerUserId: string
  orgId: string
  login: string
}

// `conflict`: that provider user is already linked, or the org already has an identity of the provider.
export type CreateIdentityResult = { ok: true } | { ok: false, reason: 'conflict' }

// What registration creates in one step: the org, the account, the default settings and the
// GitHub state row.
export type NewAccountRecord = {
  orgId: string
  orgName: string
  account: StoredAccount
  settings: Settings
  // Sign-up with GitHub (plan 040): the identity is created in the same step as the account.
  identity?: Omit<IdentityRecord, 'orgId'>
}

// `conflict`: the user name or the email is already used (case-insensitive).
export type CreateAccountResult = { ok: true } | { ok: false, reason: 'conflict' }

// A user name and/or email change (plan 034). The email is lower-cased by the caller.
export type AccountChange = { username?: string, email?: string }

// `conflict`: another account already uses the user name or the email (case-insensitive);
// `not_found`: the org has no account. Nothing changes on either.
export type UpdateAccountResult = { ok: true } | { ok: false, reason: 'conflict' | 'not_found' }

// A server-side session (plan 028). `idHash` is the SHA-256 hex of the random session id; the
// id itself is never stored. Times are epoch milliseconds.
export type SessionRecord = {
  idHash: string
  orgId: string
  createdAt: number
  lastSeenAt: number
  // Idle expiry (rolling), never after `absoluteExpiresAt`.
  expiresAt: number
  absoluteExpiresAt: number
}

// The connected GitHub user of an org (plan 030): GitHub's `login` (checked against the user-name
// pattern) and the display name, or null when the user has none. No token: public data only.
export type GithubConnectionRecord = {
  login: string
  name: string | null
}

export type AvatarRecord = {
  contentType: string
  data: Buffer
  digest: string
  updatedAt: number
}

// An unfinished review, with the org it belongs to (resumed on start).
export type UnfinishedReview = { orgId: string, id: string, run: number }

export type SupportRequestRecord = {
  ticket: string
  issueType: string
  email: string
  reviewId: string
  priority: string
  description: string
  createdAt: string
}

// UTC calendar days (epoch milliseconds / ms per day, floored) the Dashboard asks about.
export type DashboardWindow = {
  // First day of the current trend window; the window is `trendDay` days long.
  currentFirstDay: number
  // First day of the trend window just before it, also `trendDay` days long.
  previousFirstDay: number
  trendDay: number
  // Activity is counted from this day up to `today`, both included.
  activityFirstDay: number
  today: number
}

// Status counts and the quality score sum of completed reviews, for one set of reviews.
export type StatusCount = { total: number, completed: number, failed: number, qualitySum: number }

// What the Dashboard is computed from. Deleted reviews never count.
export type DashboardCount = {
  all: StatusCount
  current: StatusCount
  previous: StatusCount
  severityCount: Record<CountedSeverity, number>
  categoryCount: Partial<Record<FindingCategory, number>>
  // Reviews created per UTC day, only days with at least one review.
  activityCount: { day: number, count: number }[]
}

// Every user-data method takes the org id first (plan 028): the session's org, never a
// constant. A record of another org is invisible: it reads as missing, and a write to it
// changes nothing (false), so a foreign review id is a 404.
export interface Store {
  // Reviews that are not deleted, newest first.
  listReviewSummary(orgId: string): Promise<ReviewSummaryRecord[]>
  // A review that is not deleted.
  findReview(orgId: string, id: string): Promise<ReviewRecord | undefined>
  createReview(orgId: string, record: ReviewRecord): Promise<void>
  // Sets the saved edit of a review that is not deleted; false when there is none.
  saveReview(orgId: string, id: string, saved: SavedReview): Promise<boolean>
  // Starts a new run unless the review is missing or its analysis is unfinished, in one step.
  restartReview(orgId: string, id: string, restart: ReviewRestart, unfinishedStatusList: readonly string[]): Promise<RestartResult>
  // Writes an analysis result only while the review is not deleted and still on `run`
  // (the run-guarded conditional update); false when the result was discarded.
  completeReview(orgId: string, id: string, run: number, result: AnalyzerResult): Promise<boolean>
  // Marks the review failed with its reason (plan 039), with the same guard as `completeReview`.
  failReview(orgId: string, id: string, run: number, reason: FailureReason): Promise<boolean>
  // Moves an unfinished review to `queued` or `in_progress` (plan 039) while it is not deleted,
  // still on `run` and unfinished; false when the run is gone, so its analysis can be skipped.
  markReviewStatus(orgId: string, id: string, run: number, status: 'queued' | 'in_progress', unfinishedStatusList: readonly string[]): Promise<boolean>
  // Replaces the generated tests and, when one is given, stores the test configuration with
  // them in the same step (plan 034).
  replaceGeneratedTest(orgId: string, id: string, fileList: GeneratedTestFile[], testConfig?: TestConfig): Promise<boolean>
  // Soft delete; false when the review is missing or already deleted.
  deleteReview(orgId: string, id: string): Promise<boolean>
  // Reviews of every org whose analysis had not finished (re-analyzed on start).
  listUnfinishedReview(unfinishedStatusList: readonly string[]): Promise<UnfinishedReview[]>
  getDashboardCount(orgId: string, window: DashboardWindow): Promise<DashboardCount>

  getSettings(orgId: string): Promise<Settings>
  saveSettings(orgId: string, settings: Settings): Promise<void>

  // Registration: org, account, default settings and GitHub row in one step.
  createAccount(input: NewAccountRecord): Promise<CreateAccountResult>
  getAccount(orgId: string): Promise<AccountRecord | undefined>
  // Case-insensitive.
  findAccountByUsername(username: string): Promise<{ orgId: string, account: AccountRecord } | undefined>
  // Case-insensitive; the org of the account that has this email (plan 040).
  findAccountByEmail(email: string): Promise<{ orgId: string } | undefined>
  setPasswordHash(orgId: string, passwordHash: string): Promise<void>
  // Changes the user name and/or email of the org's account in one step (plan 034); unique
  // among the other accounts regardless of case.
  updateAccount(orgId: string, change: AccountChange): Promise<UpdateAccountResult>

  // Sign-in identities (plan 040).
  findIdentity(provider: IdentityRecord['provider'], providerUserId: string): Promise<IdentityRecord | undefined>
  findIdentityByOrg(orgId: string, provider: IdentityRecord['provider']): Promise<IdentityRecord | undefined>
  createIdentity(identity: IdentityRecord): Promise<CreateIdentityResult>
  setIdentityLogin(provider: IdentityRecord['provider'], providerUserId: string, login: string): Promise<void>
  // True when the org had an identity of the provider and it is gone.
  deleteIdentity(orgId: string, provider: IdentityRecord['provider']): Promise<boolean>

  getAvatar(orgId: string): Promise<AvatarRecord | undefined>
  setAvatar(orgId: string, avatar: AvatarRecord): Promise<void>
  deleteAvatar(orgId: string): Promise<void>

  createSession(session: SessionRecord): Promise<void>
  findSession(idHash: string): Promise<SessionRecord | undefined>
  // Rolling idle expiry: sets `lastSeenAt` and `expiresAt`.
  touchSession(idHash: string, lastSeenAt: number, expiresAt: number): Promise<void>
  deleteSession(idHash: string): Promise<void>
  // Every session of the org (a password change).
  deleteOrgSession(orgId: string): Promise<void>
  // Sessions past their idle or absolute expiry at `now`.
  deleteExpiredSession(now: number): Promise<void>

  // The org's connected GitHub user, or undefined when none is connected (plan 030).
  getGithubConnection(orgId: string): Promise<GithubConnectionRecord | undefined>
  // Stores the connection (replacing any earlier one), or clears it with null.
  setGithubConnection(orgId: string, connection: GithubConnectionRecord | null): Promise<void>

  // Keeps the request and returns its new ticket (`TICKET` format, numbers wrap).
  createSupportRequest(orgId: string, input: Omit<SupportRequestRecord, 'ticket'>): Promise<string>

  // Back to the seed: every org emptied and removed, every session and photo gone, and only the
  // demo account (the `default` org) with the default settings, GitHub state and ticket counter.
  reset(): Promise<void>
  close(): Promise<void>
}
