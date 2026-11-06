import { useCallback, useEffect, useState } from 'react'
import { isOneOf } from '../models/guard'
import { createStorageService, type StorageService } from '../services/storage.service'

// Plan 038: whether the imported files list (FileDraftList) is open or closed. A per-browser
// display preference, not account data: it lives in browser storage under one key, is read once
// when the frame mounts and written on every toggle. Only the two valid values are accepted;
// anything else, or storage that is blocked or throws, means the default (open).
export const fileListStorageKey = 'ui.fileList'

const fileListValue = ['open', 'closed'] as const
type FileListValue = (typeof fileListValue)[number]
const isFileListValue = isOneOf<FileListValue>(fileListValue)

export const FILE_LIST_DEFAULT_OPEN = true

const browserStorage = createStorageService()

export function readFileListOpen(storage: StorageService = browserStorage): boolean {
  const value = storage.get(fileListStorageKey, isFileListValue)
  return value === undefined ? FILE_LIST_DEFAULT_OPEN : value === 'open'
}

export function writeFileListOpen(open: boolean, storage: StorageService = browserStorage): void {
  try {
    storage.set(fileListStorageKey, open ? 'open' : 'closed')
  } catch {
    // Private mode or blocked storage: the choice holds for this page only, without an error.
  }
}

/**
 * The open or closed state of the imported files list, remembered in this browser. The toggle is a
 * functional update, so toggles that land in the same tick all count (QA 038 F2); storage is
 * written from an effect after each toggle (not on mount, and not inside the state updater).
 */
export function useFileListOpen(storage?: StorageService): [boolean, () => void] {
  const [state, setState] = useState(() => ({ open: readFileListOpen(storage), toggleCount: 0 }))
  useEffect(() => {
    if (state.toggleCount > 0) writeFileListOpen(state.open, storage)
  }, [state, storage])
  const toggle = useCallback(() => setState((previous) => ({ open: !previous.open, toggleCount: previous.toggleCount + 1 })), [])
  return [state.open, toggle]
}
