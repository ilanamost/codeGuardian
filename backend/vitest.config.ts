import { defineConfig } from 'vitest/config'

// The unit suite: always on the in-memory store, no database. The PostgreSQL integration suite
// in tests/db runs only through `npm run test:db` (vitest.db.config.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/db/**', 'node_modules/**'],
    setupFiles: ['tests/setup/no-ai-network.ts']
  }
})
