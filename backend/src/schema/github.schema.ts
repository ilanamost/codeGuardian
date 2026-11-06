import { z } from 'zod'
import { decodeFileId, isGithubRepoName, isGithubUsername } from '../lib/github-id.js'
import { storableText } from '../lib/validate.js'
import { GITHUB_ID_ISSUE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

// Query of GET /api/github/repo. A repeated `query` arrives as an array and is rejected.
export const repoSearchSchema = z.object({
  query: storableText().max(LIMIT.repoQueryMax).optional()
})

// Body of POST /api/github/import (plan 023). Unknown fields are refused; the link itself is
// checked by `lib/github-url.ts`, which gives the precise reason.
export const githubImportSchema = z.strictObject({
  url: z.string().min(1).max(LIMIT.github.urlMax)
})

// Body of POST /api/github/connect (plan 030): GitHub's user-name pattern, not trimmed. Unknown
// fields are refused. A refused name never reaches GitHub.
export const githubConnectSchema = z.strictObject({
  username: z.string().max(LIMIT.github.usernameMax, GITHUB_ID_ISSUE.username).refine(isGithubUsername, GITHUB_ID_ISSUE.username)
})

// Path values of the repository routes (plan 030).
export const repoNameSchema = z.string().refine(isGithubRepoName, GITHUB_ID_ISSUE.repoId)

// A file id, turned into the checked path it names.
export const fileIdSchema = z.string().transform((value, context) => {
  const path = decodeFileId(value)
  if (path === undefined) {
    context.addIssue({ code: 'custom', message: GITHUB_ID_ISSUE.fileId })
    return z.NEVER
  }
  return path
})
