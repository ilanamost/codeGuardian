import { AppSettings, autoLanguage } from '../models/settings.model'
import type { NotificationType, SettingsSectionId, SettingsState } from '../types'

// Settings page UI constants (not data). The account comes from account.service (GET /api/account).
export { autoLanguage }

export const defaultSettings: SettingsState = AppSettings.defaultDto()

// How long a preference-gated notice waits for GET /api/settings before it is shown anyway
// (store/listener.ts, QA AI-43 D3). The request has no client timeout of its own.
export const SETTINGS_WAIT_MAX_MS = 10_000

export const sectionList: { id: SettingsSectionId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai', label: 'AI preferences' }
]

// `note`: a limit of what the toggle does today (plan 028, Open Question 5: no email is sent yet).
export const notificationList: { type: NotificationType; label: string; description: string; message: string; note?: string }[] = [
  {
    type: 'reviewCompleted',
    label: 'Review completed',
    description: 'Notify when an AI code review finishes.',
    message: 'Review completed'
  },
  {
    type: 'reviewFailed',
    label: 'Review failed',
    description: 'Notify when a review fails or cannot be completed.',
    message: 'Review failed'
  },
  {
    type: 'criticalFinding',
    label: 'Critical security findings',
    description: 'Notify when a review detects potentially serious vulnerabilities.',
    message: 'Critical security finding detected'
  },
  {
    type: 'email',
    label: 'Email notifications',
    description: 'Choose whether to receive notifications by email.',
    message: 'Email notification sent',
    note: 'Email delivery is not available yet. The choice is saved for when it is.'
  }
]

export const fontSizePx = { small: 12, medium: 14, large: 16 } as const
