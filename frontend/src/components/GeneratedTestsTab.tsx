import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { frameworkList, REVIEW_PLACEHOLDER_TAB, REVIEW_TEXT, TEST_CONFIG_TEXT, testTypeList } from '../lib/review.constants'
import { REVIEW_STATUS } from '../models/review.model'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { regenerateTest, selectRegenerateStatus, selectTestConfig, testConfigChanged } from '../store/review.slice'
import type { GeneratedTestFile, ReviewStatus, TestFramework, TestTypeId } from '../types'
import CodeEditor from './CodeEditor'
import CopyButton from './CopyButton'
import TabPlaceholder from './TabPlaceholder'
import TestConfigPanel from './TestConfigPanel'

type Props = {
  reviewId: string
  // Regenerate is offered only for a completed review (the backend answers 409 otherwise).
  status: ReviewStatus
  // /review/new before Run review (picks the placeholder text).
  isNew?: boolean
  fileList: GeneratedTestFile[]
}

const testTypeHintId = 'test-type-required'

// Regenerate asks the server for new tests (POST /api/review/{id}/generated-test); the store
// replaces the files, so the editor shows the new code. A failure is an error toast (store).
// Plan 034 (Open Question 4): Framework and Test Type come from the store (the review's stored
// `testConfig`, or the choice not sent yet), so switching tabs, reloading or reopening the review
// keeps them; Regenerate sends a changed choice and the server stores it with the review. At least one
// test type is needed: without one Regenerate is off and a hint says why.
export default function GeneratedTestsTab({ reviewId, status, isNew = false, fileList }: Props) {
  const dispatch = useAppDispatch()
  const loading = useAppSelector(selectRegenerateStatus) === 'loading'
  const testConfig = useAppSelector((state) => selectTestConfig(state, reviewId))
  // The user's choice not sent yet; without one Regenerate sends no body, so the server uses the
  // stored configuration (and a review without one regenerates exactly as before 0.13.0).
  const changedConfig = useAppSelector((state) => state.review.testConfigById[reviewId])
  const [activeFileId, setActiveFileId] = useState(fileList[0]?.id ?? '')

  const canRegenerate = status === REVIEW_STATUS.completed
  const noTestType = testConfig.testTypeIdList.length === 0
  const activeFile = fileList.find((file) => file.id === activeFileId) ?? fileList[0]
  // No file yet: the placeholder, never an empty tab.
  if (!activeFile) return <TabPlaceholder tab={REVIEW_PLACEHOLDER_TAB.generatedTest} status={status} isNew={isNew} />

  const copyAllText = fileList.map((file) => `// ---- ${file.testFile} ----\n${file.code}`).join('\n')

  function changeFramework(framework: TestFramework) {
    dispatch(testConfigChanged({ id: reviewId, testConfig: { ...testConfig, framework } }))
  }

  function toggleType(id: TestTypeId) {
    const current = testConfig.testTypeIdList
    const testTypeIdList = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    dispatch(testConfigChanged({ id: reviewId, testConfig: { ...testConfig, testTypeIdList } }))
  }

  async function handleRegenerate() {
    if (noTestType) return
    const result = await dispatch(regenerateTest(changedConfig ? { id: reviewId, testConfig: changedConfig } : reviewId))
    if (regenerateTest.fulfilled.match(result)) toast.success(REVIEW_TEXT.regenerated)
  }

  return (
    <div className="flex flex-col gap-4 lg:h-full">
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
        {!canRegenerate && <p className="text-xs text-text-muted">{REVIEW_TEXT.regenerateLater}</p>}
        {canRegenerate && noTestType && (
          <p id={testTypeHintId} role="status" className="text-xs text-error-text">
            {TEST_CONFIG_TEXT.testTypeRequired}
          </p>
        )}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={loading || !canRegenerate || noTestType}
          aria-describedby={noTestType ? testTypeHintId : undefined}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-primary hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          {loading ? REVIEW_TEXT.regenerating : REVIEW_TEXT.regenerate}
        </button>
      </div>
      {/* Plan 029 revision 3: below md the column is reversed, so the editor and its scrollbar come
          first, on the first screen; from md up the layout is unchanged. */}
      <div className="flex flex-col-reverse items-stretch gap-4 md:flex-col lg:min-h-96 lg:flex-1 lg:flex-row">
        <TestConfigPanel
          frameworkList={frameworkList}
          framework={testConfig.framework}
          onFrameworkChange={changeFramework}
          testTypeList={testTypeList}
          selectedTypeIdList={testConfig.testTypeIdList}
          onTypeToggle={toggleType}
          fileList={fileList}
          activeFileId={activeFile.id}
          onFileSelect={setActiveFileId}
          copyAllText={copyAllText}
        />
        <CodeEditor
          value={activeFile.code}
          language={activeFile.language}
          title={activeFile.repo ? activeFile.testFile : 'Generated tests'}
          action={<CopyButton text={activeFile.code} />}
        />
      </div>
    </div>
  )
}
