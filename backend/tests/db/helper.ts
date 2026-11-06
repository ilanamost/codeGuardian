import { env, loadEnvFile } from 'node:process'
import { CONFIG_KEY } from '../../src/utils/constants.js'
import { ERROR_MESSAGE } from '../../src/utils/error-messages.js'

// TEST_DATABASE_URL from the environment, or from the backend's local env file (variables
// already set win). The suite fails with a clear message instead of skipping when it is missing.
// The value is never printed.
export function testDatabaseUrl(): string {
  try {
    loadEnvFile()
  } catch {
    // No local env file.
  }
  const url = env[CONFIG_KEY.testDatabaseUrl]?.trim()
  if (!url) {
    throw new Error(`${ERROR_MESSAGE.setupVariableMissing(CONFIG_KEY.testDatabaseUrl)} The PostgreSQL integration suite never skips silently.`)
  }
  return url
}
