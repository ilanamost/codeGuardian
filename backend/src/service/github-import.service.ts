import { payloadTooLargeError, validationError } from '../lib/error.js'
import type { GithubClient, ImportBudget } from '../lib/github-fetch.js'
import { isSafeRepoPath, parseGithubUrl, type GithubFileLink, type GithubPullLink } from '../lib/github-url.js'
import type { GithubImport, GithubImportFile, GithubImportFileContent, GithubSkippedFile } from '../model/dto.js'
import { GITHUB_FILE_STATUS, IMPORT_JOIN, IMPORT_LANGUAGE_TABLE } from '../utils/constants.js'
import { GithubLinkKind, ImportLanguage, ImportLimit, SkipReason } from '../utils/domain.js'
import { ERROR_MESSAGE, GITHUB_FILE_ISSUE } from '../utils/error-messages.js'
import { LIMIT } from '../utils/limits.js'

export type GithubImportService = ReturnType<typeof createGithubImportService>

export type GithubImportOption = {
  // The overall deadline of one import; defaults to `LIMIT.github.totalTimeoutMs`.
  totalTimeoutMs?: number
}

type LanguageEntry = (typeof IMPORT_LANGUAGE_TABLE)[number]

// Looks a file name up in the one language table (plan 023, scope 6).
export function languageEntryOf(path: string): LanguageEntry | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  const extension = name.slice(dot + 1).toLowerCase()
  return IMPORT_LANGUAGE_TABLE.find((entry) => entry.extensionList.includes(extension))
}

// `// ===== src/a.ts =====` in the file's own comment style (Open Question 2).
function headerOf(entry: LanguageEntry, path: string): string {
  const line = `${entry.comment.start} ${IMPORT_JOIN.marker} ${path} ${IMPORT_JOIN.marker}`
  return entry.comment.end ? `${line} ${entry.comment.end}` : line
}

const blobIssueByReason: Partial<Record<SkipReason, string>> = {
  [SkipReason.Binary]: GITHUB_FILE_ISSUE.binary,
  [SkipReason.Folder]: GITHUB_FILE_ISSUE.folder,
  [SkipReason.Symlink]: GITHUB_FILE_ISSUE.symlink,
  [SkipReason.Submodule]: GITHUB_FILE_ISSUE.submodule
}

function limitError(limit: ImportLimit.TotalChar | ImportLimit.FileCount, max: number, path?: string) {
  return payloadTooLargeError(ERROR_MESSAGE.githubLimit(limit, max), { limit, max, ...(path === undefined ? {} : { path }) })
}

// The most common language among the kept files; the first listed wins a tie.
function mostCommon(fileList: GithubImportFile[]): ImportLanguage {
  const countMap = new Map<string, number>()
  for (const file of fileList) countMap.set(file.language, (countMap.get(file.language) ?? 0) + 1)
  let best = fileList[0]?.language ?? ImportLanguage.TypeScript
  for (const file of fileList) if ((countMap.get(file.language) ?? 0) > (countMap.get(best) ?? 0)) best = file.language
  return best as ImportLanguage
}

function nameOf(text: string): string {
  return text.slice(0, LIMIT.reviewName.max)
}

// POST /api/github/import (plan 023): parse the link, then read the code through the GitHub
// client, enforcing the limits in this order: declared size, streamed bytes, running total,
// file count (the file count of a PR is known first, so it is checked before any file is read).
// The first limit hit stops the import and no further call is made. Nothing is stored.
export function createGithubImportService(client: GithubClient, option: GithubImportOption = {}) {
  const totalTimeoutMs = option.totalTimeoutMs ?? LIMIT.github.totalTimeoutMs

  async function importFile(link: GithubFileLink, budget: ImportBudget): Promise<GithubImport> {
    const path = link.path.join('/')
    const entry = languageEntryOf(path)
    // Checked before any call: an unsupported file costs no GitHub request.
    if (!entry) throw validationError(ERROR_MESSAGE.githubUnsupportedFile(GITHUB_FILE_ISSUE.unsupportedType))

    const fetched = await client.getFile(link.owner, link.repo, link.path, link.ref, budget)
    if (fetched.kind === 'skip') {
      throw validationError(ERROR_MESSAGE.githubUnsupportedFile(blobIssueByReason[fetched.reason] ?? GITHUB_FILE_ISSUE.unsupportedType))
    }
    if (fetched.text.length === 0) throw validationError(ERROR_MESSAGE.githubUnsupportedFile(GITHUB_FILE_ISSUE.empty))

    return {
      name: nameOf(link.path.at(-1) ?? path),
      language: entry.language,
      content: fetched.text,
      fileList: [{ path, language: entry.language, size: fetched.text.length }],
      skippedList: [],
      // Plan 034: one entry equal to `content`.
      fileContentList: [{ path, language: entry.language, content: fetched.text }]
    }
  }

  async function importPull(link: GithubPullLink, budget: ImportBudget): Promise<GithubImport> {
    const pull = await client.getPull(link.owner, link.repo, link.number, budget)
    if (pull.changedFileCount > LIMIT.github.fileCount) throw limitError(ImportLimit.FileCount, LIMIT.github.fileCount)

    const entryList = await client.listPullFile(link.owner, link.repo, link.number, budget)
    if (entryList.length > LIMIT.github.fileCount) throw limitError(ImportLimit.FileCount, LIMIT.github.fileCount)

    const skippedList: GithubSkippedFile[] = []
    const candidateList: { path: string, entry: LanguageEntry }[] = []
    for (const item of entryList) {
      const skip = (reason: SkipReason) => skippedList.push({ path: item.path, reason })
      if (item.status === GITHUB_FILE_STATUS.removed) skip(SkipReason.Removed)
      else if (item.status === GITHUB_FILE_STATUS.renamed && item.changeCount === 0) skip(SkipReason.Renamed)
      else if (!isSafeRepoPath(item.path)) skip(SkipReason.InvalidPath)
      else {
        const entry = languageEntryOf(item.path)
        if (entry) candidateList.push({ path: item.path, entry })
        else skip(SkipReason.UnsupportedType)
      }
    }

    const fileList: GithubImportFile[] = []
    // Plan 034: each kept file's code, unchanged; the limits above apply to the joined text.
    const fileContentList: GithubImportFileContent[] = []
    const blockList: string[] = []
    let total = 0
    for (const candidate of candidateList) {
      // The PR head commit, read through the base repository (plan 023, Assumptions).
      const fetched = await client.getFile(link.owner, link.repo, candidate.path.split('/'), pull.headSha, budget)
      if (fetched.kind === 'skip') {
        skippedList.push({ path: candidate.path, reason: fetched.reason })
        continue
      }
      const text = fetched.text.endsWith(IMPORT_JOIN.lineBreak) || fetched.text.length === 0 ? fetched.text : `${fetched.text}${IMPORT_JOIN.lineBreak}`
      const block = `${headerOf(candidate.entry, candidate.path)}${IMPORT_JOIN.lineBreak}${text}`
      const added = block.length + (blockList.length > 0 ? IMPORT_JOIN.fileSeparator.length : 0)
      if (total + added > LIMIT.github.totalChar) throw limitError(ImportLimit.TotalChar, LIMIT.github.totalChar, candidate.path)
      total += added
      blockList.push(block)
      fileList.push({ path: candidate.path, language: candidate.entry.language, size: fetched.text.length })
      fileContentList.push({ path: candidate.path, language: candidate.entry.language, content: fetched.text })
    }

    if (fileList.length === 0) throw validationError(ERROR_MESSAGE.githubNothingToImport, { skippedList })

    return {
      name: nameOf(`${link.owner}/${link.repo}${IMPORT_JOIN.pullNameSeparator}${link.number}`),
      language: mostCommon(fileList),
      content: blockList.join(IMPORT_JOIN.fileSeparator),
      fileList,
      skippedList,
      fileContentList
    }
  }

  return {
    async importLink(url: string): Promise<GithubImport> {
      const link = parseGithubUrl(url)
      const budget: ImportBudget = { signal: AbortSignal.timeout(totalTimeoutMs), totalTimeoutMs }
      return link.kind === GithubLinkKind.File ? importFile(link, budget) : importPull(link, budget)
    }
  }
}
