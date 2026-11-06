import type { AnalyzerResult } from '../analyzer/analyzer.js'
import type { CountedSeverity, FailureReason, GeneratedTestFile, SavedReview, Settings, TestConfig } from '../model/dto.js'
import { DATABASE, REVIEW_DEFAULT, TICKET, TIME } from '../utils/constants.js'
import { ReviewStatus, Severity } from '../utils/domain.js'
import { seedAccount, seedSettings } from './seed.js'
import type {
  AccountChange, AccountRecord, AvatarRecord, CreateIdentityResult, IdentityRecord, StoredAccount, UpdateAccountResult, CreateAccountResult, DashboardCount, DashboardWindow, GithubConnectionRecord, NewAccountRecord, RestartResult,
  ReviewRecord, ReviewRestart, ReviewSummaryRecord, SessionRecord, StatusCount, Store, SupportRequestRecord, UnfinishedReview
} from './store.js'

// The in-memory `Store`: the unit tests use it, and the backend falls back to it when
// `DATABASE_URL` is not set (plan 022), with a warning that nothing survives a restart (sessions
// included, so everyone signs in again after a restart). Single instance. Since plan 028 the
// state is kept per org (one org per registered account); the `default` org belongs to the demo
// account. On creation and on `reset()` only the demo org exists, with no reviews (plan 019
// addendum: API mode starts empty).
//
// `orgMap` and `sessionMap` stay public so tests can put records in and inspect them, and
// `state` is the demo (`default`) org's state; services only use the async `Store` methods,
// which copy on the way in and out, like a database would.

export type { ReviewRecord, SupportRequestRecord } from './store.js'

export type OrgState = {
  name: string
  // Newest first.
  reviewList: ReviewRecord[]
  // Null when no GitHub user is connected (plan 030).
  github: { connection: GithubConnectionRecord | null }
  settings: Settings
  account: StoredAccount
  supportRequestList: SupportRequestRecord[]
  avatar: AvatarRecord | undefined
}

const countedSeverityList: CountedSeverity[] = [Severity.Critical, Severity.High, Severity.Medium, Severity.Low]
const msPerDay = TIME.msPerSecond * TIME.secondsPerDay

function orgStateOf(name: string, account: StoredAccount, settings: Settings): OrgState {
  return { name, reviewList: [], github: { connection: null }, settings, account, supportRequestList: [], avatar: undefined }
}

function seedOrgMap(): Map<string, OrgState> {
  const { avatarDigest: _none, githubLogin: _login, ...account } = seedAccount()
  return new Map([[DATABASE.defaultOrgId, orgStateOf(DATABASE.defaultOrgName, account, seedSettings())]])
}

function identityKey(provider: string, providerUserId: string): string {
  return `${provider}:${providerUserId}`
}

function dayOf(time: number): number {
  return Math.floor(time / msPerDay)
}

function statusCountOf(recordList: ReviewRecord[]): StatusCount {
  const completed = recordList.filter((record) => record.review.status === ReviewStatus.Completed)
  return {
    total: recordList.length,
    completed: completed.length,
    failed: recordList.filter((record) => record.review.status === ReviewStatus.Failed).length,
    qualitySum: completed.reduce((sum, record) => sum + record.review.qualityScore, 0)
  }
}

function copyAvatar(avatar: AvatarRecord): AvatarRecord {
  return { ...avatar, data: Buffer.from(avatar.data) }
}

export class MemoryStore implements Store {
  orgMap: Map<string, OrgState>
  sessionMap: Map<string, SessionRecord>
  // Sign-in identities (plan 040), keyed by `provider:providerUserId`.
  identityMap: Map<string, IdentityRecord>
  nextTicketNumber: number

  constructor() {
    this.orgMap = seedOrgMap()
    this.sessionMap = new Map()
    this.identityMap = new Map()
    this.nextTicketNumber = TICKET.first
  }

  // The demo account's org, for tests (it always exists: the seed and every reset create it).
  get state(): OrgState {
    const state = this.orgMap.get(DATABASE.defaultOrgId)
    if (!state) throw new Error('The demo org is missing from the memory store.')
    return state
  }

  private org(orgId: string): OrgState | undefined {
    return this.orgMap.get(orgId)
  }

  // The live record of a review that is not deleted (internal; callers get copies).
  private live(orgId: string, id: string): ReviewRecord | undefined {
    return this.org(orgId)?.reviewList.find((record) => record.id === id && !record.deleted)
  }

  private liveOnRun(orgId: string, id: string, run: number): ReviewRecord | undefined {
    const record = this.live(orgId, id)
    return record?.run === run ? record : undefined
  }

  async listReviewSummary(orgId: string): Promise<ReviewSummaryRecord[]> {
    return (this.org(orgId)?.reviewList ?? [])
      .filter((record) => !record.deleted)
      .map((record) => ({
        id: record.id,
        title: record.saved?.name ?? record.review.title,
        language: record.review.language,
        status: record.review.status,
        createdAt: record.createdAt,
        findingCount: structuredClone(record.review.findingCount)
      }))
  }

  async findReview(orgId: string, id: string): Promise<ReviewRecord | undefined> {
    const record = this.live(orgId, id)
    return record ? structuredClone(record) : undefined
  }

  async createReview(orgId: string, record: ReviewRecord): Promise<void> {
    this.org(orgId)?.reviewList.unshift(structuredClone(record))
  }

  async saveReview(orgId: string, id: string, saved: SavedReview): Promise<boolean> {
    const record = this.live(orgId, id)
    if (!record) return false
    record.saved = { ...saved }
    return true
  }

  async restartReview(orgId: string, id: string, restart: ReviewRestart, unfinishedStatusList: readonly string[]): Promise<RestartResult> {
    const record = this.live(orgId, id)
    if (!record) return { ok: false, reason: 'not_found' }
    if (unfinishedStatusList.includes(record.review.status)) {
      return { ok: false, reason: 'unfinished', status: record.review.status }
    }
    record.saved = { ...restart.saved }
    record.failureReason = null
    record.run += 1
    record.analyzedAt = restart.analyzedAt
    record.review = {
      ...record.review,
      status: ReviewStatus.Pending,
      language: restart.language,
      content: restart.content,
      qualityScore: REVIEW_DEFAULT.initialQualityScore,
      findingCount: [],
      finding: [],
      suggestion: [],
      generatedTest: []
    }
    return { ok: true, run: record.run }
  }

  async completeReview(orgId: string, id: string, run: number, result: AnalyzerResult): Promise<boolean> {
    const record = this.liveOnRun(orgId, id, run)
    if (!record) return false
    record.review = { ...record.review, ...structuredClone(result), status: ReviewStatus.Completed }
    return true
  }

  async failReview(orgId: string, id: string, run: number, reason: FailureReason): Promise<boolean> {
    const record = this.liveOnRun(orgId, id, run)
    if (!record) return false
    record.review = { ...record.review, status: ReviewStatus.Failed }
    record.failureReason = reason
    return true
  }

  async markReviewStatus(orgId: string, id: string, run: number, status: 'queued' | 'in_progress', unfinishedStatusList: readonly string[]): Promise<boolean> {
    const record = this.liveOnRun(orgId, id, run)
    if (!record || !unfinishedStatusList.includes(record.review.status)) return false
    record.review = { ...record.review, status }
    return true
  }

  async replaceGeneratedTest(orgId: string, id: string, fileList: GeneratedTestFile[], testConfig?: TestConfig): Promise<boolean> {
    const record = this.live(orgId, id)
    if (!record) return false
    record.review = { ...record.review, generatedTest: structuredClone(fileList) }
    if (testConfig) record.testConfig = structuredClone(testConfig)
    return true
  }

  async deleteReview(orgId: string, id: string): Promise<boolean> {
    const record = this.live(orgId, id)
    if (!record) return false
    record.deleted = true
    return true
  }

  async listUnfinishedReview(unfinishedStatusList: readonly string[]): Promise<UnfinishedReview[]> {
    return [...this.orgMap].flatMap(([orgId, org]) => org.reviewList
      .filter((record) => !record.deleted && unfinishedStatusList.includes(record.review.status))
      .map((record) => ({ orgId, id: record.id, run: record.run })))
  }

  async getDashboardCount(orgId: string, window: DashboardWindow): Promise<DashboardCount> {
    const recordList = (this.org(orgId)?.reviewList ?? []).filter((record) => !record.deleted)
    const inWindow = (firstDay: number) => recordList.filter((record) => {
      const day = dayOf(record.createdAt)
      return day >= firstDay && day < firstDay + window.trendDay
    })

    const severityCount = Object.fromEntries(countedSeverityList.map((severity) => [
      severity,
      recordList.reduce((sum, record) =>
        sum + (record.review.findingCount.find((item) => item.severity === severity)?.count ?? 0), 0)
    ])) as Record<CountedSeverity, number>

    const categoryCount: DashboardCount['categoryCount'] = {}
    for (const record of recordList) {
      for (const finding of record.review.finding) {
        categoryCount[finding.category] = (categoryCount[finding.category] ?? 0) + 1
      }
    }

    const activity = new Map<number, number>()
    for (const record of recordList) {
      const day = dayOf(record.createdAt)
      if (day >= window.activityFirstDay && day <= window.today) activity.set(day, (activity.get(day) ?? 0) + 1)
    }

    return {
      all: statusCountOf(recordList),
      current: statusCountOf(inWindow(window.currentFirstDay)),
      previous: statusCountOf(inWindow(window.previousFirstDay)),
      severityCount,
      categoryCount,
      activityCount: [...activity].map(([day, count]) => ({ day, count })).sort((first, second) => first.day - second.day)
    }
  }

  async getSettings(orgId: string): Promise<Settings> {
    const org = this.org(orgId)
    return org ? structuredClone(org.settings) : seedSettings()
  }

  async saveSettings(orgId: string, settings: Settings): Promise<void> {
    const org = this.org(orgId)
    if (org) org.settings = structuredClone(settings)
  }

  async createAccount(input: NewAccountRecord): Promise<CreateAccountResult> {
    const username = input.account.username.toLowerCase()
    const email = input.account.email.toLowerCase()
    const taken = this.orgMap.has(input.orgId) || [...this.orgMap.values()].some((org) =>
      org.account.username.toLowerCase() === username || org.account.email.toLowerCase() === email)
    if (taken) return { ok: false, reason: 'conflict' }
    if (input.identity && this.identityMap.has(identityKey(input.identity.provider, input.identity.providerUserId))) return { ok: false, reason: 'conflict' }
    this.orgMap.set(input.orgId, orgStateOf(input.orgName, { ...input.account, email }, structuredClone(input.settings)))
    if (input.identity) this.identityMap.set(identityKey(input.identity.provider, input.identity.providerUserId), { ...input.identity, orgId: input.orgId })
    return { ok: true }
  }

  private accountRecordOf(orgId: string, org: OrgState): AccountRecord {
    const identity = [...this.identityMap.values()].find((item) => item.orgId === orgId)
    return { ...org.account, avatarDigest: org.avatar?.digest ?? null, githubLogin: identity?.login ?? null }
  }

  async getAccount(orgId: string): Promise<AccountRecord | undefined> {
    const org = this.org(orgId)
    return org ? this.accountRecordOf(orgId, org) : undefined
  }

  async findAccountByEmail(email: string): Promise<{ orgId: string } | undefined> {
    const needle = email.toLowerCase()
    for (const [orgId, org] of this.orgMap) {
      if (org.account.email.toLowerCase() === needle) return { orgId }
    }
    return undefined
  }

  async findIdentity(provider: IdentityRecord['provider'], providerUserId: string): Promise<IdentityRecord | undefined> {
    const identity = this.identityMap.get(identityKey(provider, providerUserId))
    return identity ? { ...identity } : undefined
  }

  async findIdentityByOrg(orgId: string, provider: IdentityRecord['provider']): Promise<IdentityRecord | undefined> {
    const identity = [...this.identityMap.values()].find((item) => item.orgId === orgId && item.provider === provider)
    return identity ? { ...identity } : undefined
  }

  async createIdentity(identity: IdentityRecord): Promise<CreateIdentityResult> {
    const key = identityKey(identity.provider, identity.providerUserId)
    const orgTaken = [...this.identityMap.values()].some((item) => item.orgId === identity.orgId && item.provider === identity.provider)
    if (!this.orgMap.has(identity.orgId) || this.identityMap.has(key) || orgTaken) return { ok: false, reason: 'conflict' }
    this.identityMap.set(key, { ...identity })
    return { ok: true }
  }

  async setIdentityLogin(provider: IdentityRecord['provider'], providerUserId: string, login: string): Promise<void> {
    const identity = this.identityMap.get(identityKey(provider, providerUserId))
    if (identity) identity.login = login
  }

  async deleteIdentity(orgId: string, provider: IdentityRecord['provider']): Promise<boolean> {
    for (const [key, item] of this.identityMap) {
      if (item.orgId === orgId && item.provider === provider) return this.identityMap.delete(key)
    }
    return false
  }

  async findAccountByUsername(username: string): Promise<{ orgId: string, account: AccountRecord } | undefined> {
    const needle = username.toLowerCase()
    for (const [orgId, org] of this.orgMap) {
      if (org.account.username.toLowerCase() === needle) return { orgId, account: this.accountRecordOf(orgId, org) }
    }
    return undefined
  }

  async setPasswordHash(orgId: string, passwordHash: string): Promise<void> {
    const org = this.org(orgId)
    if (org) org.account.passwordHash = passwordHash
  }

  // Unique among the OTHER accounts, like the PostgreSQL indexes: an account may keep its own
  // value or change only its letter case.
  async updateAccount(orgId: string, change: AccountChange): Promise<UpdateAccountResult> {
    const org = this.org(orgId)
    if (!org) return { ok: false, reason: 'not_found' }
    const username = change.username?.toLowerCase()
    const email = change.email?.toLowerCase()
    const taken = [...this.orgMap].some(([otherId, other]) => otherId !== orgId &&
      (other.account.username.toLowerCase() === username || other.account.email.toLowerCase() === email))
    if (taken) return { ok: false, reason: 'conflict' }
    if (change.username !== undefined) org.account.username = change.username
    if (email !== undefined) org.account.email = email
    return { ok: true }
  }

  async getAvatar(orgId: string): Promise<AvatarRecord | undefined> {
    const avatar = this.org(orgId)?.avatar
    return avatar ? copyAvatar(avatar) : undefined
  }

  async setAvatar(orgId: string, avatar: AvatarRecord): Promise<void> {
    const org = this.org(orgId)
    if (org) org.avatar = copyAvatar(avatar)
  }

  async deleteAvatar(orgId: string): Promise<void> {
    const org = this.org(orgId)
    if (org) org.avatar = undefined
  }

  async createSession(session: SessionRecord): Promise<void> {
    if (this.org(session.orgId)) this.sessionMap.set(session.idHash, { ...session })
  }

  async findSession(idHash: string): Promise<SessionRecord | undefined> {
    const session = this.sessionMap.get(idHash)
    return session ? { ...session } : undefined
  }

  async touchSession(idHash: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    const session = this.sessionMap.get(idHash)
    if (session) Object.assign(session, { lastSeenAt, expiresAt })
  }

  async deleteSession(idHash: string): Promise<void> {
    this.sessionMap.delete(idHash)
  }

  async deleteOrgSession(orgId: string): Promise<void> {
    for (const [idHash, session] of this.sessionMap) if (session.orgId === orgId) this.sessionMap.delete(idHash)
  }

  async deleteExpiredSession(now: number): Promise<void> {
    for (const [idHash, session] of this.sessionMap) {
      if (session.expiresAt <= now || session.absoluteExpiresAt <= now) this.sessionMap.delete(idHash)
    }
  }

  async getGithubConnection(orgId: string): Promise<GithubConnectionRecord | undefined> {
    const connection = this.org(orgId)?.github.connection
    return connection ? { ...connection } : undefined
  }

  async setGithubConnection(orgId: string, connection: GithubConnectionRecord | null): Promise<void> {
    const org = this.org(orgId)
    if (org) org.github.connection = connection ? { ...connection } : null
  }

  // One ticket counter for every org, like the PostgreSQL sequence.
  async createSupportRequest(orgId: string, input: Omit<SupportRequestRecord, 'ticket'>): Promise<string> {
    const number = this.nextTicketNumber
    this.nextTicketNumber = number >= TICKET.last ? TICKET.first : number + 1
    const ticket = `${TICKET.prefix}${String(number).padStart(TICKET.digits, TICKET.padChar)}`
    this.org(orgId)?.supportRequestList.push({ ticket, ...input })
    return ticket
  }

  // Back to the seed; tests call it (or build a new store) for isolation. The state is replaced
  // before the promise is returned, so a caller that does not await still sees the seed.
  async reset(): Promise<void> {
    this.orgMap = seedOrgMap()
    this.sessionMap = new Map()
    this.identityMap = new Map()
    this.nextTicketNumber = TICKET.first
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

export function createMemoryStore(): MemoryStore {
  return new MemoryStore()
}
