import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { AppError, type AppErrorJson } from '../models/app-error'
import type {
  AnalyzerKind,
  GeneratedTestFileDto,
  NewReviewDto,
  ReviewDetailDto,
  ReviewDto,
  ReviewStatus,
  ReviewSummaryDto,
  SaveReviewDto,
  TestConfigDto
} from '../models/dto'
import {
  failedFileDraftOf,
  fileDraftOf,
  importSessionOf,
  skippedFileDraftOf,
  type FileDraftDto,
  type ImportSessionDto
} from '../models/import-session.model'
import { orderedTestTypeIdList, Review, ReviewSummary, reviewNameMaxLength, testConfigOf } from '../models/review.model'
import { truncate } from '../services/util.service'
import { ERROR_CODE } from '../utils/error-messages'
import { importGithubFile, importGithubFileList, importGithubLink } from './github.slice'
import { attempt, createAppAsyncThunk, type AsyncStatus } from './thunk'
import type { RootState } from './index'

export interface ReviewState {
  list: ReviewSummaryDto[]
  status: AsyncStatus
  error: AppErrorJson | null
  // The review shown on the Review page; `review` is null when the id does not exist.
  // `analyzedContent` / `analyzedLanguage`: the code and language the findings belong to (empty
  // when there is no review).
  current: (Omit<ReviewDetailDto, 'review'> & { review: ReviewDto | null }) | null
  // Run review on an existing review (plan 021 revision 1).
  runStatus: AsyncStatus
  currentStatus: AsyncStatus
  currentError: AppErrorJson | null
  // requestId of the newest fetchReview; older responses (the user moved on) are ignored.
  currentRequestId: string | null
  // What /review/new opens with: an imported GitHub file, or null for a blank review.
  draft: NewReviewDto | null
  // Generated Tests "Regenerate" of the current review.
  regenerateStatus: AsyncStatus
  // Plan 034: the Framework and Test Type the user picked on a review's Generated Tests tab and
  // has not sent yet (Regenerate sends and stores them), by review id. Kept here, not in the tab,
  // so switching tabs keeps them; the stored choice is the review's own `testConfig`.
  testConfigById: Record<string, TestConfigDto>
  // Plan 034: several imported files (the wizard or a pull-request link), each its own file
  // draft, in memory only. Null when none, or when one file was imported (then `draft`).
  importSession: ImportSessionDto | null
  // Plan 039: which analyzer reviews use (GET /api/health); null until known, or when it could
  // not be read (then no AI notice and no stub note is shown).
  analyzer: AnalyzerKind | null
}

export const initialReviewState: ReviewState = {
  list: [],
  status: 'idle',
  error: null,
  current: null,
  currentStatus: 'idle',
  currentError: null,
  currentRequestId: null,
  draft: null,
  regenerateStatus: 'idle',
  runStatus: 'idle',
  testConfigById: {},
  importSession: null,
  analyzer: null
}

export const fetchReviewList = createAppAsyncThunk('review/fetchList', (_: void, { extra, rejectWithValue, signal }) =>
  attempt(ERROR_CODE.reviewLoad, rejectWithValue, () => extra.review.list({ signal }))
)

// A review id, or (plan 037) the review status poll's `{ id, background: true }`, which loads the
// same review without showing the global loader.
export type FetchReviewArg = string | { id: string; background?: boolean }

export function reviewIdOf(arg: FetchReviewArg): string {
  return typeof arg === 'string' ? arg : arg.id
}

// The caller aborts it when the route id changes (ReviewPage); the signal reaches fetch.
export const fetchReview = createAppAsyncThunk('review/fetch', (arg: FetchReviewArg, { extra, rejectWithValue, signal }) =>
  attempt(ERROR_CODE.reviewLoad, rejectWithValue, () =>
    extra.review.get(reviewIdOf(arg), { signal, background: typeof arg === 'string' ? undefined : arg.background })
  )
)

// Plan 039: reads the analyzer once. A failure is silent (it only decides which notice shows),
// so this thunk never rejects.
// It runs only while the analyzer is unknown.
export const fetchAnalyzer = createAppAsyncThunk(
  'review/fetchAnalyzer',
  async (_: void, { extra }): Promise<AnalyzerKind | null> => {
    try {
      return await extra.review.analyzer()
    } catch {
      return null
    }
  },
  { condition: (_, { getState }) => getState().review.analyzer === null }
)

export const createReview = createAppAsyncThunk('review/create', (input: NewReviewDto, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.reviewCreate, rejectWithValue, () => extra.review.create(input))
)

export const saveReview = createAppAsyncThunk(
  'review/save',
  ({ id, ...input }: SaveReviewDto & { id: string }, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.reviewSave, rejectWithValue, () => extra.review.save(id, input))
)

// Run review on an existing review: saves the edit and re-analyzes the same id (POST
// /api/review/{id}/run). Resolves with the review in status pending; the page then polls it.
export const runReview = createAppAsyncThunk(
  'review/run',
  ({ id, ...input }: SaveReviewDto & { id: string }, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.reviewRun, rejectWithValue, () => extra.review.run(id, input))
)

export const renameReview = createAppAsyncThunk(
  'review/rename',
  ({ id, name }: { id: string; name: string }, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.reviewRename, rejectWithValue, () => extra.review.rename(id, name))
)

export const deleteReview = createAppAsyncThunk('review/delete', (id: string, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.reviewDelete, rejectWithValue, () => extra.review.delete(id))
)

// Plan 034: the test configuration to generate with (sent and stored with the review). A bare id
// regenerates with the review's stored configuration.
export interface RegenerateTestInput {
  id: string
  testConfig?: TestConfigDto
}

function regenerateInputOf(input: string | RegenerateTestInput): RegenerateTestInput {
  return typeof input === 'string' ? { id: input } : input
}

export const regenerateTest = createAppAsyncThunk('review/regenerateTest', (input: string | RegenerateTestInput, { extra, rejectWithValue }) => {
  const { id, testConfig } = regenerateInputOf(input)
  return attempt(ERROR_CODE.testRegenerate, rejectWithValue, () => extra.review.regenerateTest(id, testConfig))
})

export const downloadReport = createAppAsyncThunk(
  'review/downloadReport',
  ({ id, review, language }: { id: string; review: ReviewDto; language: string }, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.reportPdf, rejectWithValue, () => extra.report.download(id, review, language))
)

function renameInList(list: ReviewSummaryDto[], id: string, name: string | undefined) {
  const row = list.find((item) => item.id === id)
  if (row && name) row.title = name
}

function replaceGeneratedTest(state: ReviewState, id: string, fileList: GeneratedTestFileDto[], testConfig?: TestConfigDto) {
  if (state.current?.id === id && state.current.review) {
    state.current.review.generatedTest = fileList
    if (testConfig) state.current.review.testConfig = testConfig
  }
  if (testConfig) delete state.testConfigById[id]
}

// The file drafts of an import session keep the last known status of their review.
function syncFileReviewStatus(state: ReviewState, id: string, status: ReviewStatus) {
  const file = state.importSession?.fileList.find((item) => item.reviewId === id)
  if (file) file.reviewStatus = status
}

function findFileDraft(state: ReviewState, key: string): FileDraftDto | undefined {
  return state.importSession?.fileList.find((item) => item.key === key)
}

const reviewSlice = createSlice({
  name: 'review',
  initialState: initialReviewState,
  reducers: {
    // A new review was created from the draft, or the user opened a blank one.
    draftCleared: (state) => {
      state.draft = null
    },
    // Plan 034: a Framework or Test Type change on a review's Generated Tests tab (not sent yet).
    testConfigChanged: (state, action: PayloadAction<{ id: string; testConfig: TestConfigDto }>) => {
      const { id, testConfig } = action.payload
      state.testConfigById[id] = { framework: testConfig.framework, testTypeIdList: orderedTestTypeIdList(testConfig.testTypeIdList) }
    },
    // Plan 034, the import session: open a file draft, keep its edits, link it to the review Run
    // review created for it, and forget the whole session (the user left the review pages).
    importFileSelected: (state, action: PayloadAction<string>) => {
      const file = findFileDraft(state, action.payload)
      if (state.importSession && file?.status === 'draft') state.importSession.selectedKey = file.key
    },
    importFileEdited: (state, action: PayloadAction<{ key: string; code: string; language: string }>) => {
      const file = findFileDraft(state, action.payload.key)
      if (!file || file.status !== 'draft') return
      file.code = action.payload.code
      file.language = action.payload.language
    },
    importFileReviewed: (state, action: PayloadAction<{ key: string; reviewId: string }>) => {
      const file = findFileDraft(state, action.payload.key)
      if (!file || file.status !== 'draft') return
      file.reviewId = action.payload.reviewId
      file.reviewStatus = 'pending'
    },
    importSessionCleared: (state) => {
      state.importSession = null
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReviewList.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchReviewList.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.list = action.payload
      })
      .addCase(fetchReviewList.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? null
      })
      .addCase(fetchReview.pending, (state, action) => {
        state.currentRequestId = action.meta.requestId
        state.currentStatus = 'loading'
        state.currentError = null
        if (state.current?.id !== reviewIdOf(action.meta.arg)) state.current = null
      })
      .addCase(fetchReview.fulfilled, (state, action) => {
        if (state.currentRequestId !== action.meta.requestId) return
        const id = reviewIdOf(action.meta.arg)
        state.currentStatus = 'succeeded'
        state.current = action.payload ?? { id, review: null, saved: null, analyzedContent: '', analyzedLanguage: '' }
        if (action.payload?.review) syncFileReviewStatus(state, id, action.payload.review.status)
      })
      .addCase(fetchReview.rejected, (state, action) => {
        if (state.currentRequestId !== action.meta.requestId || action.meta.aborted) return
        state.currentStatus = 'failed'
        state.currentError = action.payload ?? null
      })
      .addCase(createReview.fulfilled, (state, action) => {
        state.current = action.payload
        state.currentStatus = 'succeeded'
      })
      // A fetch still in flight from before the run would answer with the old results: it is
      // superseded (its answer is ignored and its failure is not reported).
      .addCase(runReview.pending, (state) => {
        state.runStatus = 'loading'
        state.currentRequestId = null
      })
      .addCase(runReview.fulfilled, (state, action) => {
        state.runStatus = 'succeeded'
        if (state.current?.id === action.meta.arg.id) state.current = action.payload
        renameInList(state.list, action.meta.arg.id, action.payload.saved?.name)
        syncFileReviewStatus(state, action.meta.arg.id, action.payload.review.status)
      })
      .addCase(runReview.rejected, (state) => {
        state.runStatus = 'failed'
      })
      .addCase(saveReview.fulfilled, (state, action) => {
        const { id } = action.meta.arg
        if (state.current?.id === id) state.current.saved = action.payload
        renameInList(state.list, id, action.payload.name)
      })
      .addCase(renameReview.fulfilled, (state, action) => {
        const { id } = action.meta.arg
        if (state.current?.id === id) state.current.saved = action.payload
        renameInList(state.list, id, action.payload.name)
      })
      .addCase(deleteReview.fulfilled, (state, action) => {
        state.list = state.list.filter((item) => item.id !== action.meta.arg)
        if (state.current?.id === action.meta.arg) state.current = null
        // A deleted review of an import session: its file is a draft again.
        const file = state.importSession?.fileList.find((item) => item.reviewId === action.meta.arg)
        if (file) {
          file.reviewId = null
          file.reviewStatus = null
        }
      })
      .addCase(fetchAnalyzer.fulfilled, (state, action) => {
        state.analyzer = action.payload
      })
      .addCase(regenerateTest.pending, (state) => {
        state.regenerateStatus = 'loading'
      })
      .addCase(regenerateTest.fulfilled, (state, action) => {
        state.regenerateStatus = 'succeeded'
        const { id, testConfig } = regenerateInputOf(action.meta.arg)
        replaceGeneratedTest(state, id, action.payload, testConfig)
      })
      .addCase(regenerateTest.rejected, (state) => {
        state.regenerateStatus = 'failed'
      })
      .addCase(importGithubFile.fulfilled, (state, action) => {
        const { path, language, content } = action.payload
        // The file path names the review; a review name has at most 80 characters.
        state.draft = { title: truncate(path, reviewNameMaxLength), language, content }
        state.importSession = null
      })
      // Plan 034: several wizard files open as an import session, the failed ones listed too.
      .addCase(importGithubFileList.fulfilled, (state, action) => {
        const { repoId, itemList } = action.payload
        const fileList = itemList.map(({ file, content, error }, index) =>
          error || content === null ? failedFileDraftOf(index, file.path, file.language, error ?? unknownFailure()) : fileDraftOf(index, file.path, file.language, content)
        )
        state.importSession = importSessionOf(repoId, fileList)
        state.draft = null
      })
      // A pasted GitHub link (plan 023): its suggested name (file name, or owner/repo#number).
      // Plan 034 (Open Question 3): a pull request with several files opens as an import session
      // with each file's own code (`fileContentList`), its skipped files listed too.
      .addCase(importGithubLink.fulfilled, (state, action) => {
        const { name, language, content, fileContentList = [], skippedList } = action.payload
        if (fileContentList.length >= 2) {
          const fileList = [
            ...fileContentList.map((file, index) => fileDraftOf(index, file.path, file.language, file.content)),
            ...skippedList.map((file, index) => skippedFileDraftOf(fileContentList.length + index, file.path, file.reason))
          ]
          state.importSession = importSessionOf(name, fileList)
          state.draft = null
          return
        }
        state.draft = { title: truncate(name, reviewNameMaxLength), language, content }
        state.importSession = null
      })
  }
})

// A failed file always carries its error; this is only the type's fallback.
function unknownFailure(): AppErrorJson {
  return new AppError({ code: ERROR_CODE.githubFileImport, kind: 'unknown' }).toJSON()
}

export const {
  draftCleared,
  testConfigChanged,
  importFileSelected,
  importFileEdited,
  importFileReviewed,
  importSessionCleared
} = reviewSlice.actions
export const reviewReducer = reviewSlice.reducer

export const selectReviewList = (state: RootState) => state.review.list
export const selectReviewListStatus = (state: RootState) => state.review.status
export const selectCurrentReview = (state: RootState) => state.review.current
export const selectCurrentReviewStatus = (state: RootState) => state.review.currentStatus
export const selectReviewDraft = (state: RootState) => state.review.draft
export const selectRegenerateStatus = (state: RootState) => state.review.regenerateStatus
export const selectAnalyzer = (state: RootState) => state.review.analyzer
export const selectImportSession = (state: RootState) => state.review.importSession

// Plan 034: the Framework and Test Type a review's Generated Tests tab shows: the user's unsent
// choice, else the review's stored configuration, else the default (Jest, every kind).
export function selectTestConfig(state: RootState, id: string): TestConfigDto {
  const changed = state.review.testConfigById[id]
  if (changed) return changed
  return testConfigOf(state.review.current?.id === id ? state.review.current.review : null)
}

// True when a fetchReview result belongs to a request that a newer one replaced.
export function isSupersededReviewRequest(state: RootState, requestId: string): boolean {
  return state.review.currentRequestId !== requestId
}

// Domain classes are built here, outside the state, so state stays plain data.
export const selectReviewSummaryList = createSelector([selectReviewList], (list) => list.map((item) => new ReviewSummary(item)))

export const selectCurrentReviewModel = createSelector([selectCurrentReview], (current) =>
  current?.review ? new Review(current.review) : null
)
