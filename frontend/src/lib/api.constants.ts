// Every backend route the domain services call (.orchestrate/api-contract.yaml).
const segment = (value: string) => encodeURIComponent(value)

export const API_PATH = {
  // Contract 0.14.0: `analyzer` says whether reviews use the Claude API or the stub.
  health: '/api/health',
  review: '/api/review',
  reviewById: (id: string) => `/api/review/${segment(id)}`,
  reviewRun: (id: string) => `/api/review/${segment(id)}/run`,
  generatedTest: (id: string) => `/api/review/${segment(id)}/generated-test`,
  dashboard: '/api/dashboard',
  githubConnect: '/api/github/connect',
  githubDisconnect: '/api/github/disconnect',
  githubRepo: '/api/github/repo',
  githubFileList: (repoId: string) => `/api/github/repo/${segment(repoId)}/file`,
  githubFile: (repoId: string, fileId: string) => `/api/github/repo/${segment(repoId)}/file/${segment(fileId)}`,
  githubImport: '/api/github/import',
  settings: '/api/settings',
  supportRequest: '/api/support-request',
  account: '/api/account',
  accountPassword: '/api/account/password',
  // Plan 028 (contract 0.8.0): the profile photo and the session (sign in, restore, sign out).
  // POST /api/account/sign-out no longer exists (DELETE /api/session replaces it).
  accountAvatar: '/api/account/avatar',
  session: '/api/session',
  // Plan 040 (contract 0.15.0): GitHub sign-in. The first is a browser navigation (never fetch);
  // the second is POST (start a link) and DELETE (unlink), signed in.
  githubSignIn: '/api/auth/github',
  githubSignInLink: '/api/auth/github/link'
} as const

// The HTTP statuses and error codes the backend answers with.
export const HTTP_STATUS = {
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
  payloadTooLarge: 413,
  unprocessable: 422,
  rateLimited: 429
} as const

export const API_ERROR_CODE = {
  notFound: 'not_found',
  conflict: 'conflict',
  payloadTooLarge: 'payload_too_large',
  validation: 'validation_error'
} as const

// `source_type` of a review created from editor content (NewReview in the contract).
export const SNIPPET_SOURCE_TYPE = 'snippet'

// The custom header every state-changing request carries (plan 028, CSRF). It makes the browser
// send a CORS preflight, which only the configured frontend origin passes.
export const CSRF_HEADER = { name: 'X-CSRF-Protection', value: '1' } as const
