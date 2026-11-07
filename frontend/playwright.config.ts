import { env } from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import {
  BACKEND_HEALTH_PATH,
  BACKEND_PORT,
  BACKEND_URL,
  FRONTEND_PORT,
  FRONTEND_URL
} from './tests/e2e/e2e.constants'

// Plan 035: there is no mock-mode project; the frontend always runs against the backend.
const projectList = [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(env.CI),
  retries: env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry'
  },
  projects: projectList,
  // Both processes are started here so `npx playwright test` is the whole command (plan 019):
  // the frontend against the backend, the backend with its test-only reset route, which
  // every spec calls first (tests/e2e/fixture.ts). Variables passed here take precedence over
  // the local env files. Both use their own ports (tests/e2e/e2e.constants.ts), so the dev
  // servers can stay up; an e2e server left running is reused outside CI.
  // Plan 022: the backend runs on the PostgreSQL test database (DATABASE_URL taken from
  // TEST_DATABASE_URL; `npm start` applies the schema first). The reset route refuses any
  // database whose name does not end in `_test`. Without TEST_DATABASE_URL the empty value
  // keeps the backend on its in-memory store.
  // Plan 023: GITHUB_FAKE=true makes POST /api/github/import answer from the backend's fixed fake
  // GitHub (backend/src/lib/github-fake.ts), so no e2e test reaches the real GitHub API.
  webServer: [
    {
      command: 'npm start',
      cwd: '../backend',
      url: `${BACKEND_URL}${BACKEND_HEALTH_PATH}`,
      env: {
        ENABLE_TEST_ROUTE: 'true',
        GITHUB_FAKE: 'true',
        // Plan 039: a blank key keeps the stub analyzer, so a key in the backend's local settings
        // never makes e2e reviews call the real Claude API (slower than the 5 s polls).
        ANTHROPIC_API_KEY: '',
        // Plan 047: sign-in may return a sessionToken; the browser uses it only if the cookie fails.
        SESSION_TOKEN_FALLBACK: 'on',
        PORT: BACKEND_PORT,
        FRONTEND_URL,
        DATABASE_URL: env.TEST_DATABASE_URL ?? ''
      },
      reuseExistingServer: !env.CI,
      timeout: 60_000
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      env: { VITE_API_URL: BACKEND_URL },
      reuseExistingServer: !env.CI,
      timeout: 60_000
    }
  ]
})
