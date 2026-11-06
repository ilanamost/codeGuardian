import { defineConfig } from 'vitest/config'

// `npm run test:db` (plan 022): the PostgreSQL integration suite against TEST_DATABASE_URL. The
// files share one database, so they run one at a time. The global setup fails the whole run
// with a clear message when TEST_DATABASE_URL is missing or does not name a `_test` database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    setupFiles: ['tests/setup/no-ai-network.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
