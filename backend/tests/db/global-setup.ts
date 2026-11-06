import pg from 'pg'
import { connectError } from '../../src/lib/db-error.js'
import { applySchema, isTestDatabaseName } from '../../src/store/pg-schema.js'
import { CONFIG_KEY, DATABASE } from '../../src/utils/constants.js'
import { testDatabaseUrl } from './helper.js'

// Runs once before `npm run test:db`: TEST_DATABASE_URL must be set and must name a database
// ending in `_test` (the suite empties its tables); then the idempotent schema is applied.
export default async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() })
  try {
    await client.connect()
  } catch (error) {
    throw new Error(connectError(CONFIG_KEY.testDatabaseUrl, error).message)
  }
  try {
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name')
    if (!isTestDatabaseName(rows[0]?.name ?? '')) {
      throw new Error(`${CONFIG_KEY.testDatabaseUrl} must name a database ending in ${DATABASE.testNameSuffix}; the integration suite empties its tables.`)
    }
    await applySchema(client)
  } finally {
    await client.end()
  }
}
