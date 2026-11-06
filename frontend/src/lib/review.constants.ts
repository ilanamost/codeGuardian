import { testFrameworkList } from '../models/review.model'
import type { FailureReason } from '../models/dto'
import type { Severity, TestFramework, TestType } from '../types'

// Option lists for the review editor and the Generated Tests tab (UI constants, not data).
export const languageList = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Java']

export const frameworkList: TestFramework[] = [...testFrameworkList]

export const testTypeList: TestType[] = [
  { id: 'unit', label: 'Unit Tests' },
  { id: 'edge', label: 'Edge Cases' },
  { id: 'error', label: 'Error Cases' }
]

// Review History texts.
export const HISTORY_TEXT = {
  loading: 'Loading reviews...',
  emptyTitle: 'No reviews yet',
  emptyDetail: 'Start a new review and it will show up here.',
  startReview: 'Start a new review'
} as const

// Title of a review created without a name; the backend uses the same default.
export const NEW_REVIEW_TITLE = 'New review'

// How often the Review page asks for a review that is still pending, queued or in progress.
// While the status stays the same the wait grows (1 s, 2 s, 4 s, ... up to the maximum), and
// the page stops asking once the status has not changed for the maximum duration. Any status
// change starts over from the first interval.
export const REVIEW_POLL_INTERVAL_MS = 1000
export const REVIEW_POLL_BACKOFF_FACTOR = 2
export const REVIEW_POLL_MAX_INTERVAL_MS = 30_000
export const REVIEW_POLL_MAX_DURATION_MS = 5 * 60_000

// After a failed poll the page waits longer, and gives up after this many failures in a row.
export const REVIEW_POLL_RETRY_MS = 3000
export const REVIEW_POLL_MAX_FAILURE = 5

// Same limits as NewReview and SaveReview in .orchestrate/api-contract.yaml.
export const REVIEW_LIMIT = {
  contentMax: 100_000,
  titleMax: 120,
  // SaveReview.language in the contract.
  languageMax: 40
} as const

// Text a review shows in "Analyzed" before it is created.
export const NOT_ANALYZED_TEXT = 'Not analyzed yet'

// What the Review page and the Generated Tests tab tell the user.
export const REVIEW_TEXT = {
  // Plan 037: the Review page's Loader until the review has loaded.
  loading: 'Loading review...',
  // The primary button: "Run review" on /review/new (creates the review and starts the
  // analysis), "Save review" on an existing review.
  saveButton: 'Save review',
  runButton: 'Run review',
  saved: 'Review saved',
  started: 'Review started',
  completed: 'Review completed',
  // Plan 028: the "Critical security findings" notice (Settings > Notifications).
  criticalFinding: 'Critical security finding detected. Open the Findings tab to review it.',
  regenerate: 'Regenerate',
  regenerating: 'Regenerating...',
  regenerated: 'Tests regenerated',
  saving: 'Saving...',
  regenerateLater: 'Tests can be regenerated once the review is completed.',
  // Shown (no toast) when the page stopped checking an unfinished review.
  pollStopped: 'This page stopped checking for status updates.',
  pollResume: 'Check again',
  // Near Run review on a failed or cancelled review with no change since it was analyzed (plan 025).
  runAgainHint: 'Edit the code or upload a file to run again.',
  // The Summary's link to the Findings tab, shown only when there is a finding.
  viewAllFindings: 'View all findings'
} as const

// The Generated Tests tab's Test Configuration panel (plan 034: the choice is kept per review and
// sent with Regenerate; Copy all is an icon button beside the title).
export const TEST_CONFIG_TEXT = {
  title: 'Test Configuration',
  framework: 'Framework',
  testType: 'Test Type',
  generatedFor: 'Tests generated for',
  copyAll: 'Copy all test files',
  copiedAll: 'All test files copied',
  // Regenerate is off while no test type is chosen (the server refuses an empty list).
  testTypeRequired: 'Choose at least one test type to regenerate the tests.'
} as const

// What a review tab shows while its list is empty, by the review's state (plan 020).
// `notRun`: /review/new before Run review. `analyzing`: pending, queued or in progress.
// `completed`: finished with nothing in that list. `stopped`: failed or cancelled.
export const REVIEW_PLACEHOLDER_STATE = {
  notRun: 'notRun',
  analyzing: 'analyzing',
  completed: 'completed',
  stopped: 'stopped'
} as const

export type ReviewPlaceholderState = (typeof REVIEW_PLACEHOLDER_STATE)[keyof typeof REVIEW_PLACEHOLDER_STATE]

// The lists that get a placeholder: findings (the Findings tab and the Summary's Key issues),
// suggested refactors and generated tests.
export const REVIEW_PLACEHOLDER_TAB = {
  finding: 'finding',
  suggestion: 'suggestion',
  generatedTest: 'generated_test'
} as const

export type ReviewPlaceholderTab = (typeof REVIEW_PLACEHOLDER_TAB)[keyof typeof REVIEW_PLACEHOLDER_TAB]

export type ReviewPlaceholderText = { title: string; detail: string }

const analyzingTitle = 'Analyzing your code…'
const stoppedTitle = 'This review did not finish'

export const REVIEW_PLACEHOLDER_TEXT: Record<ReviewPlaceholderState, Record<ReviewPlaceholderTab, ReviewPlaceholderText>> = {
  notRun: {
    finding: { title: 'No findings yet', detail: 'Run a review to see the issues in your code.' },
    suggestion: { title: 'No refactors yet', detail: 'Run a review to see the refactors suggested for your code.' },
    generated_test: { title: 'No tests yet', detail: 'Run a review to see the tests generated for your code.' }
  },
  analyzing: {
    finding: { title: analyzingTitle, detail: 'Findings will appear here when the review completes.' },
    suggestion: { title: analyzingTitle, detail: 'Suggested refactors will appear here when the review completes.' },
    generated_test: { title: analyzingTitle, detail: 'Generated tests will appear here when the review completes.' }
  },
  completed: {
    finding: { title: 'No issues found', detail: 'The review found no issues in this code.' },
    suggestion: { title: 'No refactors suggested', detail: 'The review has no refactors to suggest for this code.' },
    generated_test: { title: 'No tests generated', detail: 'The review generated no tests for this code.' }
  },
  stopped: {
    finding: { title: stoppedTitle, detail: 'There are no findings because the analysis stopped.' },
    suggestion: { title: stoppedTitle, detail: 'There are no suggested refactors because the analysis stopped.' },
    generated_test: { title: stoppedTitle, detail: 'There are no generated tests because the analysis stopped.' }
  }
}

// The test id of a placeholder: `<tab>-placeholder`, used by TabPlaceholder and the specs.
export const REVIEW_PLACEHOLDER_TEST_ID_SUFFIX = '-placeholder'

export function reviewPlaceholderTestId(tab: ReviewPlaceholderTab): string {
  return `${tab}${REVIEW_PLACEHOLDER_TEST_ID_SUFFIX}`
}

// Added under "No tests generated" when generated tests are off in Settings.
export const GENERATED_TEST_OFF_HINT = 'Generated tests are turned off in Settings.'

// Code editor (plan 021). The one map from a language of `languageList` to its Monaco language
// id and the file extensions that select it on upload. `languageFromFileName` (lib/codeFile.ts)
// and the Upload button's `accept` list both read it.
export const LANGUAGE_META: Record<string, { monacoId: string; extensionList: string[] }> = {
  TypeScript: { monacoId: 'typescript', extensionList: ['.ts', '.tsx', '.mts', '.cts'] },
  JavaScript: { monacoId: 'javascript', extensionList: ['.js', '.jsx', '.mjs', '.cjs'] },
  Python: { monacoId: 'python', extensionList: ['.py'] },
  Go: { monacoId: 'go', extensionList: ['.go'] },
  Java: { monacoId: 'java', extensionList: ['.java'] }
}

// Extension (lower case, with the dot) to language, built from LANGUAGE_META.
export const LANGUAGE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_META).flatMap(([language, { extensionList }]) => extensionList.map((extension) => [extension, language]))
)

// The hidden file input's `accept` attribute.
export const UPLOAD_ACCEPT = Object.keys(LANGUAGE_BY_EXTENSION).join(',')

// UTF-8 uses at most 4 bytes per character: a file larger than this many bytes is surely over
// REVIEW_LIMIT.contentMax characters and is rejected without being read.
export const UPLOAD_MAX_BYTE = REVIEW_LIMIT.contentMax * 4

// Texts of the code editor.
export const EDITOR_TEXT = {
  title: 'Code',
  upload: 'Upload file',
  fileInput: 'Code file',
  // Success toast after an upload or a drop.
  fileLoaded: (fileName: string) => `${fileName} loaded`
} as const

// The owner of the finding markers set on the editor model (monaco.editor.setModelMarkers).
export const FINDING_MARKER_OWNER = 'review-finding'

// QA F2 (plan 032): the model path of the editable editor. Monaco's TypeScript service reads the
// kind of file from its extension, and `.tsx` lets TypeScript code hold JSX (an uploaded `.tsx` file
// is TypeScript too). One fixed path for every language, so a language switch keeps the same model;
// only the TypeScript and JavaScript services read it (lib/editorDiagnostic.ts sets jsx: Preserve).
export const EDITOR_MODEL_PATH = 'file:///review/code.tsx'

// Plan 032: the owner of the syntax error markers (lib/syntaxCheck.ts). Separate from
// FINDING_MARKER_OWNER, so setting either list never clears the other.
export const SYNTAX_MARKER_OWNER = 'syntax'

// The `source` shown in a syntax error's hover.
export const SYNTAX_MARKER_SOURCE = 'Syntax'

// Plan 032: the syntax check runs this long after the last change of the code or the language.
export const SYNTAX_CHECK_DELAY_MS = 400

// At most this many syntax errors are marked (the first by position). Code longer than the review
// limit is not checked.
export const SYNTAX_LIMIT = {
  markMax: 20,
  contentMax: REVIEW_LIMIT.contentMax,
  // The longest token quoted in a message; a longer one is cut with an ellipsis.
  tokenMax: 20
} as const

// The hover messages of the syntax errors. Generic on purpose: the grammar knows where the code
// breaks, not the compiler's own wording.
export const SYNTAX_TEXT = {
  unexpected: (token: string) => `Unexpected \`${token}\``,
  missing: (token: string) => `Missing \`${token}\``,
  missingName: (name: string) => `Missing ${name}`,
  unclosed: (open: string, close: string) => `Missing \`${close}\` to close \`${open}\``,
  unterminatedString: 'Unterminated string',
  expectedBlock: 'Expected an indented block',
  unexpectedIndent: 'Unexpected indent',
  invalid: 'Invalid syntax'
} as const

// The glyph-margin dot of a finding line, by severity. Monaco keeps only [a-z0-9-_] in a
// decoration's class names, so Tailwind variant classes (`before:bg-critical`) would be broken
// apart (QA round 1, F2): these plain classes are styled in styles/basics/base.css with the
// severity tokens, as in SeverityDot (critical and high red, medium amber, low and info blue).
export const FINDING_GLYPH_CLASS: Record<Severity, string> = {
  critical: 'editor-finding-glyph editor-finding-glyph-critical',
  high: 'editor-finding-glyph editor-finding-glyph-high',
  medium: 'editor-finding-glyph editor-finding-glyph-medium',
  low: 'editor-finding-glyph editor-finding-glyph-low',
  info: 'editor-finding-glyph editor-finding-glyph-info'
}

// Plan 034: the import session's file list on the New Review page (several imported files, each
// its own draft and its own review) and the question asked before leaving unsaved drafts.
export const FILE_DRAFT_TEXT = {
  listLabel: 'Imported files',
  title: (name: string) => `Imported from ${name}`,
  mark: {
    draft: 'Draft',
    analyzing: 'Analyzing',
    reviewed: 'Reviewed',
    reviewFailed: 'Review failed',
    importFailed: 'Not imported',
    skipped: 'Skipped'
  },
  leaveTitle: 'Leave the imported files?',
  leaveDetail: 'Files without a review exist only on this page. If you leave, they are lost.',
  leaveConfirm: 'Leave',
  stay: 'Stay',
  // Plan 038: the toggle that closes and opens the list, and the closed rail (bar on phones).
  hideList: 'Hide imported files',
  showList: 'Show imported files',
  fileCount: (count: number) => (count === 1 ? '1 file' : `${count} files`),
  noOpenFile: 'No file open',
  // Plan 038, Revision 1: the phone dropdown of the imported files.
  position: (index: number, count: number) => `${index} of ${count}`,
  menuLabel: 'Choose an imported file'
} as const

// Plan 039: what a failed review tells the user, by FailureReason (contract 0.14.0): what went
// wrong and what to do. Every value of the enum has one; an unknown value reads as `internal`.
export const FAILURE_TEXT: Record<FailureReason, string> = {
  ai_not_configured: 'AI review is not set up on this server. Ask the administrator to add an API key, then press Run review again.',
  ai_unavailable: 'The AI service is busy or unreachable. Press Run review again in a minute.',
  ai_rate_limited: 'The AI service is receiving too many requests. Wait a minute, then press Run review again.',
  ai_timeout: 'The AI service took too long to answer. Press Run review again, or review a shorter piece of code.',
  ai_invalid_output: 'The AI answer could not be used. Press Run review again, or review a shorter piece of code.',
  ai_refused: 'The AI declined to review this code. Change the code and press Run review again.',
  ai_quota_exceeded: 'Your hourly limit of AI reviews is used up. Press Run review again in an hour.',
  internal: 'The review failed because of a problem on our side. Press Run review again, and contact support if it keeps failing.'
}

// Plan 039 (Open Questions 2 and 8): the notices under the Run review / Save review buttons and
// on the Help page. The first appears only when the backend's analyzer is `claude`, the second
// only when it is `stub`.
export const AI_NOTICE_TEXT = {
  claude: "Code is sent to Anthropic's Claude API for analysis. Do not submit secrets.",
  stub: 'Stub analyzer: no AI key is configured, so findings come from fixed rules, not an AI.'
} as const
