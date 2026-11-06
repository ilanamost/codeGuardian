import type { GithubImportDto, GithubSkipReason, WizardStep } from '../types'

// Steps of the GitHub import wizard (UI constant, not data).
export const wizardStepList: { id: WizardStep; label: string }[] = [
  { id: 'repo', label: 'Select repository' },
  { id: 'file', label: 'Select file' }
]

// The wizard lists' caps (contract 0.9.0): one GitHub page of repositories, and files per repository.
export const GITHUB_LIST_LIMIT = {
  repo: 100,
  file: 500
} as const

export const GITHUB_TEXT = {
  switchAccount: 'Switch account',
  connect: 'Connect GitHub',
  connecting: 'Connecting...',
  notConnected: 'Not connected',
  connectedAs: (login: string) => `Connected as ${login}`,
  // The connect card's user-name field (plan 030).
  usernameLabel: 'GitHub user name',
  usernamePlaceholder: 'octocat',
  publicOnly: 'Public repositories only. No GitHub sign-in or token is used.',
  // A list cut by the caps above, and an account without repositories.
  repoTruncated: (count: number) => `Showing the first ${count} repositories. Search narrows this list only.`,
  fileTruncated: (count: number) => `Showing the first ${count} files of this repository.`,
  noRepo: 'This account has no public repositories.',
  noRepoMatch: 'No repositories match',
  noFile: 'No supported files in this repository.',
  // Plan 037: the wizard lists' Loader while they load.
  loadingRepo: 'Loading repositories...',
  loadingFile: 'Loading files...',
  approve: 'Approve',
  importing: 'Importing...',
  // The first selected file opens in the editor as a new review.
  imported: (path: string, repoId: string) => `Imported ${path} from ${repoId}`,
  // Plan 034: several files, one after the other, then opened as a list of drafts.
  importingCount: (done: number, total: number) => `Importing ${Math.min(done + 1, total)} of ${total}...`,
  importedCount: (count: number, total: number, repoId: string) =>
    count === total ? `Imported ${count} files from ${repoId}` : `Imported ${count} of ${total} files from ${repoId}`
} as const

// The GitHub link import limits (plan 023, Open Question 3; the backend's LIMIT.github). A 413
// names the limit that was hit in `details.limit`; the numbers shown are these.
export const GITHUB_IMPORT_LIMIT = {
  fileChar: 50_000,
  totalChar: 100_000,
  fileCount: 20
} as const

export type GithubImportLimitName = keyof typeof GITHUB_IMPORT_LIMIT

export function isGithubImportLimitName(value: unknown): value is GithubImportLimitName {
  return typeof value === 'string' && Object.hasOwn(GITHUB_IMPORT_LIMIT, value)
}

const formatCount = (value: number) => value.toLocaleString('en-US')

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// Why a pull-request file was not imported (GithubSkipReason), as the success toast lists it.
export const SKIP_REASON_LABEL: Record<GithubSkipReason, string> = {
  removed: 'removed',
  renamed: 'renamed only',
  binary: 'binary',
  symlink: 'symlink',
  submodule: 'submodule',
  folder: 'folder',
  unsupported_type: 'unsupported type',
  invalid_path: 'invalid path'
}

// The "Paste a GitHub link" field on the GitHub Integration page (plan 023).
export const GITHUB_LINK_TEXT = {
  title: 'Paste a GitHub link',
  description: 'Import a public file or pull request. No GitHub connection needed.',
  label: 'GitHub link',
  placeholder: 'https://github.com/owner/repo/blob/main/src/file.ts',
  import: 'Import',
  importing: 'Importing...',
  limit: `Up to ${formatCount(GITHUB_IMPORT_LIMIT.fileChar)} characters per file, ${formatCount(GITHUB_IMPORT_LIMIT.totalChar)} in total, ${GITHUB_IMPORT_LIMIT.fileCount} files per pull request.`,
  imported: (result: Pick<GithubImportDto, 'name' | 'fileList'>) => `Imported ${result.name} (${plural(result.fileList.length, 'file')})`,
  // The success toast's description: the skipped files, then the limits that applied.
  importedDetail: (result: Pick<GithubImportDto, 'skippedList'>) => {
    const { skippedList } = result
    const skipped =
      skippedList.length === 0
        ? 'No files skipped.'
        : `Skipped ${plural(skippedList.length, 'file')}: ${skippedList.map((item) => `${item.path} (${SKIP_REASON_LABEL[item.reason]})`).join(', ')}.`
    return `${skipped} ${GITHUB_LINK_TEXT.limit}`
  }
} as const
