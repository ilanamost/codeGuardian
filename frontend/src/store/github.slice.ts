import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { GITHUB_IMPORT_LIMIT } from '../lib/github.constants'
import { AppError, type AppErrorJson } from '../models/app-error'
import type { GithubAccountDto, GithubFileDto, GithubRepoDto } from '../models/dto'
import { DEV_ERROR_MESSAGE, ERROR_CODE } from '../utils/error-messages'
import { attempt, createAppAsyncThunk, type AsyncStatus } from './thunk'
import type { RootState } from './index'

export interface GithubState {
  account: GithubAccountDto | null
  repoList: GithubRepoDto[]
  // GitHub has more repositories than the first page of 100 (contract 0.9.0).
  repoTruncated: boolean
  repoStatus: AsyncStatus
  latestSearchId: string | null
  selectedRepoId: string | null
  fileList: GithubFileDto[]
  // The repository has more files than the 500 the wizard lists (contract 0.9.0).
  fileTruncated: boolean
  fileStatus: AsyncStatus
  // Switch account (POST /api/github/disconnect) and Import (GET .../file/{fileId}).
  disconnectStatus: AsyncStatus
  importStatus: AsyncStatus
  // Plan 034: the wizard's import of several files, one GET .../file/{fileId} after the other:
  // how many are done of how many (null when no such import runs).
  importProgress: { done: number; total: number } | null
  // "Paste a GitHub link" (POST /api/github/import, plan 023); needs no connected account.
  linkImportStatus: AsyncStatus
  status: AsyncStatus
  error: AppErrorJson | null
}

export const initialGithubState: GithubState = {
  account: null,
  repoList: [],
  repoTruncated: false,
  repoStatus: 'idle',
  latestSearchId: null,
  selectedRepoId: null,
  fileList: [],
  fileTruncated: false,
  fileStatus: 'idle',
  disconnectStatus: 'idle',
  importStatus: 'idle',
  importProgress: null,
  linkImportStatus: 'idle',
  status: 'idle',
  error: null
}

export interface ConnectGithubInput {
  // The GitHub user name (plan 030).
  username: string
  // The current repository search.
  query?: string
}

// Connects the account and loads its repositories matching the current search, as one step.
// QA F3 (by design): when the connect succeeds but that first list fails (for example GitHub's
// 429), the card stays "Not connected" although the server stored the connection. Connect stays
// available, and a retry replaces the stored connection and loads the list again. Showing the
// account there would need a list-error state with its own retry, or the empty list would read
// as "This account has no public repositories."
export const connectGithub = createAppAsyncThunk('github/connect', (input: ConnectGithubInput, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.githubConnect, rejectWithValue, async () => {
    const account = await extra.github.connect(input.username)
    const repoList = await extra.github.searchRepo(input.query ?? '')
    return { account, repoList }
  })
)

export const searchRepo = createAppAsyncThunk('github/searchRepo', (query: string, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.githubRepoLoad, rejectWithValue, () => extra.github.searchRepo(query))
)

export const selectRepo = createAppAsyncThunk('github/selectRepo', (repoId: string, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.githubFileLoad, rejectWithValue, () => extra.github.listFile(repoId))
)

// Forgets the account on the server; the wizard clears it once that succeeded.
export const disconnectGithub = createAppAsyncThunk('github/disconnect', (_: void, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.githubDisconnect, rejectWithValue, () => extra.github.disconnect())
)

// The file with its content; the review slice keeps it as the new review's draft.
export const importGithubFile = createAppAsyncThunk(
  'github/importFile',
  ({ repoId, fileId }: { repoId: string; fileId: string }, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.githubFileImport, rejectWithValue, () => extra.github.getFile(repoId, fileId))
)

// One file of a multi-file import: its code, or why its download failed.
export interface GithubFileImportItem {
  file: GithubFileDto
  content: string | null
  error: AppErrorJson | null
}

export interface GithubFileListImport {
  repoId: string
  itemList: GithubFileImportItem[]
}

// Plan 034 (Open Question 2): every ticked file, at most GITHUB_IMPORT_LIMIT.fileCount (20), one
// GET .../file/{fileId} after the other (GitHub allows 60 calls an hour without sign-in), with
// the progress in state. A failed file is kept with its error and the others still load; after
// GitHub's 429 the remaining files are not asked for (they would fail the same way). It rejects
// only when every file failed, on a 409 (no connected account: the wizard starts over), or when
// the caller cancelled it. The review slice opens the files as an import session.
export const importGithubFileList = createAppAsyncThunk(
  'github/importFileList',
  async ({ repoId, fileList }: { repoId: string; fileList: GithubFileDto[] }, { extra, rejectWithValue, dispatch, signal }) => {
    const failure = (error: unknown) => AppError.from(error, ERROR_CODE.githubFileImport).forAction(ERROR_CODE.githubFileImport).toJSON()
    if (fileList.length === 0 || fileList.length > GITHUB_IMPORT_LIMIT.fileCount) {
      return rejectWithValue(failure(new AppError({ code: ERROR_CODE.validation, kind: 'validation', message: DEV_ERROR_MESSAGE.githubFileCount })))
    }
    const itemList: GithubFileImportItem[] = []
    let rateLimited: AppErrorJson | null = null
    for (const file of fileList) {
      if (signal.aborted) return rejectWithValue(failure(new AppError({ code: ERROR_CODE.abort, kind: 'abort', message: DEV_ERROR_MESSAGE.cancelled })))
      dispatch(importProgressed({ done: itemList.length, total: fileList.length }))
      if (rateLimited) {
        itemList.push({ file, content: null, error: rateLimited })
        continue
      }
      try {
        const loaded = await extra.github.getFile(repoId, file.id)
        itemList.push({ file: { id: file.id, path: loaded.path, language: loaded.language }, content: loaded.content, error: null })
      } catch (error) {
        const json = failure(error)
        if (json.causeCode === ERROR_CODE.conflict) return rejectWithValue(json)
        if (json.causeCode === ERROR_CODE.rateLimited) rateLimited = json
        itemList.push({ file, content: null, error: json })
      }
    }
    const firstError = itemList.find((item) => item.error)?.error
    if (firstError && itemList.every((item) => item.error)) return rejectWithValue(firstError)
    return { repoId, itemList } satisfies GithubFileListImport
  }
)

// The code of a public GitHub file or pull-request link; like importGithubFile, the review slice
// keeps it as the new review's draft. The page checks the link's shape before dispatching.
export const importGithubLink = createAppAsyncThunk('github/importLink', (url: string, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.githubLinkImport, rejectWithValue, () => extra.github.importLink(url))
)

function clearFile(state: GithubState) {
  state.fileList = []
  state.fileTruncated = false
}

function clearAccount(state: GithubState) {
  state.account = null
  state.selectedRepoId = null
  clearFile(state)
  state.fileStatus = 'idle'
}

// A 409 conflict from a repository route (contract 0.9.0): the server has no connected account
// any more (for example after Switch account in another tab), so the wizard shows the connect card.
function clearIfNotConnected(state: GithubState, error: AppErrorJson | undefined) {
  if (error?.causeCode === ERROR_CODE.conflict) clearAccount(state)
}

const githubSlice = createSlice({
  name: 'github',
  initialState: initialGithubState,
  reducers: {
    githubDisconnected: clearAccount,
    repoCleared: (state) => {
      state.selectedRepoId = null
      clearFile(state)
      state.fileStatus = 'idle'
    },
    githubReset: () => initialGithubState,
    importProgressed: (state, action: PayloadAction<{ done: number; total: number }>) => {
      state.importProgress = action.payload
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(connectGithub.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(connectGithub.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.account = action.payload.account
        state.repoList = action.payload.repoList.items
        state.repoTruncated = action.payload.repoList.truncated
        state.repoStatus = 'succeeded'
      })
      .addCase(connectGithub.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? null
      })
      .addCase(searchRepo.pending, (state, action) => {
        state.repoStatus = 'loading'
        state.latestSearchId = action.meta.requestId
      })
      .addCase(searchRepo.fulfilled, (state, action) => {
        // Only the newest search wins when responses arrive out of order.
        if (state.latestSearchId !== action.meta.requestId) return
        state.repoStatus = 'succeeded'
        state.repoList = action.payload.items
        state.repoTruncated = action.payload.truncated
      })
      .addCase(searchRepo.rejected, (state, action) => {
        if (state.latestSearchId !== action.meta.requestId) return
        state.repoStatus = 'failed'
        state.error = action.payload ?? null
        clearIfNotConnected(state, action.payload)
      })
      .addCase(selectRepo.pending, (state, action) => {
        state.selectedRepoId = action.meta.arg
        clearFile(state)
        state.fileStatus = 'loading'
      })
      .addCase(selectRepo.fulfilled, (state, action) => {
        if (state.selectedRepoId !== action.meta.arg) return
        state.fileStatus = 'succeeded'
        state.fileList = action.payload.items
        state.fileTruncated = action.payload.truncated
      })
      .addCase(selectRepo.rejected, (state, action) => {
        if (state.selectedRepoId !== action.meta.arg) return
        state.fileStatus = 'failed'
        state.error = action.payload ?? null
        clearIfNotConnected(state, action.payload)
      })
      .addCase(disconnectGithub.pending, (state) => {
        state.disconnectStatus = 'loading'
      })
      .addCase(disconnectGithub.fulfilled, (state) => {
        state.disconnectStatus = 'succeeded'
        clearAccount(state)
      })
      .addCase(disconnectGithub.rejected, (state, action) => {
        state.disconnectStatus = 'failed'
        state.error = action.payload ?? null
      })
      .addCase(importGithubFile.pending, (state) => {
        state.importStatus = 'loading'
      })
      .addCase(importGithubFile.fulfilled, (state) => {
        state.importStatus = 'succeeded'
      })
      .addCase(importGithubFile.rejected, (state, action) => {
        state.importStatus = 'failed'
        state.error = action.payload ?? null
        clearIfNotConnected(state, action.payload)
      })
      .addCase(importGithubFileList.pending, (state, action) => {
        state.importStatus = 'loading'
        state.importProgress = { done: 0, total: action.meta.arg.fileList.length }
      })
      .addCase(importGithubFileList.fulfilled, (state) => {
        state.importStatus = 'succeeded'
        state.importProgress = null
      })
      .addCase(importGithubFileList.rejected, (state, action) => {
        state.importStatus = 'failed'
        state.importProgress = null
        state.error = action.payload ?? null
        clearIfNotConnected(state, action.payload)
      })
      .addCase(importGithubLink.pending, (state) => {
        state.linkImportStatus = 'loading'
      })
      .addCase(importGithubLink.fulfilled, (state) => {
        state.linkImportStatus = 'succeeded'
      })
      .addCase(importGithubLink.rejected, (state, action) => {
        state.linkImportStatus = 'failed'
        state.error = action.payload ?? null
      })
  }
})

export const { githubDisconnected, repoCleared, githubReset, importProgressed } = githubSlice.actions
export const githubReducer = githubSlice.reducer

export const selectGithub = (state: RootState) => state.github
