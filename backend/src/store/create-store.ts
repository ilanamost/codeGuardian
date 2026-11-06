import { CONFIG_KEY, LOG_MESSAGE, LOG_OPERATION, LogLevel } from '../utils/constants.js'
import { createMemoryStore } from './memory-store.js'
import { connectPgStore } from './pg-store.js'
import type { Store } from './store.js'

export type StoreLogger = Pick<Console, 'info' | 'warn'>

// Picks the store at startup (plan 022): PostgreSQL when `DATABASE_URL` is set, otherwise the
// in-memory store with exactly one warning that nothing survives a restart. A PostgreSQL failure
// rejects with a `DatabaseStartupError` whose message never contains the URL or the password.
export async function createStore(databaseUrl: string | undefined, logger: StoreLogger = console): Promise<Store> {
  if (!databaseUrl) {
    logger.warn(JSON.stringify({ level: LogLevel.Warn, operation: LOG_OPERATION.startup, message: LOG_MESSAGE.storeMemory }))
    return createMemoryStore()
  }
  const store = await connectPgStore(databaseUrl, CONFIG_KEY.databaseUrl)
  logger.info(JSON.stringify({ level: LogLevel.Info, operation: LOG_OPERATION.startup, message: LOG_MESSAGE.storePostgres }))
  return store
}
