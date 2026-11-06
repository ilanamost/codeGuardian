import { readFile } from 'node:fs/promises'
import type pg from 'pg'
import { DatabaseStartupError } from '../lib/db-error.js'
import { DATABASE } from '../utils/constants.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'

// Applying and checking `db/schema.sql` (plan 022).

export const schemaPath = new URL('../../db/schema.sql', import.meta.url)

type Queryable = Pick<pg.ClientBase, 'query'>

// Applies the idempotent bootstrap under an advisory lock, so two setups at once cannot race on
// `CREATE ... IF NOT EXISTS`. The script has no parameters: it is a fixed file from the repo.
export async function applySchema(client: Queryable): Promise<void> {
  const sql = await readFile(schemaPath, 'utf8')
  await client.query('SELECT pg_advisory_lock($1)', [DATABASE.schemaLockKey])
  try {
    await client.query(sql)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [DATABASE.schemaLockKey])
  }
}

// Stops startup with a clear message when a table or the ticket sequence is missing.
export async function checkSchema(client: Queryable): Promise<void> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [DATABASE.tableList]
  )
  const found = new Set(rows.map((row) => row.name))
  const missing: string[] = DATABASE.tableList.filter((name) => !found.has(name))
  const sequence = await client.query<{ name: string | null }>('SELECT to_regclass($1)::text AS name', [DATABASE.ticketSequence])
  if (!sequence.rows[0]?.name) missing.push(DATABASE.ticketSequence)
  if (missing.length > 0) throw new DatabaseStartupError(ERROR_MESSAGE.databaseSchemaMissing(missing.join(', ')))
}

export function isTestDatabaseName(name: string): boolean {
  return name.endsWith(DATABASE.testNameSuffix)
}
