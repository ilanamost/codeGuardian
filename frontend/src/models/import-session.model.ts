import type { AppErrorJson } from './app-error'
import type { GithubSkipReason, ReviewStatus } from './dto'
import { REVIEW_STATUS, unfinishedStatusList } from './review.model'

// Plan 034 (Open Questions 2 and 3): several files imported at once (the GitHub wizard, or a
// pull-request link) open as one IMPORT SESSION on the New Review page. Each file is a FILE
// DRAFT: its own code, language and edits, kept in memory only (never in browser storage), until
// Run review creates that file's own review. A file that could not be downloaded, or that the
// pull request skipped, is listed too, without code. Plain data: it lives in Redux state.

// `draft`: has code (it may also have a review by now); `failed`: its download failed;
// `skipped`: a pull-request file that was not imported (GithubSkipReason).
export type FileDraftStatus = 'draft' | 'failed' | 'skipped'

export interface FileDraftDto {
  // Unique within the session (`file-<index>`); a pull request can repeat nothing, but the key
  // never depends on the path.
  key: string
  path: string
  language: string
  // The current code, with the user's edits ('' when there is none).
  code: string
  status: FileDraftStatus
  // The review Run review created for this file, and its last known status.
  reviewId: string | null
  reviewStatus: ReviewStatus | null
  // Why the download failed (`failed` only).
  error: AppErrorJson | null
  // Why the pull request skipped it (`skipped` only).
  skipReason: GithubSkipReason | null
}

export interface ImportSessionDto {
  // The repository or pull request the files came from (`owner/repo#number`).
  name: string
  fileList: FileDraftDto[]
  // The file draft open on /review/new.
  selectedKey: string
}

const keyOf = (index: number) => `file-${index}`

function baseOf(index: number, path: string, language: string): FileDraftDto {
  return { key: keyOf(index), path, language, code: '', status: 'draft', reviewId: null, reviewStatus: null, error: null, skipReason: null }
}

export function fileDraftOf(index: number, path: string, language: string, code: string): FileDraftDto {
  return { ...baseOf(index, path, language), code }
}

export function failedFileDraftOf(index: number, path: string, language: string, error: AppErrorJson): FileDraftDto {
  return { ...baseOf(index, path, language), status: 'failed', error }
}

export function skippedFileDraftOf(index: number, path: string, reason: GithubSkipReason): FileDraftDto {
  return { ...baseOf(index, path, ''), status: 'skipped', skipReason: reason }
}

// A session whose first openable file is selected; null when no file has code.
export function importSessionOf(name: string, fileList: FileDraftDto[]): ImportSessionDto | null {
  const first = fileList.find((file) => file.status === 'draft')
  return first ? { name, fileList, selectedKey: first.key } : null
}

// A file with code that has no review yet: leaving the page would lose it.
export function isUnsavedFileDraft(file: FileDraftDto): boolean {
  return file.status === 'draft' && file.reviewId === null
}

export function hasUnsavedFileDraft(session: ImportSessionDto | null): boolean {
  return session?.fileList.some(isUnsavedFileDraft) ?? false
}

// What the file list shows for a file (its status mark).
export type FileDraftMark = 'draft' | 'analyzing' | 'reviewed' | 'reviewFailed' | 'importFailed' | 'skipped'

export function fileDraftMarkOf(file: FileDraftDto): FileDraftMark {
  if (file.status === 'failed') return 'importFailed'
  if (file.status === 'skipped') return 'skipped'
  if (!file.reviewId) return 'draft'
  if (file.reviewStatus === REVIEW_STATUS.completed) return 'reviewed'
  if (file.reviewStatus === null || unfinishedStatusList.includes(file.reviewStatus)) return 'analyzing'
  return 'reviewFailed'
}
