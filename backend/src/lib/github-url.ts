import { validationError } from './error.js'
import { GITHUB_LINK, GITHUB_PATTERN } from '../utils/constants.js'
import { GithubLinkKind } from '../utils/domain.js'
import { ERROR_MESSAGE, FIELD, GITHUB_URL_ISSUE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

// Parses a pasted GitHub link (plan 023, scope 1). Pure: no network, and the result is only
// ever used to BUILD an api.github.com URL (`github-fetch.ts`); the link itself is never fetched.
// The raw text is checked, not a WHATWG-normalised URL, so `%2e%2e`, `\` or `@` tricks cannot
// be rewritten into something else before the checks run. Every refusal is a 422 whose message
// names the rule broken and never echoes the link.

export type GithubFileLink = {
  kind: GithubLinkKind.File
  owner: string
  repo: string
  ref: string
  // Decoded path segments, each checked.
  path: string[]
}

export type GithubPullLink = {
  kind: GithubLinkKind.Pull
  owner: string
  repo: string
  number: number
}

export type GithubLink = GithubFileLink | GithubPullLink

function refuse(issue: string): never {
  throw validationError(ERROR_MESSAGE.githubUrlInvalid(issue), { issue: [{ field: FIELD.url, message: issue }] })
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return refuse(GITHUB_URL_ISSUE.badEscape)
  }
}

// One decoded path segment: not `.` or `..`, and no slash, backslash or control character.
// It must also be well-formed Unicode (no unpaired surrogate), which `encodeURIComponent`
// would throw on (QA AI-46 D1, D2).
export function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment.isWellFormed() && !GITHUB_PATTERN.dotSegment.test(segment) && !GITHUB_PATTERN.unsafeSegment.test(segment)
}

// A repository path as GitHub names it in a PR file list (not percent-encoded): the same
// segment rules as a link path, so a hostile file name can never shape the API URL. A name
// that is not well-formed Unicode is refused here, so the PR import skips it (`invalid_path`).
export function isSafeRepoPath(path: string): boolean {
  if (path.length === 0 || path.length > LIMIT.github.pathMax || !path.isWellFormed()) return false
  return path.split('/').every(isSafeSegment)
}

function checkOwnerRepo(owner: string, repo: string): void {
  if (!GITHUB_PATTERN.owner.test(owner)) refuse(GITHUB_URL_ISSUE.owner)
  if (!GITHUB_PATTERN.repo.test(repo) || GITHUB_PATTERN.dotSegment.test(repo)) refuse(GITHUB_URL_ISSUE.repo)
}

export function parseGithubUrl(input: string): GithubLink {
  if (input.length > LIMIT.github.urlMax) refuse(GITHUB_URL_ISSUE.tooLong)
  const text = input.trim()
  // QA AI-46 D1: an unpaired surrogate is a 422 on `url`, never a URIError (400) later on.
  if (!text.isWellFormed()) refuse(GITHUB_URL_ISSUE.notWellFormed)
  if (GITHUB_PATTERN.unsafeRaw.test(text)) refuse(GITHUB_URL_ISSUE.unsafeCharacter)
  // The exact prefix, so another scheme, host, `www.`, user info or a port never matches.
  if (text.slice(0, GITHUB_LINK.prefix.length).toLowerCase() !== GITHUB_LINK.prefix) refuse(GITHUB_URL_ISSUE.notGithub)

  // A query (`?plain=1`) or a fragment (`#L10`) is ignored: the link is never fetched.
  const pathText = text.slice(GITHUB_LINK.prefix.length).split(/[?#]/, 1)[0] ?? ''
  const rawList = pathText.split('/')
  const [rawOwner = '', rawRepo = '', kind = ''] = rawList

  // A pull link may end with one slash (`/pull/5/`); any other empty segment is refused.
  if (kind === GITHUB_LINK.pull && rawList.length > 3 && rawList.at(-1) === '') rawList.pop()
  if (rawList.some((segment) => segment.length === 0)) refuse(GITHUB_URL_ISSUE.emptySegment)
  if (rawList.length < 4) refuse(GITHUB_URL_ISSUE.notFileOrPull)

  const owner = decodeSegment(rawOwner)
  const repo = decodeSegment(rawRepo)
  checkOwnerRepo(owner, repo)

  if (kind === GITHUB_LINK.pull) {
    const tail = rawList.slice(3)
    const valid = tail.length === 1 || (tail.length === 2 && tail[1] === GITHUB_LINK.pullFiles)
    if (!valid) refuse(GITHUB_URL_ISSUE.notFileOrPull)
    const number = tail[0] ?? ''
    if (!GITHUB_PATTERN.pullNumber.test(number)) refuse(GITHUB_URL_ISSUE.pullNumber)
    return { kind: GithubLinkKind.Pull, owner, repo, number: Number(number) }
  }

  if (kind !== GITHUB_LINK.blob) refuse(GITHUB_URL_ISSUE.notFileOrPull)

  const [rawRef = '', ...rawPath] = rawList.slice(3)
  const ref = decodeSegment(rawRef)
  // An encoded slash in the ref is a branch name with a slash (plan 023, Open Question 4).
  if (ref.includes('/')) refuse(GITHUB_URL_ISSUE.refSlash)
  if (!GITHUB_PATTERN.ref.test(ref) || ref.includes('..')) refuse(GITHUB_URL_ISSUE.ref)

  if (rawPath.length === 0) refuse(GITHUB_URL_ISSUE.pathMissing)
  // Decoded once: `%2e%2e` is `..` and `%2f` is a slash, and both are refused here.
  const path = rawPath.map(decodeSegment)
  if (!path.every(isSafeSegment)) refuse(GITHUB_URL_ISSUE.unsafeSegment)
  if (path.join('/').length > LIMIT.github.pathMax) refuse(GITHUB_URL_ISSUE.pathTooLong)

  return { kind: GithubLinkKind.File, owner, repo, ref, path }
}
