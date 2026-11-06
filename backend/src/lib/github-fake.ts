import type { FetchLike } from './github-fetch.js'
import { GITHUB_API, TIMEOUT_ERROR_NAME } from '../utils/constants.js'
import { HttpStatus } from '../utils/http-status.js'

// TEST-ONLY fake GitHub (plans 023 and 030), used by `index.ts` when the GITHUB_FAKE flag is
// "true" so the e2e suite imports links and walks the wizard with no network. It answers like
// api.github.com for a fixed set of links, users and repositories (listed in
// `.orchestrate/api-contract.yaml`, 0.7.0 and 0.9.0) and 404 for anything else. Its answers carry
// GitHub's URL fields on purpose, so tests prove the backend never returns or fetches them.

export const FAKE_GITHUB = {
  owner: 'example-org',
  repo: 'demo',
  branch: 'main',
  pullNumber: 1,
  headSha: '0123456789abcdef0123456789abcdef01234567',
  // GitHub's rate-limit reset time of the rate-limited repo: 2027-01-01T00:00:00.000Z.
  rateResetSecond: 1_798_761_600,
  rateLimitedRepo: 'rate-limited',
  brokenRepo: 'broken',
  slowRepo: 'slow',
  hugeFileSize: 200_000,

  // Plan 030: the wizard's users and repositories.
  user: 'example-user',
  userName: 'Example User',
  emptyUser: 'empty-user',
  busyUser: 'busy-user',
  busyRepoCount: 100,
  manyFileRepo: 'many-file',
  manyFileCount: 501,
  emptyRepo: 'empty'
} as const

export const FAKE_GITHUB_FILE: Record<string, string> = {
  'src/greet.ts': [
    'export function greet(name: any) {',
    '  const message = "Hello, " + name',
    '  console.log(message)',
    '  return message',
    '}',
    ''
  ].join('\n'),
  'src/util.py': [
    'def total(value_list):',
    '    result = 0',
    '    for value in value_list:',
    '        result = result + value',
    '    return result',
    ''
  ].join('\n')
}

const pullFileList = [
  { filename: 'src/greet.ts', status: 'modified', changes: 4 },
  { filename: 'src/util.py', status: 'added', changes: 5 },
  { filename: 'assets/logo.png', status: 'added', changes: 0 },
  { filename: 'src/old.js', status: 'removed', changes: 12 }
]

// The fields GitHub sends that the backend must never pass on or fetch.
const hostileUrl = 'http://169.254.169.254/latest/meta-data'

function repoEntry(owner: string, name: string, description: string | null) {
  return {
    name,
    full_name: `${owner}/${name}`,
    private: false,
    description,
    html_url: `https://github.com/${owner}/${name}`,
    clone_url: hostileUrl,
    url: hostileUrl
  }
}

function blob(path: string, size: number) {
  return { path, mode: '100644', type: 'blob', sha: FAKE_GITHUB.headSha, size, url: hostileUrl }
}

const demoTree = [
  blob('README.md', 20),
  blob('assets/logo.png', 512),
  { path: 'src', mode: '040000', type: 'tree', sha: FAKE_GITHUB.headSha, url: hostileUrl },
  blob('src/greet.ts', Buffer.byteLength(FAKE_GITHUB_FILE['src/greet.ts'] ?? '')),
  blob('src/huge.ts', FAKE_GITHUB.hugeFileSize),
  blob('src/util.py', Buffer.byteLength(FAKE_GITHUB_FILE['src/util.py'] ?? '')),
  { path: 'vendor', mode: '160000', type: 'commit', sha: FAKE_GITHUB.headSha }
]

const userRepoList = [
  repoEntry(FAKE_GITHUB.user, FAKE_GITHUB.repo, 'A small demo repository'),
  repoEntry(FAKE_GITHUB.user, FAKE_GITHUB.manyFileRepo, 'More files than the wizard lists'),
  repoEntry(FAKE_GITHUB.user, FAKE_GITHUB.emptyRepo, null),
  repoEntry(FAKE_GITHUB.user, FAKE_GITHUB.rateLimitedRepo, 'Answers 429'),
  repoEntry(FAKE_GITHUB.user, FAKE_GITHUB.brokenRepo, 'Answers 502'),
  repoEntry(FAKE_GITHUB.user, FAKE_GITHUB.slowRepo, 'Answers 504')
]

function json(body: unknown, status: number = HttpStatus.Ok, header: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { [GITHUB_API.headerName.contentType]: GITHUB_API.jsonType, ...header } })
}

function contentEntry(path: string, text: string): Response {
  const content = Buffer.from(text, 'utf8').toString('base64')
  return json({ type: 'file', name: path.split('/').at(-1), path, size: Buffer.byteLength(text), encoding: 'base64', content, download_url: hostileUrl })
}

function rateLimited(): Response {
  return json({}, HttpStatus.Forbidden, {
    [GITHUB_API.headerName.rateRemaining]: GITHUB_API.rateExhausted,
    [GITHUB_API.headerName.rateReset]: String(FAKE_GITHUB.rateResetSecond)
  })
}

// 429, 502 or 504 for the three failing names, undefined otherwise.
function failureOf(name: string | undefined): Response | undefined {
  if (name === FAKE_GITHUB.rateLimitedRepo) return rateLimited()
  if (name === FAKE_GITHUB.brokenRepo) return json({}, HttpStatus.InternalServerError)
  if (name === FAKE_GITHUB.slowRepo) throw new DOMException('The operation timed out.', TIMEOUT_ERROR_NAME)
  return undefined
}

function userOf(name: string | undefined): Response {
  const failure = failureOf(name)
  if (failure) return failure
  const avatar = { avatar_url: hostileUrl, html_url: `https://github.com/${name}`, email: null }
  if (name === FAKE_GITHUB.user) return json({ login: FAKE_GITHUB.user, name: FAKE_GITHUB.userName, type: 'User', ...avatar })
  if (name === FAKE_GITHUB.emptyUser) return json({ login: FAKE_GITHUB.emptyUser, name: null, type: 'User', ...avatar })
  if (name === FAKE_GITHUB.busyUser) return json({ login: FAKE_GITHUB.busyUser, name: 'Busy User', type: 'User', ...avatar })
  return json({ message: 'Not Found' }, HttpStatus.NotFound)
}

function repoListOf(name: string | undefined): Response {
  if (name === FAKE_GITHUB.user) return json(userRepoList)
  if (name === FAKE_GITHUB.emptyUser) return json([])
  if (name === FAKE_GITHUB.busyUser) {
    const list = Array.from({ length: FAKE_GITHUB.busyRepoCount }, (_, index) => repoEntry(FAKE_GITHUB.busyUser, `repo-${String(index + 1).padStart(3, '0')}`, null))
    const next = `<${GITHUB_API.origin}/user/1/repos?page=2>; rel="next", <${GITHUB_API.origin}/user/1/repos?page=3>; rel="last"`
    return json(list, HttpStatus.Ok, { [GITHUB_API.headerName.link]: next })
  }
  return json({ message: 'Not Found' }, HttpStatus.NotFound)
}

// /repos/example-user/{repo}/...: the wizard's tree and contents calls at the default branch.
function userRepoOf(repo: string | undefined, kind: string | undefined, rest: string[], url: URL): Response {
  const failure = failureOf(repo)
  if (failure) return failure
  const isTree = kind === GITHUB_API.gitPath && rest[0] === GITHUB_API.treesPath && rest[1] === GITHUB_API.headRef && rest.length === 2
  if (isTree && url.searchParams.get(GITHUB_API.recursiveParam) === GITHUB_API.recursiveOn) {
    if (repo === FAKE_GITHUB.repo) return json({ sha: FAKE_GITHUB.headSha, url: hostileUrl, tree: demoTree, truncated: false })
    if (repo === FAKE_GITHUB.manyFileRepo) {
      const tree = Array.from({ length: FAKE_GITHUB.manyFileCount }, (_, index) => blob(`src/file-${String(index + 1).padStart(3, '0')}.ts`, 10))
      return json({ sha: FAKE_GITHUB.headSha, tree, truncated: false })
    }
    if (repo === FAKE_GITHUB.emptyRepo) return json({ message: 'Git Repository is empty.' }, HttpStatus.Conflict)
  }
  if (kind === GITHUB_API.contentsPath && repo === FAKE_GITHUB.repo && !url.searchParams.has(GITHUB_API.refParam)) {
    const path = rest.join('/')
    if (path === 'src/huge.ts') return json({ type: 'file', path, size: FAKE_GITHUB.hugeFileSize, encoding: 'none', content: '' })
    const text = Object.hasOwn(FAKE_GITHUB_FILE, path) ? FAKE_GITHUB_FILE[path] : undefined
    if (text !== undefined) return contentEntry(path, text)
  }
  return json({ message: 'Not Found' }, HttpStatus.NotFound)
}

export function createFakeGithubFetch(): FetchLike {
  return async (input) => {
    const url = new URL(input)
    if (url.origin !== GITHUB_API.origin) throw new TypeError('fetch failed')
    const [, root, owner, repo, kind, ...rest] = url.pathname.split('/').map(decodeURIComponent)

    // Plan 030: /users/{name} and /users/{name}/repos.
    if (`/${root}` === GITHUB_API.userPath) {
      if (repo === undefined) return userOf(owner)
      if (repo === GITHUB_API.reposPath && kind === undefined) return repoListOf(owner)
      return json({}, HttpStatus.NotFound)
    }
    if (`/${root}` !== GITHUB_API.repoPath) return json({}, HttpStatus.NotFound)
    if (owner === FAKE_GITHUB.user) return userRepoOf(repo, kind, rest, url)

    if (owner === FAKE_GITHUB.owner) {
      const failure = failureOf(repo)
      if (failure) return failure
    }
    if (owner !== FAKE_GITHUB.owner || repo !== FAKE_GITHUB.repo) return json({}, HttpStatus.NotFound)

    const ref = url.searchParams.get(GITHUB_API.refParam)
    const path = rest.join('/')
    if (kind === GITHUB_API.contentsPath && (ref === FAKE_GITHUB.branch || ref === FAKE_GITHUB.headSha)) {
      if (path === 'src/huge.ts' && ref === FAKE_GITHUB.branch) {
        return json({ type: 'file', path, size: FAKE_GITHUB.hugeFileSize, encoding: 'none', content: '' })
      }
      const text = Object.hasOwn(FAKE_GITHUB_FILE, path) ? FAKE_GITHUB_FILE[path] : undefined
      if (text !== undefined) return contentEntry(path, text)
    }
    if (kind === GITHUB_API.pullsPath && rest[0] === String(FAKE_GITHUB.pullNumber)) {
      if (rest.length === 1) return json({ number: FAKE_GITHUB.pullNumber, changed_files: pullFileList.length, head: { sha: FAKE_GITHUB.headSha } })
      if (rest.length === 2 && rest[1] === GITHUB_API.filesPath) return json(pullFileList)
    }
    return json({}, HttpStatus.NotFound)
  }
}
