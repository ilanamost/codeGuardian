import type {
  GithubAccountDto,
  GithubFileContentDto,
  GithubFileDto,
  GithubFileListDto,
  GithubImportDto,
  GithubImportFileContentDto,
  GithubImportFileDto,
  GithubRepoDto,
  GithubRepoListDto,
  GithubSkippedFileDto,
  GithubSkipReason
} from './dto'
import { hasFields, isArrayOf, isBoolean, isNumber, isOneOf, isOptional, isString, type Guard } from './guard'

const isNullableString = (value: unknown): value is string | null => value === null || isString(value)

export const isGithubAccountDto: Guard<GithubAccountDto> = (value): value is GithubAccountDto =>
  hasFields(value, { login: isString, name: isNullableString })

export const isGithubRepoDto: Guard<GithubRepoDto> = (value): value is GithubRepoDto =>
  hasFields(value, { id: isString, name: isString, description: isString })

export const isGithubFileDto: Guard<GithubFileDto> = (value): value is GithubFileDto =>
  hasFields(value, { id: isString, path: isString, language: isString })

export const isGithubRepoListDto: Guard<GithubRepoListDto> = (value): value is GithubRepoListDto =>
  hasFields(value, { items: isArrayOf(isGithubRepoDto), truncated: isBoolean })

export const isGithubFileListDto: Guard<GithubFileListDto> = (value): value is GithubFileListDto =>
  hasFields(value, { items: isArrayOf(isGithubFileDto), truncated: isBoolean })

// GitHub's user-name rule (contract GithubConnect, plan 030): 1 to 39 letters or digits with
// single inner hyphens only. The same pattern as the backend (backend/src/lib/github-id.ts).
export const githubUsernameMaxLength = 39
export const githubUsernamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

export function isGithubUsername(value: string): boolean {
  return githubUsernamePattern.test(value)
}

// The name the connect card shows: the display name when GitHub has one, else the user name.
export function githubDisplayNameOf(account: GithubAccountDto): string {
  return account.name?.trim() || account.login
}

export const isGithubFileContentDto: Guard<GithubFileContentDto> = (value): value is GithubFileContentDto =>
  hasFields(value, { id: isString, path: isString, language: isString, content: isString })

// GithubSkipReason of the contract (0.7.0).
export const githubSkipReasonList: readonly GithubSkipReason[] = [
  'removed',
  'renamed',
  'binary',
  'symlink',
  'submodule',
  'folder',
  'unsupported_type',
  'invalid_path'
]

const isGithubImportFileDto: Guard<GithubImportFileDto> = (value): value is GithubImportFileDto =>
  hasFields(value, { path: isString, language: isString, size: isNumber })

const isGithubSkippedFileDto: Guard<GithubSkippedFileDto> = (value): value is GithubSkippedFileDto =>
  hasFields(value, { path: isString, reason: isOneOf(githubSkipReasonList) })

export const isGithubImportFileContentDto: Guard<GithubImportFileContentDto> = (value): value is GithubImportFileContentDto =>
  hasFields(value, { path: isString, language: isString, content: isString })

export const isGithubImportDto: Guard<GithubImportDto> = (value): value is GithubImportDto =>
  hasFields(value, {
    name: isString,
    language: isString,
    content: isString,
    fileList: isArrayOf(isGithubImportFileDto),
    skippedList: isArrayOf(isGithubSkippedFileDto),
    fileContentList: isOptional(isArrayOf(isGithubImportFileContentDto))
  })

// A GitHub link the import accepts (plan 023): a file at a ref, or a pull request.
export type GithubLink =
  | { kind: 'file'; owner: string; repo: string; ref: string; path: string }
  | { kind: 'pull'; owner: string; repo: string; number: number }

export const githubLinkMaxLength = 2000
export const githubLinkPathMaxLength = 1000

// The same rules, in the same order, as the backend parser (backend/src/lib/github-url.ts), so
// the field never refuses a link the backend accepts or lets through one it refuses (QA D3).
// The raw text is checked, not a WHATWG-normalised URL, so `..`, `%2e%2e` or `\` cannot be
// rewritten before the checks run.
const linkPrefix = 'https://github.com/'
const ownerPattern = githubUsernamePattern
const repoPattern = /^[A-Za-z0-9._-]{1,100}$/
const refPattern = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/
const pullNumberPattern = /^[1-9][0-9]{0,9}$/
const dotSegmentPattern = /^\.{1,2}$/
// Raw link text: no backslash, no white space and no control character.
// eslint-disable-next-line no-control-regex
const unsafeRawPattern = /[\\\s\u0000-\u001f\u007f]/
// A decoded path segment: no slash, backslash or control character.
// eslint-disable-next-line no-control-regex
const unsafeSegmentPattern = /[/\\\u0000-\u001f\u007f]/

function decodeOnce(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && !dotSegmentPattern.test(segment) && !unsafeSegmentPattern.test(segment)
}

// Client-side shape check for fast feedback, before anything is sent: null when the backend
// would refuse the link with a 422. The backend parses it again and stays the authority.
export function parseGithubLink(input: string): GithubLink | null {
  if (input.length > githubLinkMaxLength) return null
  const text = input.trim()
  if (!text.isWellFormed()) return null
  if (unsafeRawPattern.test(text)) return null
  // The exact prefix (case-insensitive), so another scheme, host, `www.`, user info or a port never matches.
  if (text.slice(0, linkPrefix.length).toLowerCase() !== linkPrefix) return null

  // A query (`?plain=1`) or a fragment (`#L10`) is ignored.
  const rawList = (text.slice(linkPrefix.length).split(/[?#]/, 1)[0] ?? '').split('/')
  const [rawOwner = '', rawRepo = '', kind = ''] = rawList
  // A pull link may end with one slash (`/pull/5/`); any other empty segment is refused.
  if (kind === 'pull' && rawList.length > 3 && rawList.at(-1) === '') rawList.pop()
  if (rawList.some((segment) => segment.length === 0) || rawList.length < 4) return null

  const owner = decodeOnce(rawOwner)
  const repo = decodeOnce(rawRepo)
  if (owner === null || repo === null || !ownerPattern.test(owner) || !repoPattern.test(repo) || dotSegmentPattern.test(repo)) return null

  if (kind === 'pull') {
    const tail = rawList.slice(3)
    if (!(tail.length === 1 || (tail.length === 2 && tail[1] === 'files'))) return null
    const number = tail[0] ?? ''
    return pullNumberPattern.test(number) ? { kind: 'pull', owner, repo, number: Number(number) } : null
  }
  if (kind !== 'blob') return null

  const [rawRef = '', ...rawPath] = rawList.slice(3)
  const ref = decodeOnce(rawRef)
  if (ref === null || ref.includes('/') || !refPattern.test(ref) || ref.includes('..')) return null
  if (rawPath.length === 0) return null
  // Decoded once: `%2e%2e` is `..` and `%2f` is a slash, and both are refused.
  const path = rawPath.map(decodeOnce)
  if (!path.every((segment): segment is string => segment !== null && isSafeSegment(segment))) return null
  const joined = path.join('/')
  return joined.length > githubLinkPathMaxLength ? null : { kind: 'file', owner, repo, ref, path: joined }
}

// One key per imported thing: `owner/repo/blob/ref/path` or `owner/repo/pull/number`.
export function githubLinkKey(link: GithubLink): string {
  return link.kind === 'file' ? `${link.owner}/${link.repo}/blob/${link.ref}/${link.path}` : `${link.owner}/${link.repo}/pull/${link.number}`
}

export function githubRepoKey(link: GithubLink): string {
  return `${link.owner}/${link.repo}`
}
