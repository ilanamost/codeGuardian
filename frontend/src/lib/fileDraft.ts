import { SKIP_REASON_LABEL } from './github.constants'
import type { FileDraftDto } from '../models/import-session.model'

// Plan 034 / 038: small helpers for showing one imported file (FileDraftList, FileDraftPicker).

// Why a file cannot be opened: its download error, or why the pull request skipped it.
export function detailOf(file: FileDraftDto): string | undefined {
  if (file.status === 'failed') return file.error?.userMessage || undefined
  if (file.status === 'skipped' && file.skipReason) return SKIP_REASON_LABEL[file.skipReason]
  return undefined
}

export function isOpenableFileDraft(file: FileDraftDto): boolean {
  return file.status === 'draft'
}

export function fileDraftTitleOf(file: FileDraftDto): string {
  const detail = detailOf(file)
  return detail ? `${file.path}: ${detail}` : file.path
}
