import { useState } from 'react'
import type { CodeFile } from '../lib/codeFile'
import { EDITOR_TEXT, REVIEW_PLACEHOLDER_TAB, REVIEW_TEXT } from '../lib/review.constants'
import { useSettings } from '../lib/useSettings'
import type { ReviewDto, ReviewTabId } from '../types'
import CodeEditor from './CodeEditor'
import GeneratedTestsTab from './GeneratedTestsTab'
import FindingsSummary from './FindingsSummary'
import KeyIssues from './KeyIssues'
import SuggestionList from './SuggestionList'
import TabPlaceholder from './TabPlaceholder'

type Props = {
  reviewId: string
  review: ReviewDto
  code: string
  onCodeChange: (code: string) => void
  language: string
  languageList: string[]
  onLanguageChange: (language: string) => void
  // An uploaded or dropped code file (Summary editor); its name is shown as the editor title.
  onFileLoad?: (file: CodeFile) => void
  fileName?: string | null
  // The findings marked in the Summary editor: none after an upload replaced the reviewed code.
  editorFinding?: ReviewDto['finding']
  // /review/new before Run review: the empty tabs say the review has not run yet.
  isNew?: boolean
}

export default function ReviewTabs({ reviewId, review, code, onCodeChange, language, languageList, onLanguageChange, onFileLoad, fileName, editorFinding, isNew = false }: Props) {
  const { settings } = useSettings()
  const [activeTab, setActiveTab] = useState<ReviewTabId>('summary')

  const tabList: { id: ReviewTabId; label: string }[] = ([
    { id: 'summary', label: 'Summary' },
    { id: 'findings', label: `Findings (${review.finding.length})` },
    { id: 'suggestion', label: `Suggested refactors (${review.suggestion.length})` },
    { id: 'generated_test', label: `Generated tests (${review.generatedTest.length})` }
  ] as { id: ReviewTabId; label: string }[]).filter((tab) => tab.id !== 'generated_test' || settings.generatedTest)

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <div role="tablist" className="hide-bar mb-4 flex shrink-0 gap-6 overflow-x-auto border-b border-border lg:overflow-visible">
        {tabList.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-1 pb-2 text-sm ${
              activeTab === id ? 'border-primary font-semibold text-primary' : 'border-transparent text-text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
        {activeTab === 'summary' && (
          <div data-testid="summary-layout" className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:flex-row">
            <CodeEditor
              value={code}
              readOnly={false}
              onChange={onCodeChange}
              language={language}
              languageList={languageList}
              onLanguageChange={onLanguageChange}
              onFileLoad={onFileLoad}
              title={fileName || EDITOR_TEXT.title}
              finding={editorFinding ?? review.finding}
            />
            {/* Plan 029 revision 3: below md the findings summary follows the editor (reached by
                scrolling); from md to lg it is above it, and at lg beside it, as before. */}
            <div className="flex shrink-0 flex-col gap-4 rounded-md border border-border bg-card p-3 shadow-card md:order-first lg:order-none lg:max-h-full lg:w-80 lg:overflow-y-auto">
              <FindingsSummary findingCount={review.findingCount} />
              <KeyIssues
                finding={review.finding}
                limit={3}
                placeholder={<TabPlaceholder tab={REVIEW_PLACEHOLDER_TAB.finding} status={review.status} isNew={isNew} />}
              />
              {review.finding.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('findings')}
                  className="self-start text-sm font-medium text-primary hover:text-primary-hover hover:underline"
                >
                  {REVIEW_TEXT.viewAllFindings}
                </button>
              )}
            </div>
          </div>
        )}
        {activeTab === 'findings' &&
          (review.finding.length > 0 ? (
            <KeyIssues finding={review.finding} />
          ) : (
            <TabPlaceholder tab={REVIEW_PLACEHOLDER_TAB.finding} status={review.status} isNew={isNew} />
          ))}
        {activeTab === 'suggestion' &&
          (review.suggestion.length > 0 ? (
            <SuggestionList suggestion={review.suggestion} />
          ) : (
            <TabPlaceholder tab={REVIEW_PLACEHOLDER_TAB.suggestion} status={review.status} isNew={isNew} />
          ))}
        {activeTab === 'generated_test' && (
          <GeneratedTestsTab reviewId={reviewId} status={review.status} isNew={isNew} fileList={review.generatedTest} />
        )}
      </div>
    </div>
  )
}
