import process, { argv, env, exit, loadEnvFile } from 'node:process'
import pg from 'pg'
import { connectError, errorCodeOf } from '../src/lib/db-error.js'
import { applySchema } from '../src/store/pg-schema.js'
import { CONFIG_KEY, DATABASE, LOG_MESSAGE, LOG_OPERATION, LogLevel } from '../src/utils/constants.js'
import { ERROR_MESSAGE } from '../src/utils/error-messages.js'

// `npm run db:setup` applies db/schema.sql to DATABASE_URL; `npm run db:setup:test` (the --test
// flag) applies it to TEST_DATABASE_URL. Idempotent. `npm run dev` and `npm start` run the first
// one before the server: without DATABASE_URL it does nothing, because the server then runs on
// the in-memory store. Without TEST_DATABASE_URL the test setup fails, since it was asked for.
// The values come from the environment, or from the backend's local env file like the server
// (variables already set win). They are never printed.

try {
  loadEnvFile()
} catch {
  // No local env file: the variables come from the environment only.
}

const isTest = argv.includes(DATABASE.testFlag)
const variable = isTest ? CONFIG_KEY.testDatabaseUrl : CONFIG_KEY.databaseUrl
const connectionString = env[variable]?.trim()

function log(level: LogLevel, message: string): void {
  const line = JSON.stringify({ level, operation: LOG_OPERATION.databaseSetup, message })
  if (level === LogLevel.Error) console.error(line)
  else console.log(line)
}

if (!connectionString) {
  if (isTest) {
    log(LogLevel.Error, ERROR_MESSAGE.setupVariableMissing(variable))
    exit(1)
  }
  log(LogLevel.Info, LOG_MESSAGE.setupSkipped(variable))
  exit(0)
}

const client = new pg.Client({ connectionString })
try {
  await client.connect()
} catch (error) {
  log(LogLevel.Error, connectError(variable, error).message)
  exit(1)
}

try {
  await applySchema(client)
  log(LogLevel.Info, LOG_MESSAGE.setupDone(variable))
} catch (error) {
  log(LogLevel.Error, ERROR_MESSAGE.databaseFailed(LOG_OPERATION.databaseSetup, errorCodeOf(error)))
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
