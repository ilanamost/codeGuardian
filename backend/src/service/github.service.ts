import { AppError, conflictError, notFoundError, validationError } from '../lib/error.js'
import type { GithubClient, ImportBudget } from '../lib/github-fetch.js'
import { encodeFileId } from '../lib/github-id.js'
import { isSafeRepoPath } from '../lib/github-url.js'
import type { GithubAccount, GithubFile, GithubFileContent, GithubFileList, GithubRepoList } from '../model/dto.js'
import type { GithubConnectionRecord, Store } from '../store/store.js'
import { GITHUB_TREE_TYPE } from '../utils/constants.js'
import { SkipReason } from '../utils/domain.js'
import { ErrorCode } from '../utils/error-code.js'
import { ERROR_MESSAGE, GITHUB_FILE_ISSUE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'
import { languageEntryOf } from './github-import.service.js'

export type GithubService = ReturnType<typeof createGithubService>

export type GithubServiceOption = {
  // The overall deadline of one wizard request; defaults to `LIMIT.github.totalTimeoutMs`.
  totalTimeoutMs?: number
}

const fileIssueByReason: Partial<Record<SkipReason, string>> = {
  [SkipReason.Binary]: GITHUB_FILE_ISSUE.binary,
  [SkipReason.Folder]: GITHUB_FILE_ISSUE.folder,
  [SkipReason.Symlink]: GITHUB_FILE_ISSUE.symlink,
  [SkipReason.Submodule]: GITHUB_FILE_ISSUE.submodule
}

// The GitHub Integration wizard over the real public GitHub API (plan 030). The connection is
// the org's stored GitHub `login` (no token); every repository call reads that user's public
// repositories through the shared GitHub client. Path values are checked by the route
// (`lib/github-id.ts`) before they get here. Nothing from GitHub is cached or stored except the
// login and the display name, and only the contract's fields are returned.
export function createGithubService(store: Store, client: GithubClient, option: GithubServiceOption = {}) {
  const totalTimeoutMs = option.totalTimeoutMs ?? LIMIT.github.totalTimeoutMs

  function newBudget(): ImportBudget {
    return { signal: AbortSignal.timeout(totalTimeoutMs), totalTimeoutMs }
  }

  async function connectionOf(orgId: string): Promise<GithubConnectionRecord> {
    const connection = await store.getGithubConnection(orgId)
    if (!connection) throw conflictError(ERROR_MESSAGE.githubNotConnected)
    return connection
  }

  // A GitHub 404 with the wizard's own message (the client's default speaks of links).
  async function withNotFound<T>(message: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.NotFound) throw notFoundError(message)
      throw error
    }
  }

  return {
    // One GitHub call; nothing is stored unless the user exists.
    async connect(orgId: string, username: string): Promise<GithubAccount> {
      const user = await client.getUser(username, newBudget())
      await store.setGithubConnection(orgId, { login: user.login, name: user.name })
      return { login: user.login, name: user.name }
    },

    async disconnect(orgId: string): Promise<void> {
      await store.setGithubConnection(orgId, null)
    },

    async searchRepo(orgId: string, query = ''): Promise<GithubRepoList> {
      const { login } = await connectionOf(orgId)
      const page = await client.listUserRepo(login, newBudget())
      const needle = query.trim().toLowerCase()
      return {
        items: page.repoList
          .filter((repo) => repo.name.toLowerCase().includes(needle))
          .map((repo) => ({ id: repo.name, name: repo.name, description: repo.description })),
        truncated: page.hasMore
      }
    },

    async listFile(orgId: string, repoName: string): Promise<GithubFileList> {
      const { login } = await connectionOf(orgId)
      const tree = await withNotFound(ERROR_MESSAGE.githubRepoNotFound, () => client.getTree(login, repoName, newBudget()))
      const kept: GithubFile[] = []
      let truncated = tree.truncated
      for (const entry of tree.entryList) {
        if (entry.type !== GITHUB_TREE_TYPE.blob || !isSafeRepoPath(entry.path)) continue
        const language = languageEntryOf(entry.path)?.language
        if (!language) continue
        // Over the single-file limit by its declared size (an unknown size is left out too).
        if (entry.size === undefined || entry.size > LIMIT.github.listedFileByte) continue
        if (kept.length === LIMIT.github.fileListMax) {
          truncated = true
          break
        }
        kept.push({ id: encodeFileId(entry.path), path: entry.path, language })
      }
      return { items: kept, truncated }
    },

    // `path` is the decoded, checked file id. The extension is checked before any call.
    async getFile(orgId: string, repoName: string, fileId: string, path: string): Promise<GithubFileContent> {
      const entry = languageEntryOf(path)
      if (!entry) throw validationError(ERROR_MESSAGE.githubFileUnsupported(GITHUB_FILE_ISSUE.unsupportedType))
      const { login } = await connectionOf(orgId)
      const fetched = await withNotFound(ERROR_MESSAGE.githubFileNotFound,
        () => client.getFile(login, repoName, path.split('/'), undefined, newBudget()))
      if (fetched.kind === 'skip') {
        throw validationError(ERROR_MESSAGE.githubFileUnsupported(fileIssueByReason[fetched.reason] ?? GITHUB_FILE_ISSUE.unsupportedType))
      }
      if (fetched.text.length === 0) throw validationError(ERROR_MESSAGE.githubFileUnsupported(GITHUB_FILE_ISSUE.empty))
      return { id: fileId, path, language: entry.language, content: fetched.text }
    }
  }
}
