// Shared by playwright.config.ts and the specs (plan 019): where the two servers listen, and the
// backend's test-only reset route (mounted only when the backend runs with ENABLE_TEST_ROUTE=true).
// The e2e servers use their own ports, so they never collide with (or reuse) the dev servers on
// 5173 and 3001, which run without the test route.
export const FRONTEND_PORT = '5174'
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`
export const BACKEND_PORT = '3101'
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`
export const BACKEND_HEALTH_PATH = '/api/health'
export const TEST_RESET_PATH = '/api/test/reset'

// Plan 028: the demo account the test reset seeds (Open Question 8), which the auto fixture
// signs in as. Local demo credentials, not secrets.
export const DEMO_USERNAME = 'john.doe'
export const DEMO_PASSWORD = 'mock-password'

// Plan 030: the backend's test-only fake GitHub (GITHUB_FAKE=true, backend/src/lib/github-fake.ts)
// answers the wizard for this user, so no e2e test reaches api.github.com. Its repository `demo`
// holds src/greet.ts and src/util.py.
export const FAKE_GITHUB_USER = 'example-user'
export const FAKE_GITHUB_USER_NAME = 'Example User'
export const FAKE_GITHUB_REPO = 'demo'
// The base64url file id of src/greet.ts (contract 0.9.0 FileId).
export const FAKE_GITHUB_FILE_ID = 'c3JjL2dyZWV0LnRz'

// The backend's support request limit per account and hour (contract 0.10.0, kept in 0.11.0).
export const SUPPORT_REQUEST_HOURLY_LIMIT = 5
