import pg from 'pg'
import type { AnalyzerResult } from '../analyzer/analyzer.js'
import { conflictError } from '../lib/error.js'
import { connectError, DatabaseError, databaseError, DatabaseStartupError, errorCodeOf } from '../lib/db-error.js'
import type {
  CountedSeverity, FailureReason, Finding, FindingCategory, FindingCount, GeneratedTestFile, Review, ReviewStatus, SavedReview, Settings, Suggestion, TestConfig
} from '../model/dto.js'
import { testConfigSchema } from '../schema/review.schema.js'
import { CONFIG_KEY, DATABASE, LOG_MESSAGE, LOG_OPERATION, LogLevel, REVIEW_DEFAULT, TICKET, TIME_AGO_TEXT } from '../utils/constants.js'
import { IdentityProvider, ReviewStatus as Status, Severity } from '../utils/domain.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'
import { checkSchema, isTestDatabaseName } from './pg-schema.js'
import { seedAccount, seedSettings } from './seed.js'
import type {
  AccountChange, AccountRecord, AvatarRecord, CreateIdentityResult, IdentityRecord, UpdateAccountResult, CreateAccountResult, DashboardCount, DashboardWindow, GithubConnectionRecord, NewAccountRecord, RestartResult,
  ReviewRecord, ReviewRestart, ReviewSummaryRecord, SessionRecord, StatusCount, Store, SupportRequestRecord, UnfinishedReview
} from './store.js'

// The PostgreSQL `Store` (plan 022): the plain `pg` driver, parameterized SQL only (never a
// string-built query). Since plan 028 every user-data query filters by the org id the caller
// passes (the session's org, one org per account); nothing is hardcoded to `default`. Errors leave
// as `DatabaseError` (operation name and code only), so no log line can carry submitted code,
// the password hash or the connection string. Schema: `db/schema.sql`.

// What `PgStore` needs from a pool; a fake can stand in for it in unit tests.
export type PgPool = Pick<pg.Pool, 'query' | 'connect' | 'end'>

type Query = <R extends pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<pg.QueryResult<R>>

type ReviewRow = {
  id: string
  title: string
  status: ReviewStatus
  language: string
  content: string
  quality_score: number
  saved_name: string | null
  saved_language: string | null
  saved_code: string | null
  saved_at: Date | null
  run: number
  created_at: Date
  analyzed_at: Date
  finding: Finding[]
  suggestion: Suggestion[]
  generated_test: GeneratedTestFile[]
  test_config: unknown
  failure_reason: FailureReason | null
}

// The stored test configuration (plan 034), or null for a review without one. A stored value
// that is not a valid configuration (never written by this code) also reads as null, the default.
function testConfigOf(value: unknown): TestConfig | null {
  if (value === null || value === undefined) return null
  const result = testConfigSchema.safeParse(value)
  return result.success ? result.data : null
}

type CountRow = { critical: number, high: number, medium: number, low: number }

const countedSeverityList: CountedSeverity[] = [Severity.Critical, Severity.High, Severity.Medium, Severity.Low]

// Finding counts are not stored: they are the counts of the review's findings by counted
// severity, once the review is completed (empty before, as the analyzer leaves them).
function findingCountOf(status: ReviewStatus, count: CountRow): FindingCount[] {
  if (status !== Status.Completed) return []
  return countedSeverityList.map((severity) => ({ severity, count: count[severity] }))
}

function countBySeverity(findingList: Finding[]): CountRow {
  const count: CountRow = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findingList) {
    if (finding.severity !== Severity.Info) count[finding.severity] += 1
  }
  return count
}

function savedOf(row: ReviewRow): SavedReview | null {
  if (!row.saved_at || row.saved_language === null || row.saved_code === null) return null
  return {
    ...(row.saved_name === null ? {} : { name: row.saved_name }),
    language: row.saved_language,
    code: row.saved_code,
    savedAt: row.saved_at.toISOString()
  }
}

function recordOf(row: ReviewRow): ReviewRecord {
  const review: Review = {
    title: row.title,
    status: row.status,
    language: row.language,
    analyzedAgo: TIME_AGO_TEXT.justNow,
    qualityScore: row.quality_score,
    content: row.content,
    findingCount: findingCountOf(row.status, countBySeverity(row.finding)),
    finding: row.finding,
    suggestion: row.suggestion,
    generatedTest: row.generated_test
  }
  return {
    id: row.id,
    review,
    createdAt: row.created_at.getTime(),
    analyzedAt: row.analyzed_at.getTime(),
    run: row.run,
    saved: savedOf(row),
    deleted: false,
    testConfig: testConfigOf(row.test_config),
    // Only a failed review has a reason (null for one that failed before migration 005).
    ...(row.status === Status.Failed ? { failureReason: row.failure_reason } : {})
  }
}

const emptyStatusCount: StatusCount = { total: 0, completed: 0, failed: 0, qualitySum: 0 }

// A review with its items as JSON arrays, in their original order, in one statement (one
// consistent snapshot). `jsonb_strip_nulls` drops a generated test's absent `repo`.
const reviewSelect = `
  SELECT r.id, r.title, r.status, r.language, r.content, r.quality_score,
    r.saved_name, r.saved_language, r.saved_code, r.saved_at, r.run, r.created_at, r.analyzed_at, r.test_config, r.failure_reason,
    COALESCE((SELECT json_agg(json_build_object(
        'id', f.id, 'severity', f.severity, 'category', f.category, 'message', f.message,
        'detail', f.detail, 'line_start', f.line_start) ORDER BY f.position)
      FROM finding f WHERE f.review_id = r.id), '[]'::json) AS finding,
    COALESCE((SELECT json_agg(json_build_object('id', s.id, 'title', s.title, 'detail', s.detail) ORDER BY s.position)
      FROM suggestion s WHERE s.review_id = r.id), '[]'::json) AS suggestion,
    COALESCE((SELECT json_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', t.id, 'sourceFile', t.source_file, 'testFile', t.test_file, 'language', t.language,
        'repo', t.repo, 'code', t.code, 'altCode', t.alt_code)) ORDER BY t.position)
      FROM generated_test t WHERE t.review_id = r.id), '[]'::json) AS generated_test
  FROM review r`

type AccountRow = {
  org_id: string
  username: string
  full_name: string
  email: string
  member_since: string
  password_hash: string | null
  avatar_digest: string | null
  github_login: string | null
}

type IdentityRow = {
  provider: string
  provider_user_id: string
  org_id: string
  login: string
}

type SessionRow = {
  id: string
  org_id: string
  created_at: Date
  last_seen_at: Date
  expires_at: Date
  absolute_expires_at: Date
}

const accountSelect = `
  SELECT a.org_id, a.username, a.full_name, a.email, a.member_since, a.password_hash, av.digest AS avatar_digest, gi.login AS github_login
  FROM account a LEFT JOIN account_avatar av ON av.org_id = a.org_id
  LEFT JOIN account_identity gi ON gi.org_id = a.org_id AND gi.provider = '${IdentityProvider.Github}'`

function accountOf(row: AccountRow): AccountRecord {
  return {
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    memberSince: row.member_since,
    passwordHash: row.password_hash,
    avatarDigest: row.avatar_digest,
    githubLogin: row.github_login
  }
}

function identityOf(row: IdentityRow): IdentityRecord {
  return { provider: row.provider as IdentityRecord['provider'], providerUserId: row.provider_user_id, orgId: row.org_id, login: row.login }
}

function sessionOf(row: SessionRow): SessionRecord {
  return {
    idHash: row.id,
    orgId: row.org_id,
    createdAt: row.created_at.getTime(),
    lastSeenAt: row.last_seen_at.getTime(),
    expiresAt: row.expires_at.getTime(),
    absoluteExpiresAt: row.absolute_expires_at.getTime()
  }
}

export class PgStore implements Store {
  private readonly pool: PgPool

  constructor(pool: PgPool) {
    this.pool = pool
  }

  private async query<R extends pg.QueryResultRow>(operation: string, text: string, values: unknown[] = []): Promise<pg.QueryResult<R>> {
    try {
      return await this.pool.query<R>(text, values)
    } catch (error) {
      throw databaseError(operation, error)
    }
  }

  // Runs `work` in one transaction on one connection; any failure rolls it all back.
  private async transaction<T>(operation: string, work: (query: Query) => Promise<T>): Promise<T> {
    let client: pg.PoolClient
    try {
      client = await this.pool.connect()
    } catch (error) {
      throw databaseError(operation, error)
    }
    try {
      await client.query('BEGIN')
      const result = await work((text, values) => client.query(text, values))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw databaseError(operation, error)
    } finally {
      client.release()
    }
  }

  // Inserts the review's findings, suggestions and generated tests in their order, one
  // statement per table (unnest over parameter arrays).
  private async insertItem(query: Query, orgId: string, id: string, item: Pick<Review, 'finding' | 'suggestion' | 'generatedTest'>): Promise<void> {
    if (item.finding.length > 0) {
      await query(
        `INSERT INTO finding (review_id, org_id, position, id, severity, category, message, detail, line_start)
         SELECT $1, $2, t.ord - 1, t.id, t.severity, t.category, t.message, t.detail, t.line_start
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[])
           WITH ORDINALITY AS t(id, severity, category, message, detail, line_start, ord)`,
        [id, orgId, item.finding.map((f) => f.id), item.finding.map((f) => f.severity), item.finding.map((f) => f.category),
          item.finding.map((f) => f.message), item.finding.map((f) => f.detail), item.finding.map((f) => f.line_start)]
      )
    }
    if (item.suggestion.length > 0) {
      await query(
        `INSERT INTO suggestion (review_id, org_id, position, id, title, detail)
         SELECT $1, $2, t.ord - 1, t.id, t.title, t.detail
         FROM unnest($3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS t(id, title, detail, ord)`,
        [id, orgId, item.suggestion.map((s) => s.id), item.suggestion.map((s) => s.title), item.suggestion.map((s) => s.detail)]
      )
    }
    await this.insertGeneratedTest(query, orgId, id, item.generatedTest)
  }

  private async insertGeneratedTest(query: Query, orgId: string, id: string, fileList: GeneratedTestFile[]): Promise<void> {
    if (fileList.length === 0) return
    await query(
      `INSERT INTO generated_test (review_id, org_id, position, id, source_file, test_file, language, repo, code, alt_code)
       SELECT $1, $2, t.ord - 1, t.id, t.source_file, t.test_file, t.language, t.repo, t.code, t.alt_code
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
         WITH ORDINALITY AS t(id, source_file, test_file, language, repo, code, alt_code, ord)`,
      [id, orgId, fileList.map((t) => t.id), fileList.map((t) => t.sourceFile), fileList.map((t) => t.testFile),
        fileList.map((t) => t.language), fileList.map((t) => t.repo ?? null), fileList.map((t) => t.code), fileList.map((t) => t.altCode)]
    )
  }

  private async deleteItem(query: Query, id: string): Promise<void> {
    await query('DELETE FROM finding WHERE review_id = $1', [id])
    await query('DELETE FROM suggestion WHERE review_id = $1', [id])
    await query('DELETE FROM generated_test WHERE review_id = $1', [id])
  }

  async listReviewSummary(orgId: string): Promise<ReviewSummaryRecord[]> {
    const { rows } = await this.query<{ id: string, title: string, language: string, status: ReviewStatus, created_at: Date } & CountRow>(
      'review.list',
      `SELECT r.id, COALESCE(r.saved_name, r.title) AS title, r.language, r.status, r.created_at,
         count(f.review_id) FILTER (WHERE f.severity = 'critical')::int AS critical,
         count(f.review_id) FILTER (WHERE f.severity = 'high')::int AS high,
         count(f.review_id) FILTER (WHERE f.severity = 'medium')::int AS medium,
         count(f.review_id) FILTER (WHERE f.severity = 'low')::int AS low
       FROM review r LEFT JOIN finding f ON f.review_id = r.id
       WHERE r.org_id = $1 AND r.deleted_at IS NULL
       GROUP BY r.id
       ORDER BY r.created_at DESC, r.insert_order DESC`,
      [orgId]
    )
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      language: row.language,
      status: row.status,
      createdAt: row.created_at.getTime(),
      findingCount: findingCountOf(row.status, row)
    }))
  }

  async findReview(orgId: string, id: string): Promise<ReviewRecord | undefined> {
    const { rows } = await this.query<ReviewRow>(
      'review.find',
      `${reviewSelect} WHERE r.id = $1 AND r.org_id = $2 AND r.deleted_at IS NULL`,
      [id, orgId]
    )
    return rows[0] ? recordOf(rows[0]) : undefined
  }

  async createReview(orgId: string, record: ReviewRecord): Promise<void> {
    const { review, saved } = record
    await this.transaction('review.create', async (query) => {
      await query(
        `INSERT INTO review (id, org_id, title, status, language, content, quality_score,
           saved_name, saved_language, saved_code, saved_at, run, created_at, analyzed_at, deleted_at, test_config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
        [record.id, orgId, review.title, review.status, review.language, review.content, review.qualityScore,
          saved?.name ?? null, saved?.language ?? null, saved?.code ?? null, saved ? new Date(saved.savedAt) : null,
          record.run, new Date(record.createdAt), new Date(record.analyzedAt), record.deleted ? new Date(record.createdAt) : null,
          record.testConfig ? JSON.stringify(record.testConfig) : null]
      )
      await this.insertItem(query, orgId, record.id, review)
    })
  }

  async saveReview(orgId: string, id: string, saved: SavedReview): Promise<boolean> {
    const { rowCount } = await this.query(
      'review.save',
      `UPDATE review SET saved_name = $3, saved_language = $4, saved_code = $5, saved_at = $6
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId, saved.name ?? null, saved.language, saved.code, new Date(saved.savedAt)]
    )
    return rowCount === 1
  }

  // One conditional update: the run starts only if the review exists and is not unfinished, so
  // two runs at once cannot both start.
  async restartReview(orgId: string, id: string, restart: ReviewRestart, unfinishedStatusList: readonly string[]): Promise<RestartResult> {
    return this.transaction('review.run', async (query): Promise<RestartResult> => {
      const { rows } = await query<{ run: number }>(
        `UPDATE review SET saved_name = $3, saved_language = $4, saved_code = $5, saved_at = $6,
           run = run + 1, status = $7, language = $8, content = $9, quality_score = $10, analyzed_at = $11,
           failure_reason = NULL
         WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL AND status <> ALL($12::text[])
         RETURNING run`,
        [id, orgId, restart.saved.name ?? null, restart.saved.language, restart.saved.code, new Date(restart.saved.savedAt),
          Status.Pending, restart.language, restart.content, REVIEW_DEFAULT.initialQualityScore, new Date(restart.analyzedAt),
          [...unfinishedStatusList]]
      )
      const started = rows[0]
      if (started) {
        await this.deleteItem(query, id)
        return { ok: true, run: started.run }
      }
      const current = await query<{ status: ReviewStatus }>(
        'SELECT status FROM review WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
        [id, orgId]
      )
      const status = current.rows[0]?.status
      return status === undefined ? { ok: false, reason: 'not_found' } : { ok: false, reason: 'unfinished', status }
    })
  }

  // The run-guarded conditional update (`... WHERE id = $1 AND run = $2`): a result from an
  // older run, or for a deleted review, changes nothing.
  async completeReview(orgId: string, id: string, run: number, result: AnalyzerResult): Promise<boolean> {
    return this.transaction('review.complete', async (query) => {
      const { rowCount } = await query(
        `UPDATE review SET status = $4, quality_score = $5
         WHERE id = $1 AND run = $2 AND org_id = $3 AND deleted_at IS NULL`,
        [id, run, orgId, Status.Completed, result.qualityScore]
      )
      if (rowCount !== 1) return false
      await this.deleteItem(query, id)
      await this.insertItem(query, orgId, id, result)
      return true
    })
  }

  async failReview(orgId: string, id: string, run: number, reason: FailureReason): Promise<boolean> {
    const { rowCount } = await this.query(
      'review.fail',
      'UPDATE review SET status = $4, failure_reason = $5 WHERE id = $1 AND run = $2 AND org_id = $3 AND deleted_at IS NULL',
      [id, run, orgId, Status.Failed, reason]
    )
    return rowCount === 1
  }

  // The same guard as `completeReview`, and only while the review is still unfinished.
  async markReviewStatus(orgId: string, id: string, run: number, status: 'queued' | 'in_progress', unfinishedStatusList: readonly string[]): Promise<boolean> {
    const { rowCount } = await this.query(
      'review.status',
      `UPDATE review SET status = $4
       WHERE id = $1 AND run = $2 AND org_id = $3 AND deleted_at IS NULL AND status = ANY($5::text[])`,
      [id, run, orgId, status, [...unfinishedStatusList]]
    )
    return rowCount === 1
  }

  // The generated tests and the test configuration (plan 034) change together, in one transaction.
  async replaceGeneratedTest(orgId: string, id: string, fileList: GeneratedTestFile[], testConfig?: TestConfig): Promise<boolean> {
    return this.transaction('review.generatedTest', async (query) => {
      const { rowCount } = await query(
        'SELECT id FROM review WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [id, orgId]
      )
      if (rowCount !== 1) return false
      if (testConfig) await query('UPDATE review SET test_config = $2::jsonb WHERE id = $1', [id, JSON.stringify(testConfig)])
      await query('DELETE FROM generated_test WHERE review_id = $1', [id])
      await this.insertGeneratedTest(query, orgId, id, fileList)
      return true
    })
  }

  async deleteReview(orgId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.query(
      'review.delete',
      'UPDATE review SET deleted_at = now() WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
      [id, orgId]
    )
    return rowCount === 1
  }

  async listUnfinishedReview(unfinishedStatusList: readonly string[]): Promise<UnfinishedReview[]> {
    const { rows } = await this.query<{ org_id: string, id: string, run: number }>(
      'review.listUnfinished',
      `SELECT org_id, id, run FROM review
       WHERE deleted_at IS NULL AND status = ANY($1::text[])
       ORDER BY created_at, insert_order`,
      [[...unfinishedStatusList]]
    )
    return rows.map((row) => ({ orgId: row.org_id, id: row.id, run: row.run }))
  }

  // SQL aggregates (plan 022). Days are UTC calendar days of `created_at`; deleted reviews and
  // their findings never count.
  async getDashboardCount(orgId: string, window: DashboardWindow): Promise<DashboardCount> {
    const live = `SELECT id, status, quality_score, floor(extract(epoch FROM created_at) / 86400)::int AS day
      FROM review WHERE org_id = $1 AND deleted_at IS NULL`
    const statusColumn = (name: string, condition: string) => `
      count(*) FILTER (WHERE ${condition})::int AS ${name}_total,
      count(*) FILTER (WHERE ${condition} AND status = 'completed')::int AS ${name}_completed,
      count(*) FILTER (WHERE ${condition} AND status = 'failed')::int AS ${name}_failed,
      COALESCE(sum(quality_score) FILTER (WHERE ${condition} AND status = 'completed'), 0)::float8 AS ${name}_quality`
    const [status, severity, category, activity] = await Promise.all([
      this.query<Record<string, number>>(
        'dashboard.status',
        `SELECT ${statusColumn('all', 'true')},
           ${statusColumn('current', 'day >= $2 AND day < $2 + $4')},
           ${statusColumn('previous', 'day >= $3 AND day < $3 + $4')}
         FROM (${live}) r`,
        [orgId, window.currentFirstDay, window.previousFirstDay, window.trendDay]
      ),
      this.query<{ severity: CountedSeverity, count: number }>(
        'dashboard.severity',
        `SELECT f.severity, count(*)::int AS count
         FROM finding f JOIN (${live}) r ON r.id = f.review_id
         WHERE r.status = 'completed' AND f.severity <> 'info'
         GROUP BY f.severity`,
        [orgId]
      ),
      this.query<{ category: FindingCategory, count: number }>(
        'dashboard.category',
        `SELECT f.category, count(*)::int AS count
         FROM finding f JOIN (${live}) r ON r.id = f.review_id
         GROUP BY f.category`,
        [orgId]
      ),
      this.query<{ day: number, count: number }>(
        'dashboard.activity',
        `SELECT day, count(*)::int AS count FROM (${live}) r
         WHERE day >= $2 AND day <= $3 GROUP BY day ORDER BY day`,
        [orgId, window.activityFirstDay, window.today]
      )
    ])

    const row = status.rows[0]
    const statusOf = (name: string): StatusCount => row ? {
      total: row[`${name}_total`] ?? 0,
      completed: row[`${name}_completed`] ?? 0,
      failed: row[`${name}_failed`] ?? 0,
      qualitySum: row[`${name}_quality`] ?? 0
    } : { ...emptyStatusCount }

    const severityCount = Object.fromEntries(countedSeverityList.map((item) => [item, 0])) as Record<CountedSeverity, number>
    for (const item of severity.rows) severityCount[item.severity] = item.count

    return {
      all: statusOf('all'),
      current: statusOf('current'),
      previous: statusOf('previous'),
      severityCount,
      categoryCount: Object.fromEntries(category.rows.map((item) => [item.category, item.count])),
      activityCount: activity.rows
    }
  }

  async getSettings(orgId: string): Promise<Settings> {
    const { rows } = await this.query<{ data: Settings }>('setting.get', 'SELECT data FROM setting WHERE org_id = $1', [orgId])
    return rows[0]?.data ?? seedSettings()
  }

  async saveSettings(orgId: string, settings: Settings): Promise<void> {
    await this.query(
      'setting.save',
      `INSERT INTO setting (org_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [orgId, JSON.stringify(settings)]
    )
  }

  // Registration (plan 028): the org, the account, the default settings and the GitHub row in
  // one transaction. A unique violation (user name, email or org id) rolls it all back and
  // becomes the generic conflict.
  async createAccount(input: NewAccountRecord): Promise<CreateAccountResult> {
    const { orgId, account } = input
    try {
      await this.transaction('account.create', async (query) => {
        await query('INSERT INTO org (id, name) VALUES ($1, $2)', [orgId, input.orgName])
        await query(
          `INSERT INTO account (org_id, username, full_name, email, avatar_url, member_since, password_hash)
           VALUES ($1, $2, $3, lower($4), NULL, $5, $6)`,
          [orgId, account.username, account.fullName, account.email, account.memberSince, account.passwordHash]
        )
        await query('INSERT INTO setting (org_id, data) VALUES ($1, $2::jsonb)', [orgId, JSON.stringify(input.settings)])
        await query('INSERT INTO github_connection (org_id, connected) VALUES ($1, false)', [orgId])
        if (input.identity) {
          await query(
            'INSERT INTO account_identity (provider, provider_user_id, org_id, login) VALUES ($1, $2, $3, $4)',
            [input.identity.provider, input.identity.providerUserId, orgId, input.identity.login]
          )
        }
      })
    } catch (error) {
      if (error instanceof DatabaseError && error.code === DATABASE.uniqueViolationCode) return { ok: false, reason: 'conflict' }
      throw error
    }
    return { ok: true }
  }

  async getAccount(orgId: string): Promise<AccountRecord | undefined> {
    const { rows } = await this.query<AccountRow>('account.get', `${accountSelect} WHERE a.org_id = $1`, [orgId])
    return rows[0] ? accountOf(rows[0]) : undefined
  }

  async findAccountByUsername(username: string): Promise<{ orgId: string, account: AccountRecord } | undefined> {
    const { rows } = await this.query<AccountRow>('account.findByUsername', `${accountSelect} WHERE lower(a.username) = lower($1)`, [username])
    const row = rows[0]
    return row ? { orgId: row.org_id, account: accountOf(row) } : undefined
  }

  async findAccountByEmail(email: string): Promise<{ orgId: string } | undefined> {
    const { rows } = await this.query<{ org_id: string }>('account.findByEmail', 'SELECT org_id FROM account WHERE lower(email) = lower($1)', [email])
    return rows[0] ? { orgId: rows[0].org_id } : undefined
  }

  async findIdentity(provider: IdentityRecord['provider'], providerUserId: string): Promise<IdentityRecord | undefined> {
    const { rows } = await this.query<IdentityRow>(
      'identity.find', 'SELECT provider, provider_user_id, org_id, login FROM account_identity WHERE provider = $1 AND provider_user_id = $2', [provider, providerUserId]
    )
    return rows[0] ? identityOf(rows[0]) : undefined
  }

  async findIdentityByOrg(orgId: string, provider: IdentityRecord['provider']): Promise<IdentityRecord | undefined> {
    const { rows } = await this.query<IdentityRow>(
      'identity.findByOrg', 'SELECT provider, provider_user_id, org_id, login FROM account_identity WHERE org_id = $1 AND provider = $2', [orgId, provider]
    )
    return rows[0] ? identityOf(rows[0]) : undefined
  }

  // A unique violation (the provider user, or a second identity of the org) is the conflict.
  async createIdentity(identity: IdentityRecord): Promise<CreateIdentityResult> {
    const { rowCount } = await this.query(
      'identity.create',
      `INSERT INTO account_identity (provider, provider_user_id, org_id, login) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [identity.provider, identity.providerUserId, identity.orgId, identity.login]
    )
    return rowCount === 1 ? { ok: true } : { ok: false, reason: 'conflict' }
  }

  async setIdentityLogin(provider: IdentityRecord['provider'], providerUserId: string, login: string): Promise<void> {
    await this.query('identity.login', 'UPDATE account_identity SET login = $3 WHERE provider = $1 AND provider_user_id = $2', [provider, providerUserId, login])
  }

  async deleteIdentity(orgId: string, provider: IdentityRecord['provider']): Promise<boolean> {
    const { rowCount } = await this.query('identity.delete', 'DELETE FROM account_identity WHERE org_id = $1 AND provider = $2', [orgId, provider])
    return rowCount === 1
  }

  async setPasswordHash(orgId: string, passwordHash: string): Promise<void> {
    await this.query(
      'account.password',
      'UPDATE account SET password_hash = $2, updated_at = now() WHERE org_id = $1',
      [orgId, passwordHash]
    )
  }

  // One update (plan 034): COALESCE keeps a value that is not changed. The unique indexes on
  // lower(username) and lower(email) refuse a value another account uses (SQLSTATE 23505, the
  // generic conflict); the account's own row never conflicts with itself.
  async updateAccount(orgId: string, change: AccountChange): Promise<UpdateAccountResult> {
    try {
      const { rowCount } = await this.query(
        'account.update',
        `UPDATE account SET username = COALESCE($2, username), email = COALESCE(lower($3), email), updated_at = now()
         WHERE org_id = $1`,
        [orgId, change.username ?? null, change.email ?? null]
      )
      return rowCount === 1 ? { ok: true } : { ok: false, reason: 'not_found' }
    } catch (error) {
      if (error instanceof DatabaseError && error.code === DATABASE.uniqueViolationCode) return { ok: false, reason: 'conflict' }
      throw error
    }
  }

  async getAvatar(orgId: string): Promise<AvatarRecord | undefined> {
    const { rows } = await this.query<{ content_type: string, data: Buffer, digest: string, updated_at: Date }>(
      'avatar.get', 'SELECT content_type, data, digest, updated_at FROM account_avatar WHERE org_id = $1', [orgId]
    )
    const row = rows[0]
    return row ? { contentType: row.content_type, data: row.data, digest: row.digest, updatedAt: row.updated_at.getTime() } : undefined
  }

  async setAvatar(orgId: string, avatar: AvatarRecord): Promise<void> {
    await this.query(
      'avatar.set',
      `INSERT INTO account_avatar (org_id, content_type, data, digest, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data,
         digest = EXCLUDED.digest, updated_at = EXCLUDED.updated_at`,
      [orgId, avatar.contentType, avatar.data, avatar.digest, new Date(avatar.updatedAt)]
    )
  }

  async deleteAvatar(orgId: string): Promise<void> {
    await this.query('avatar.delete', 'DELETE FROM account_avatar WHERE org_id = $1', [orgId])
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.query(
      'session.create',
      `INSERT INTO session (id, org_id, created_at, last_seen_at, expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.idHash, session.orgId, new Date(session.createdAt), new Date(session.lastSeenAt),
        new Date(session.expiresAt), new Date(session.absoluteExpiresAt)]
    )
  }

  async findSession(idHash: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.query<SessionRow>(
      'session.find',
      'SELECT id, org_id, created_at, last_seen_at, expires_at, absolute_expires_at FROM session WHERE id = $1',
      [idHash]
    )
    return rows[0] ? sessionOf(rows[0]) : undefined
  }

  async touchSession(idHash: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    await this.query(
      'session.touch',
      'UPDATE session SET last_seen_at = $2, expires_at = $3 WHERE id = $1',
      [idHash, new Date(lastSeenAt), new Date(expiresAt)]
    )
  }

  async deleteSession(idHash: string): Promise<void> {
    await this.query('session.delete', 'DELETE FROM session WHERE id = $1', [idHash])
  }

  async deleteOrgSession(orgId: string): Promise<void> {
    await this.query('session.deleteOrg', 'DELETE FROM session WHERE org_id = $1', [orgId])
  }

  async deleteExpiredSession(now: number): Promise<void> {
    const time = new Date(now)
    await this.query('session.sweep', 'DELETE FROM session WHERE expires_at <= $1 OR absolute_expires_at <= $1', [time])
  }

  // Plan 030: a row is connected only with a login; a row connected before migration 003 (the
  // mock flag, no login) reads as not connected.
  async getGithubConnection(orgId: string): Promise<GithubConnectionRecord | undefined> {
    const { rows } = await this.query<{ login: string, display_name: string | null }>(
      'github.get',
      'SELECT login, display_name FROM github_connection WHERE org_id = $1 AND connected AND login IS NOT NULL',
      [orgId]
    )
    const row = rows[0]
    return row ? { login: row.login, name: row.display_name } : undefined
  }

  async setGithubConnection(orgId: string, connection: GithubConnectionRecord | null): Promise<void> {
    await this.query(
      'github.set',
      `INSERT INTO github_connection (org_id, connected, login, display_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id) DO UPDATE SET connected = EXCLUDED.connected, login = EXCLUDED.login,
         display_name = EXCLUDED.display_name, updated_at = now()`,
      [orgId, connection !== null, connection?.login ?? null, connection?.name ?? null]
    )
  }

  // The ticket number comes from `support_ticket_seq` in the same statement (1001 to 9999, then
  // it wraps), so two requests at once never share a ticket.
  async createSupportRequest(orgId: string, input: Omit<SupportRequestRecord, 'ticket'>): Promise<string> {
    const { rows } = await this.query<{ ticket: string }>(
      'support.create',
      `INSERT INTO support_request (org_id, ticket, issue_type, email, review_id, priority, description, created_at)
       VALUES ($1, $2 || lpad(nextval('support_ticket_seq')::text, $3, $4), $5, $6, $7, $8, $9, $10)
       RETURNING ticket`,
      [orgId, TICKET.prefix, TICKET.digits, TICKET.padChar, input.issueType, input.email, input.reviewId,
        input.priority, input.description, new Date(input.createdAt)]
    )
    const ticket = rows[0]?.ticket
    if (!ticket) throw databaseError('support.create', undefined)
    return ticket
  }

  // The demo org's rows (org, settings, the demo account `john.doe`, GitHub state) when they are
  // missing (plan 028, Open Question 8). Never overwrites: an existing `default` account and
  // its data are kept (migration 002 and schema.sql give it the user name).
  async seedDefault(query: Query = (text, values) => this.query('seed', text, values)): Promise<void> {
    const orgId = DATABASE.defaultOrgId
    const account = seedAccount()
    await query('INSERT INTO org (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [orgId, DATABASE.defaultOrgName])
    await query('INSERT INTO setting (org_id, data) VALUES ($1, $2::jsonb) ON CONFLICT (org_id) DO NOTHING', [orgId, JSON.stringify(seedSettings())])
    await query(
      `INSERT INTO account (org_id, username, full_name, email, avatar_url, member_since, password_hash)
       VALUES ($1, $2, $3, $4, NULL, $5, $6) ON CONFLICT DO NOTHING`,
      [orgId, account.username, account.fullName, account.email, account.memberSince, account.passwordHash]
    )
    await query('INSERT INTO github_connection (org_id, connected) VALUES ($1, false) ON CONFLICT (org_id) DO NOTHING', [orgId])
  }

  // Test-only (POST /api/test/reset): empties every table (every org, account, session and
  // photo) and seeds the demo org again. Refuses, before touching anything, unless the database
  // name ends in `_test`, so an e2e run pointed at the real database can never wipe it.
  async reset(): Promise<void> {
    const { rows } = await this.query<{ name: string }>('reset.guard', 'SELECT current_database() AS name')
    if (!isTestDatabaseName(rows[0]?.name ?? '')) throw conflictError(ERROR_MESSAGE.resetRefused(DATABASE.testNameSuffix))
    await this.transaction('reset', async (query) => {
      await query(`TRUNCATE session, account_identity, account_avatar, generated_test, suggestion, finding, review, support_request, setting,
        github_connection, account, org RESTART IDENTITY`)
      await query('ALTER SEQUENCE support_ticket_seq RESTART')
      await this.seedDefault(query)
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

// Connects, checks the schema and seeds the default rows. Every failure becomes a
// `DatabaseStartupError` that names the variable and the error code, never the URL.
export async function connectPgStore(connectionString: string, variable: string = CONFIG_KEY.databaseUrl): Promise<PgStore> {
  let pool: pg.Pool
  try {
    pool = new pg.Pool({ connectionString })
  } catch (error) {
    throw connectError(variable, error)
  }
  pool.on('error', (error) => {
    console.error(JSON.stringify({ level: LogLevel.Error, operation: LOG_OPERATION.database, message: LOG_MESSAGE.databaseIdleError(errorCodeOf(error)) }))
  })
  try {
    const client = await pool.connect()
    try {
      await checkSchema(client)
    } finally {
      client.release()
    }
  } catch (error) {
    await pool.end().catch(() => undefined)
    if (error instanceof DatabaseStartupError) throw error
    throw connectError(variable, error)
  }
  const store = new PgStore(pool)
  try {
    await store.seedDefault()
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw connectError(variable, error)
  }
  return store
}
