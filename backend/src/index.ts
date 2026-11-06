import { env, exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadEnvironment } from './lib/env-file.js'
import { createApp } from './app.js'
import { createAnalyzer } from './analyzer/create-analyzer.js'
import { loadConfigOrExit } from './config.js'
import { DatabaseStartupError } from './lib/db-error.js'
import { createGithubClient } from './lib/github-fetch.js'
import { createFakeGithubFetch } from './lib/github-fake.js'
import { createFakeGithubSignInClient, FAKE_SIGNIN_PROFILE } from './lib/github-signin-fake.js'
import { createReviewService } from './service/review.service.js'
import { createStore } from './store/create-store.js'
import type { Store } from './store/store.js'
import { LOG_MESSAGE, LOG_OPERATION, LogLevel } from './utils/constants.js'
import { AnalyzerKind } from './utils/domain.js'
import { ERROR_MESSAGE } from './utils/error-messages.js'

function logLine(level: LogLevel, operation: string, message: string, extra: object = {}): string {
  return JSON.stringify({ level, operation, message, ...extra })
}

// An invalid configuration stops the server with one structured line (setting names only).
// The base env file, then the one for NODE_ENV on top, then the process variables (plan 042).
const backendDirectory = fileURLToPath(new URL('..', import.meta.url))
const config = loadConfigOrExit(() => loadEnvironment({ directory: backendDirectory, environment: env }), { error: (line) => console.error(line), exit })

// PostgreSQL when DATABASE_URL is set (plan 022), the in-memory store otherwise. A failure stops
// the server with a message that names the variable but never its value.
let store: Store
try {
  store = await createStore(config.databaseUrl)
} catch (error) {
  const message = error instanceof DatabaseStartupError ? error.message : ERROR_MESSAGE.internal
  console.error(logLine(LogLevel.Error, LOG_OPERATION.startup, message))
  exit(1)
}

// The Claude analyzer with a key, the stub without one (plan 039, Open Question 2). The key is
// never logged: the lines below name the setting and the model only.
const analyzer = createAnalyzer(config)
if (analyzer.kind === AnalyzerKind.Claude) {
  console.log(logLine(LogLevel.Info, LOG_OPERATION.startup, LOG_MESSAGE.analyzerClaude(config.anthropicModel)))
} else {
  console.warn(logLine(LogLevel.Warn, LOG_OPERATION.startup, LOG_MESSAGE.analyzerStub))
}
// One review service for the routes and the resume below, so they share the quota and the cap.
const reviewService = createReviewService(store, analyzer, Date.now)
// The fake GitHub only when the test-only GITHUB_FAKE flag is on; the real client otherwise.
const githubClient = config.githubFake ? createGithubClient({ fetch: createFakeGithubFetch() }) : undefined
// The fake GitHub sign-in client only when GITHUB_OAUTH_FAKE is on (and the three settings are set).
const githubSignInClient = config.githubOAuthFake ? createFakeGithubSignInClient(FAKE_SIGNIN_PROFILE) : undefined
const server = createApp(config, { store, analyzer, reviewService, githubClient, githubSignInClient }).listen(config.port, () => {
  console.log(logLine(LogLevel.Info, LOG_OPERATION.startup, LOG_MESSAGE.listening(config.port), { frontendUrl: config.frontendUrl }))
})

// Reviews left pending by the last run are analyzed again (plan 022, Open Question 2).
// A failure here is logged with a fixed message (no URL, no error code) and the server keeps
// serving; those reviews are tried again on the next start (QA AI-43).
try {
  const resumed = await reviewService.resumeUnfinished()
  if (resumed > 0) console.log(logLine(LogLevel.Info, LOG_OPERATION.startup, LOG_MESSAGE.resumeUnfinished(resumed)))
} catch {
  console.error(logLine(LogLevel.Error, LOG_OPERATION.startup, LOG_MESSAGE.resumeFailed))
}

// Stop accepting requests, then release the database connections.
function shutdown(): void {
  server.close(() => {
    store.close().finally(() => exit(0))
  })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
