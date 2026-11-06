import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, Pencil, Play, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import AiNotice from '../components/AiNotice'
import ConfirmDialog from '../components/ConfirmDialog'
import FileDraftList from '../components/FileDraftList'
import Loader from '../components/Loader'
import ReviewStatusBar from '../components/ReviewStatusBar'
import ReviewTabs from '../components/ReviewTabs'
import { useSettings } from '../lib/useSettings'
import { failureReasonOf, normalizeReviewName, Review, REVIEW_STATUS, reviewNameMaxLength } from '../models/review.model'
import type { NewReviewDto } from '../models/dto'
import { hasUnsavedFileDraft, isUnsavedFileDraft, type FileDraftDto } from '../models/import-session.model'
import { openFileDraftOf, useLeaveGuard } from '../lib/importSession'
import { useFileListOpen } from '../lib/fileListOpen'
import { autoLanguage } from '../lib/settings.constants'
import {
  FILE_DRAFT_TEXT,
  languageList,
  NEW_REVIEW_TITLE,
  NOT_ANALYZED_TEXT,
  FAILURE_TEXT,
  REVIEW_LIMIT,
  REVIEW_POLL_BACKOFF_FACTOR,
  REVIEW_POLL_INTERVAL_MS,
  REVIEW_POLL_MAX_DURATION_MS,
  REVIEW_POLL_MAX_FAILURE,
  REVIEW_POLL_MAX_INTERVAL_MS,
  REVIEW_POLL_RETRY_MS,
  REVIEW_TEXT
} from '../lib/review.constants'
import { useMounted } from '../lib/useMounted'
import type { CodeFile } from '../lib/codeFile'
import { canRunReview, hasUnanalyzedChange, isSavedFindingStale, needsChangeToRunAgain } from '../lib/reviewRun'
import { NEW_REVIEW_ID, ROUTE_PATH } from '../lib/route.constants'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  createReview,
  downloadReport,
  draftCleared,
  fetchReview,
  importFileEdited,
  importFileReviewed,
  importFileSelected,
  runReview,
  saveReview,
  selectCurrentReview,
  selectCurrentReviewStatus,
  selectImportSession,
  selectReviewDraft
} from '../store/review.slice'
import type { ReviewDto, SavedReview } from '../types'
import { toLf, truncate } from '../services/util.service'
import { ERROR_MESSAGE, FORM_ERROR_MESSAGE, PAGE_ERROR_MESSAGE } from '../utils/error-messages'

// What /review/new shows before it is saved: the draft (an imported file) or an empty editor,
// with empty result tabs. There is no backend record until Save creates it.
function blankReview(draft: NewReviewDto | null, language: string): ReviewDto {
  return {
    title: draft?.title || NEW_REVIEW_TITLE,
    status: REVIEW_STATUS.pending,
    language: draft?.language ?? language,
    analyzedAgo: NOT_ANALYZED_TEXT,
    qualityScore: 0,
    content: draft?.content ?? '',
    findingCount: [],
    finding: [],
    suggestion: [],
    generatedTest: []
  }
}

// The primary action: Run review.
const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-primary-darker bg-primary-dark px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-primary-darker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"

// The Summary editor's findings while they are stale: one list, so the marker effect does not rerun.
const noFinding: ReviewDto['finding'] = []

type ViewProps = {
  id: string
  review: ReviewDto
  saved: SavedReview | null
  isNew?: boolean
  // The page stopped checking an unfinished review; `onResumePoll` starts again.
  pollStopped?: boolean
  onResumePoll?: () => void
  // An existing review: the code and language its findings belong to (Run review is enabled
  // when the editor differs from them), and what to do once a run started (resume polling).
  analyzedContent?: string
  analyzedLanguage?: string
  onRunStarted?: () => void
  // Plan 034, a file draft of an import session: the editor title (its path), every change of
  // its code or language (kept in the session), and the review Run review created for it.
  initialFileName?: string
  onDraftChange?: (code: string, language: string) => void
  onCreated?: (reviewId: string) => void
}

function ReviewView({
  id,
  review,
  saved,
  isNew = false,
  pollStopped = false,
  onResumePoll,
  analyzedContent = review.content,
  analyzedLanguage = review.language,
  onRunStarted,
  initialFileName,
  onDraftChange,
  onCreated
}: ViewProps) {
  const { settings } = useSettings()
  const failureReason = isNew ? null : failureReasonOf(review)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [language, setLanguage] = useState(
    saved?.language ?? (settings.language === autoLanguage || isNew ? review.language : settings.language)
  )
  const [code, setCode] = useState(saved?.code ?? review.content)
  // The name of the last uploaded or dropped file, shown as the editor title (plan 021).
  const [fileName, setFileName] = useState<string | null>(initialFileName ?? null)
  // True once an upload replaced the reviewed code (QA rounds 2 and 3, D4 and D5): the findings
  // belong to the old code, so the editor marks none. A plain flag kept here, not in CodeEditor, so
  // it survives the Summary tab unmounting and any store update (Regenerate, polls, refetches).
  // Only a new analysis of the current code clears it: Run review (on /review/new, or on an
  // existing review, plan 021 revision 1). Save review only stores the edit (PUT /api/review/{id}
  // does not re-analyze), so it keeps the flag.
  // Plan 025: a saved edit that no longer matches the analyzed code (Save review, then a reload)
  // is stale from the first render, so the old findings never mark the new code.
  const [findingStale, setFindingStale] = useState(() => !isNew && isSavedFindingStale(saved, { analyzedContent, analyzedLanguage }))
  // When a new analysis arrives (a run started or finished, also after a reload during a run), the
  // flag is worked out again: stale while the saved edit differs from it, and an upload stays stale
  // until the analysis matches the editor code.
  const analyzedKey = `${analyzedLanguage}\n${analyzedContent}`
  const [staleCheckedFor, setStaleCheckedFor] = useState(analyzedKey)
  if (staleCheckedFor !== analyzedKey) {
    setStaleCheckedFor(analyzedKey)
    const analyzed = { analyzedContent, analyzedLanguage }
    setFindingStale(isSavedFindingStale(saved, analyzed) || (findingStale && hasUnanalyzedChange({ code, language, ...analyzed })))
  }
  const [name, setName] = useState(saved?.name ?? review.title)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const nameDone = useRef(false)
  const mounted = useMounted()
  // A file draft keeps its edits in the import session, so switching files never loses them.
  useEffect(() => {
    onDraftChange?.(code, language)
  }, [code, language, onDraftChange])
  // Line breaks are sent as LF, so a Windows CR LF is counted (and sent) as one character.
  const sentCode = toLf(code)
  const tooLong = sentCode.length > REVIEW_LIMIT.contentMax
  const runEnabled =
    !isNew && canRunReview({ code, language, analyzedContent, analyzedLanguage, status: review.status, busy: saving || running })
  // Plan 025 (1A): a failed or cancelled review is run again only after an edit or an upload.
  const showRunAgainHint = !isNew && needsChangeToRunAgain({ code, language, analyzedContent, analyzedLanguage, status: review.status })

  const startEditName = () => {
    nameDone.current = false
    setDraftName(name)
    setEditingName(true)
  }

  // Enter and blur commit, Escape cancels. An empty or too long name keeps the previous one.
  const finishEditName = (commit: boolean) => {
    if (nameDone.current) return
    nameDone.current = true
    const next = commit ? normalizeReviewName(draftName) : undefined
    if (next) setName(next)
    setEditingName(false)
  }

  // A new review is created first (POST /api/review), then its edit is saved, and the page moves
  // to the created review, which is fetched again until the analysis finishes. Failures are
  // reported by the store as error toasts (Review failed preference).
  // A user who left the page while it saved stays where they went (no navigation after unmount).
  const saveNew = async () => {
    const created = await dispatch(createReview({ title: name, language, content: sentCode }))
    if (!createReview.fulfilled.match(created)) return
    // A new analysis of the current code started (the page then moves to the created review).
    setFindingStale(false)
    const createdId = created.payload.id
    const result = await dispatch(saveReview({ id: createdId, name, language, code: sentCode }))
    dispatch(draftCleared())
    if (saveReview.fulfilled.match(result)) toast.success(REVIEW_TEXT.started)
    // A file draft is linked to its review only now, in the same step as the navigation: linked
    // earlier, /review/new would open the next draft and unmount this view before it navigates.
    const stayed = mounted.current
    if (stayed) navigate(ROUTE_PATH.review(createdId), { replace: !onCreated })
    onCreated?.(createdId)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isNew) {
        await saveNew()
        return
      }
      const result = await dispatch(saveReview({ id, name, language, code: sentCode }))
      if (saveReview.fulfilled.match(result)) toast.success(REVIEW_TEXT.saved)
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  // Run review on an existing review: saves the edit and re-analyzes the same id (POST
  // /api/review/{id}/run). The review becomes pending, the polling restarts, and the new findings
  // mark the code. Failures are reported by the store (Review failed preference).
  const handleRun = async () => {
    setRunning(true)
    try {
      const result = await dispatch(runReview({ id, name, language, code: sentCode }))
      if (!runReview.fulfilled.match(result)) return
      toast.success(REVIEW_TEXT.started)
      if (!mounted.current) return
      setFindingStale(false)
      onRunStarted?.()
    } finally {
      if (mounted.current) setRunning(false)
    }
  }

  // An uploaded file replaces the code (no confirmation, plan 021 Open Question 1) and selects
  // the language of its extension.
  const handleFileLoad = (file: CodeFile) => {
    setCode(file.content)
    setLanguage(file.language)
    setFileName(file.fileName)
    setFindingStale(true)
  }

  const handleDownload = () => {
    dispatch(downloadReport({ id, review: { ...review, title: name }, language }))
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-(--page-padding) lg:overflow-hidden">
      <header className="mb-6 flex shrink-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 md:flex-1">
          <div className="flex min-w-0 items-center gap-x-3">
          <h1 className="shrink-0 whitespace-nowrap text-xl font-semibold">Review Results</h1>
          <div className="flex min-h-8 min-w-0 flex-1 items-center gap-2">
            {editingName ? (
              <input
                aria-label="Review name"
                autoFocus
                maxLength={reviewNameMaxLength}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => finishEditName(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') finishEditName(true)
                  if (event.key === 'Escape') finishEditName(false)
                }}
                className="w-64 max-w-full rounded-md border border-input-border bg-card px-2 py-1 text-sm font-medium"
              />
            ) : (
              <>
                <p data-testid="review-name" title={name} className="min-w-0 truncate text-sm font-medium">
                  {name}
                </p>
                <button
                  type="button"
                  aria-label="Edit review name"
                  onClick={startEditName}
                  className="shrink-0 rounded-md p-1 text-text-muted hover:bg-page-bg hover:text-primary"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
          </div>
          <p className="text-sm text-text-muted">Here are the results of your code analysis.</p>
          {pollStopped && (
            <p role="status" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              {REVIEW_TEXT.pollStopped}
              <button
                type="button"
                onClick={onResumePoll}
                className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
              >
                <RefreshCw size={14} aria-hidden="true" />
                {REVIEW_TEXT.pollResume}
              </button>
            </p>
          )}
          {failureReason && (
            <p role="alert" data-testid="failure-reason" className="text-sm text-danger">
              {FAILURE_TEXT[failureReason]}
            </p>
          )}
          {tooLong && (
            <p role="alert" className="text-sm text-danger">
              {FORM_ERROR_MESSAGE.codeTooLong(REVIEW_LIMIT.contentMax, sentCode.length)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1 md:items-end">
        <div className="flex flex-wrap gap-2 md:flex-nowrap">
          {isNew ? (
            <button type="button" onClick={handleSave} disabled={saving || tooLong || !code.trim()} className={primaryButtonClass}>
              <Play size={16} aria-hidden="true" />
              {REVIEW_TEXT.runButton}
            </button>
          ) : (
            <>
              {/* Plan 021 revision 1: re-analyze this review in place when the code or language changed. */}
              <button type="button" onClick={handleRun} disabled={!runEnabled} className={primaryButtonClass}>
                <Play size={16} aria-hidden="true" />
                {REVIEW_TEXT.runButton}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || running || tooLong}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-text shadow-card hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={16} aria-hidden="true" />
                {REVIEW_TEXT.saveButton}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={isNew}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download size={16} aria-hidden="true" />
            Download report
          </button>
        </div>
        <AiNotice />
        {showRunAgainHint && (
          <p data-testid="run-again-hint" className="text-sm text-text-muted">
            {REVIEW_TEXT.runAgainHint}
          </p>
        )}
        </div>
      </header>
      {/* Plan 029 revision 3: below md the tabs (with the editor) come before the status cards, so
          the editor and its scrollbar are on the first screen; from md up the order is unchanged. */}
      <div className="flex flex-1 flex-col-reverse justify-end gap-6 md:flex-col md:justify-start lg:min-h-0">
        <ReviewStatusBar
          status={review.status}
          language={language}
          analyzedAgo={review.analyzedAgo}
          qualityScore={review.qualityScore}
        />
        <ReviewTabs
          reviewId={id}
          review={review}
          code={code}
          onCodeChange={setCode}
          language={language}
          languageList={languageList}
          onLanguageChange={setLanguage}
          onFileLoad={handleFileLoad}
          fileName={fileName}
          editorFinding={findingStale ? noFinding : review.finding}
          isNew={isNew}
        />
      </div>
    </main>
  )
}

function ReviewMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-(--page-padding)">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-text-muted">{detail}</p>
      <Link to={ROUTE_PATH.history} className="text-sm font-medium text-primary hover:text-primary-hover">
        Back to Review History
      </Link>
    </main>
  )
}

// Plan 034: one file draft of the import session, as a new review. Keyed by the file, so switching
// files opens each one's own code, language and edits (kept in the session as they change). Run
// review creates this file's own review; the other files stay drafts.
function FileDraftReview({ file }: { file: FileDraftDto }) {
  const dispatch = useAppDispatch()
  const [review] = useState(() => blankReview({ title: truncate(file.path, reviewNameMaxLength), language: file.language, content: file.code }, file.language))
  const key = file.key
  const handleDraftChange = useCallback(
    (code: string, language: string) => {
      dispatch(importFileEdited({ key, code, language }))
    },
    [dispatch, key]
  )
  const handleCreated = useCallback(
    (reviewId: string) => {
      dispatch(importFileReviewed({ key, reviewId }))
    },
    [dispatch, key]
  )
  return (
    <ReviewView
      id={NEW_REVIEW_ID}
      review={review}
      saved={null}
      isNew
      initialFileName={file.path}
      onDraftChange={handleDraftChange}
      onCreated={handleCreated}
    />
  )
}

// /review/new: never fetched (there is no backend record for `new`).
function NewReviewPage() {
  const session = useAppSelector(selectImportSession)
  const file = openFileDraftOf(session)
  if (file) return <FileDraftReview key={file.key} file={file} />
  return <BlankReviewPage />
}

// /review/new without an import session: an imported file (the draft) or an empty editor.
function BlankReviewPage() {
  const draft = useAppSelector(selectReviewDraft)
  const { settings } = useSettings()
  const language = settings.language === autoLanguage ? languageList[0] : settings.language
  // The draft is read once; from then on the editor owns the content.
  const [review] = useState(() => blankReview(draft, language))
  const dispatch = useAppDispatch()
  // Leaving the page drops the draft, so the next New Review starts blank.
  useEffect(() => () => {
    dispatch(draftCleared())
  }, [dispatch])
  return <ReviewView id={NEW_REVIEW_ID} review={review} saved={null} isNew />
}

function SavedReviewPage({ id }: { id: string }) {
  const dispatch = useAppDispatch()
  const current = useAppSelector(selectCurrentReview)
  const status = useAppSelector(selectCurrentReviewStatus)
  const shown = current?.id === id ? current.review : null
  const unfinished = shown !== null && !new Review(shown).isFinished
  // Polling state, kept in refs so a render never restarts the timing:
  // - `failure`: failed polls in a row; the next poll waits REVIEW_POLL_RETRY_MS and polling stops
  //   at REVIEW_POLL_MAX_FAILURE. Any answer resets it. `retry` re-arms the poll after a failure.
  // - `step`: answers in a row with the same status; the wait grows with it (backoff).
  // - `unchangedSince`: when the status last changed; polling stops after REVIEW_POLL_MAX_DURATION_MS.
  // A stopped poll shows a hint with Check again (no toast), which starts over.
  const failure = useRef(0)
  const step = useRef(0)
  const unchangedSince = useRef(Date.now())
  const lastShown = useRef<ReviewDto | null>(null)
  const [retry, setRetry] = useState(0)
  const [pollStopped, setPollStopped] = useState(false)

  const resumePoll = () => {
    failure.current = 0
    step.current = 0
    unchangedSince.current = Date.now()
    setPollStopped(false)
  }

  // Leaving the review (or opening another id) cancels its request, so a late answer can
  // never replace the review on screen or raise a toast.
  useEffect(() => {
    const request = dispatch(fetchReview(id))
    return () => request.abort()
  }, [dispatch, id])

  // While the analysis runs (pending, queued, in progress) the review is fetched again after
  // each answer, until it is completed, failed or cancelled.
  useEffect(() => {
    // A new answer: a changed status starts the backoff over, the same status makes it grow.
    if (shown && shown !== lastShown.current) {
      if (shown.status !== lastShown.current?.status) {
        step.current = 0
        unchangedSince.current = Date.now()
      } else {
        step.current += 1
      }
      failure.current = 0
      lastShown.current = shown
    }
    if (!unfinished || pollStopped) return
    if (failure.current >= REVIEW_POLL_MAX_FAILURE || Date.now() - unchangedSince.current >= REVIEW_POLL_MAX_DURATION_MS) {
      setPollStopped(true)
      return
    }
    const wait =
      failure.current > 0
        ? REVIEW_POLL_RETRY_MS
        : Math.min(REVIEW_POLL_INTERVAL_MS * REVIEW_POLL_BACKOFF_FACTOR ** step.current, REVIEW_POLL_MAX_INTERVAL_MS)
    let request: { abort: () => void } | undefined
    let active = true
    const timer = setTimeout(
      async () => {
        // Background work (plan 037): the poll never shows the global loader.
        const pending = dispatch(fetchReview({ id, background: true }))
        request = pending
        const result = await pending
        // An answer re-renders the page with a new `shown`, which runs this effect again.
        if (fetchReview.fulfilled.match(result) || !active || result.meta.aborted) return
        failure.current += 1
        setRetry((value) => value + 1)
      },
      wait
    )
    return () => {
      active = false
      clearTimeout(timer)
      request?.abort()
    }
  }, [dispatch, id, unfinished, shown, retry, pollStopped])

  if (current?.id !== id) {
    if (status === 'failed') return <ReviewMessage title={PAGE_ERROR_MESSAGE.reviewUnavailable} detail={ERROR_MESSAGE.reviewLoad} />
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center p-(--page-padding)">
        <Loader label={REVIEW_TEXT.loading} size="lg" />
      </main>
    )
  }

  if (!current.review) return <ReviewMessage title={PAGE_ERROR_MESSAGE.reviewNotFound} detail={PAGE_ERROR_MESSAGE.reviewNotFoundDetail} />

  return (
    <ReviewView
      key={id}
      id={id}
      review={current.review}
      saved={current.saved}
      pollStopped={pollStopped && unfinished}
      onResumePoll={resumePoll}
      analyzedContent={current.analyzedContent}
      analyzedLanguage={current.analyzedLanguage}
      onRunStarted={resumePoll}
    />
  )
}

// Plan 034: while an import session is open, its file list is shown beside the page (above it on
// phones), on /review/new and on the review of each of its files. Selecting a file without a
// review opens its draft; a file with a review opens that review. Leaving by any in-app link while
// files without a review remain asks first (they live in memory only).
function ImportSessionFrame({ reviewId, children }: { reviewId: string; children: ReactNode }) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const session = useAppSelector(selectImportSession)
  const isNew = reviewId === NEW_REVIEW_ID
  const ownFile = session?.fileList.find((file) => file.reviewId === reviewId)
  const shown = session !== null && (isNew || ownFile !== undefined)
  const guard = useLeaveGuard(shown && hasUnsavedFileDraft(session))
  // Plan 038: open or closed, remembered in this browser (lib/fileListOpen.ts).
  const [listOpen, toggleList] = useFileListOpen()
  if (!shown || !session) return children

  const selectedKey = isNew ? (openFileDraftOf(session)?.key ?? null) : (ownFile?.key ?? null)

  function select(file: FileDraftDto) {
    if (file.reviewId) {
      dispatch(importFileSelected(file.key))
      if (file.reviewId !== reviewId) navigate(ROUTE_PATH.review(file.reviewId))
      return
    }
    if (!isUnsavedFileDraft(file)) return
    dispatch(importFileSelected(file.key))
    if (!isNew) navigate(ROUTE_PATH.newReview)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <FileDraftList session={session} selectedKey={selectedKey} onSelect={select} open={listOpen} onToggle={toggleList} />
      {children}
      <ConfirmDialog
        open={guard.target !== null}
        title={FILE_DRAFT_TEXT.leaveTitle}
        detail={FILE_DRAFT_TEXT.leaveDetail}
        confirmLabel={FILE_DRAFT_TEXT.leaveConfirm}
        cancelLabel={FILE_DRAFT_TEXT.stay}
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </div>
  )
}

export default function ReviewPage() {
  const { id = NEW_REVIEW_ID } = useParams()
  return (
    <ImportSessionFrame reviewId={id}>
      {id === NEW_REVIEW_ID ? <NewReviewPage /> : <SavedReviewPage key={id} id={id} />}
    </ImportSessionFrame>
  )
}
