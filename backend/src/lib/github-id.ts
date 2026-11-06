import { isSafeRepoPath } from './github-url.js'
import { GITHUB_PATTERN } from '../utils/constants.js'

// Pure checks of the wizard's path values (plan 030, scope 1 to 3). No network: every value is
// checked here before it is ever used to BUILD an api.github.com URL (`github-fetch.ts`).

// `ignoreBOM` keeps a leading U+FEFF, so decoding is the exact inverse of `encodeFileId`.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

// GitHub's user-name rule: 1 to 39 letters or digits, single hyphens only between them (no
// leading, trailing or double hyphen). ASCII only, so no unicode look-alike gets through.
export function isGithubUsername(value: string): boolean {
  return GITHUB_PATTERN.owner.test(value)
}

// GitHub's repository-name rule: 1 to 100 letters, digits, '.', '_' or '-', and not '.' or '..'.
export function isGithubRepoName(value: string): boolean {
  return GITHUB_PATTERN.repo.test(value) && !GITHUB_PATTERN.dotSegment.test(value)
}

// The file id of a repository path: base64url without padding of its UTF-8 bytes.
export function encodeFileId(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url')
}

// The path a file id names, decoded once, or undefined when the id is not the canonical
// base64url of valid UTF-8, or the path breaks the link path rules of plan 023 (a `.` or `..`
// segment, an empty segment, a backslash, a control character such as NUL, over 1 000
// characters). A percent-escape in the decoded path is kept as text, never decoded again.
export function decodeFileId(id: string): string | undefined {
  if (!GITHUB_PATTERN.fileId.test(id)) return undefined
  const bytes = Buffer.from(id, 'base64url')
  // Node's decoder skips stray bits; only the id it would itself produce is accepted.
  if (bytes.toString('base64url') !== id) return undefined
  let path: string
  try {
    path = utf8.decode(bytes)
  } catch {
    return undefined
  }
  return isSafeRepoPath(path) ? path : undefined
}
