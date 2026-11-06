// Help page content (static UI text, not served by any service).
import { AI_NOTICE_TEXT } from './review.constants'
import type { ErrorEntry, HelpFeature, HelpGuide, HelpIssue, HelpTopicId, IssueType, SupportPriority } from '../types'

export const topicGroupList: { title: string; topic: { id: HelpTopicId; label: string }[] }[] = [
  {
    title: 'Getting Started',
    topic: [
      { id: 'create-review', label: 'Create a New Review' },
      { id: 'view-results', label: 'View Review Results' },
      { id: 'github', label: 'Use GitHub Integration' },
      { id: 'account', label: 'Manage Your Account' }
    ]
  },
  { title: 'Features', topic: [{ id: 'features', label: 'Main Features' }] },
  {
    title: 'Troubleshooting',
    topic: [
      { id: 'common-issues', label: 'Common Issues' },
      { id: 'error-messages', label: 'Error Messages' },
      { id: 'contact', label: 'Contact Support' }
    ]
  }
]

export const guideOf: Partial<Record<HelpTopicId, HelpGuide>> = {
  'create-review': {
    title: 'How to Create a New Review',
    subtitle: 'Follow these steps to submit your code for AI analysis and get detailed feedback.',
    step: [
      { title: 'Open the New Review page', detail: 'Click "New Review" in the left sidebar or from the dashboard.' },
      { title: 'Enter your code', detail: 'Paste your code in the editor.' },
      { title: 'Select the language', detail: 'Choose the programming language of your code (e.g. TypeScript, Python, Java).' },
      { title: 'Submit for review', detail: 'The AI analyzes your code and gives feedback on style, bugs, security and refactoring, and generates tests.' }
    ],
    tip: [
      'You can also import files from GitHub (requires GitHub integration).',
      'Larger files may take a bit longer to analyze.',
      AI_NOTICE_TEXT.claude,
      "You'll be notified when the review is complete."
    ]
  },
  'view-results': {
    title: 'How to View Review Results',
    subtitle: 'Understand the findings, refactors and tests produced by a review.',
    step: [
      { title: 'Open a review', detail: 'Pick a review from Recent Reviews on the dashboard or from Review History.' },
      { title: 'Read the Summary', detail: 'The Summary tab shows the findings count by severity and the key issues found.' },
      { title: 'Inspect Findings', detail: 'Each finding has a severity, a description and the line where it was found.' },
      { title: 'Apply Suggested Refactors', detail: 'Review the proposed replacement code and copy what you want to keep.' },
      { title: 'Use Generated Tests', detail: 'Pick a framework and test types, then copy the tests for one file or for all files.' }
    ],
    tip: ['Download the PDF report to share a review with your team.', 'Use Regenerate to create the tests again.']
  },
  github: {
    title: 'How to Use GitHub Integration',
    subtitle: 'Import a file from a GitHub repository and review it.',
    step: [
      { title: 'Open GitHub Integration', detail: 'Click "GitHub Integration" in the left sidebar.' },
      { title: 'Connect your account', detail: 'Click "Connect GitHub" and authorize access. Use "Switch account" to change it.' },
      { title: 'Select a repository', detail: 'Search by name, select a repository, then click Next.' },
      { title: 'Choose a file', detail: 'Select the file to review and approve the import.' }
    ],
    tip: ['Only repositories you authorized are listed.', 'If a repository is missing, reconnect GitHub and verify permissions.']
  },
  account: {
    title: 'How to Manage Your Account',
    subtitle: 'Control your profile, security and preferences from Settings.',
    step: [
      { title: 'Open Settings', detail: 'Click "Settings" in the left sidebar.' },
      { title: 'Account', detail: 'See your name, email and the date your membership started.' },
      { title: 'Security', detail: 'Click "Update password" to change your password, or use Sign Out.' },
      { title: 'Notifications', detail: 'Choose which events notify you, and whether to receive email.' },
      { title: 'Appearance and AI preferences', detail: 'Pick a theme, editor font size and density, and set how the AI reviews your code.' }
    ],
    tip: ['Settings are saved in this browser.']
  }
}

export const featureList: HelpFeature[] = [
  { title: 'Structured findings', detail: 'Every finding has a category, severity and line range, so results can be filtered and counted.' },
  { title: 'Suggested refactors', detail: 'Replacement code you can copy for each improvement the AI proposes.' },
  { title: 'Generated tests', detail: 'Starter unit, edge-case and error-case tests for your code.' },
  { title: 'Quality dashboard', detail: 'Findings by severity and category, activity over time and recent reviews.' },
  { title: 'Review history', detail: 'Reopen any previous review by its ID.' },
  { title: 'GitHub import', detail: 'Select a repository file and review it without copy and paste.' },
  { title: 'Settings', detail: 'Notifications, theme, editor and AI review preferences.' }
]

export const issueList: HelpIssue[] = [
  {
    id: 'not-starting',
    title: "Code review isn't starting",
    summary: "Your review stays pending or doesn't begin.",
    whatHappened: 'The review was created but stays in the pending or queued state.',
    cause: ['The review queue is busy.', 'Your session expired.', 'The code editor is empty or no language is selected.'],
    fix: ['Wait a minute and refresh the page.', 'Make sure code is entered and a language is selected.', 'Sign in again if your session expired.', 'Submit the review again.']
  },
  {
    id: 'too-long',
    title: 'Review is taking too long',
    summary: 'The review remains in progress longer than expected.',
    whatHappened: 'The review has been in progress for more than a few minutes.',
    cause: ['The file is large.', 'The analysis service is under high load.', 'Your connection is unstable.'],
    fix: ['Wait a few more minutes; large files take longer.', 'Check your internet connection.', 'Cancel and retry with a smaller snippet.']
  },
  {
    id: 'upload',
    title: 'Unable to upload code',
    summary: 'Your file or code snippet cannot be submitted.',
    whatHappened: 'The upload is rejected or the submit button does nothing.',
    cause: ['An unsupported file format.', 'The file is larger than the permitted size.', 'The file is empty.'],
    fix: ['Upload a supported source-code file.', 'Reduce the file size or submit a smaller snippet.', 'Check that the file is not empty, then try again.']
  },
  {
    id: 'github',
    title: "GitHub repository won't connect",
    summary: "Repository access or authorization isn't working.",
    whatHappened: 'The repository list is empty or GitHub authorization fails.',
    cause: ['Authorization was cancelled or expired.', 'The app was not granted access to the repository.', 'You are connected to a different GitHub account.'],
    fix: ['Open GitHub Integration and click "Switch account" or reconnect.', 'Approve the requested permissions.', 'Make sure the repository belongs to the connected account.', 'Search for the repository by name.']
  },
  {
    id: 'incorrect',
    title: 'Review results look incorrect',
    summary: 'Findings seem irrelevant, incomplete or inaccurate.',
    whatHappened: 'The findings do not match your code, or important issues seem to be missing.',
    cause: ['The wrong language was selected.', 'The AI focus or strictness settings filter the results.', 'The snippet lacks context.'],
    fix: ['Check the language selected in the editor.', 'Review Settings, AI preferences (focus and strictness).', 'Submit more of the surrounding code.', 'Run the review again.']
  },
  {
    id: 'access',
    title: "Can't access my account",
    summary: 'Login, session or permission problems.',
    whatHappened: 'You are signed out unexpectedly or see an Unauthorized message.',
    cause: ['Your session expired.', 'Incorrect credentials.', 'Your account lacks permission for the action.'],
    fix: ['Sign in again.', 'Check your email and password.', 'Update your password in Settings, Security.']
  }
]

export const errorList: ErrorEntry[] = [
  { message: 'Review failed', meaning: 'The review could not be completed.', action: 'Retry the review. If it fails again, contact support.' },
  { message: 'Request timed out', meaning: 'The operation took too long to finish.', action: 'Retry and check your connection.' },
  { message: 'Unsupported file type', meaning: "The uploaded file format isn't supported.", action: 'Upload a supported source-code file.' },
  { message: 'File size exceeds limit', meaning: 'The upload is larger than the permitted size.', action: 'Reduce the file size or submit a smaller snippet.' },
  { message: 'GitHub authorization failed', meaning: "The application couldn't authorize repository access.", action: 'Reconnect GitHub and verify permissions.' },
  { message: 'Unauthorized', meaning: "Your session or credentials aren't accepted.", action: 'Sign in again.' },
  { message: 'Something went wrong', meaning: 'An unexpected error occurred.', action: 'Retry. If it persists, contact support with the error details.' }
]

export const issueTypeOptionList: { value: IssueType; label: string }[] = [
  { value: 'review_failed', label: 'Review failed' },
  { value: 'upload', label: 'Code upload problem' },
  { value: 'github', label: 'GitHub integration' },
  { value: 'account', label: 'Account or login' },
  { value: 'other', label: 'Other' }
]

// The priority a new support request starts with.
export const defaultSupportPriority: SupportPriority = 'normal'

export const priorityOptionList: { value: SupportPriority; label: string }[] = [
  { value: 'low', label: 'Low — minor inconvenience' },
  { value: 'normal', label: "Normal — feature isn't working as expected" },
  { value: 'high', label: 'High — blocked from completing my work' }
]

// Plan 032: Contact Support opens the user's own mail app with a ready message to this address
// (a `mailto:` link, src/lib/supportMailto.ts). The app sends no email itself. Change the address
// here only: it is not a secret (it is shown on screen and in the link).
export const SUPPORT_EMAIL = 'ilana.mostovski@gmail.com'

// The short priority names of the mail subject (the form shows the long labels above).
export const SUPPORT_PRIORITY_SHORT_LABEL: Record<SupportPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High'
}

// Plan 032: the text of the support message the mail app opens with, and of the form around it.
export const SUPPORT_MAIL_TEXT = {
  ticket: 'Ticket',
  issueType: 'Issue type',
  priority: 'Priority',
  from: 'From',
  reviewId: 'Review ID',
  description: 'Description',
  shortened: '(shortened; the full text is in the form)',
  // Ends a head value (sender email, review ID) cut to fit the link (QA 032 F1).
  cutMark: '…'
} as const

export const SUPPORT_MESSAGE = {
  // The banner and the toast after a request was stored.
  outcome: (ticket: string | null) =>
    `Your mail app should open with the message. Press Send there to contact support.${ticket ? ` Ticket ${ticket}.` : ''}`,
  addressLabel: 'Support address:',
  noMailApp: 'Nothing opened? Copy the message and send it to the address yourself.',
  copyMessage: 'Copy message',
  copyAddress: 'Copy address',
  messageCopied: 'Message copied',
  addressCopied: 'Support address copied'
} as const
