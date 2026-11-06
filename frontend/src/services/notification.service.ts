import { toast as sonnerToast } from 'sonner'
import type { AppError } from '../models/app-error'
import type { NotificationPreference, NotificationType } from '../models/dto'
import { ERROR_CODE, SESSION_ERROR_MESSAGE, type ErrorCode } from '../utils/error-messages'

// The only place that raises toasts for errors and preference-gated notices. Services never show
// toasts; the store's listener middleware calls notifyError for every rejected thunk.
export interface ToastApi {
  success: (message: string) => unknown
  error: (message: string) => unknown
}

export interface NotificationService {
  // Shows the error unless its preference is off, it was cancelled, or the same code was shown
  // less than `dedupeMs` ago. Returns whether a toast was raised.
  notifyError(error: AppError, preference: NotificationPreference): boolean
  // Critical-finding notices follow the `criticalFinding` preference.
  notifyCriticalFinding(message: string, preference: NotificationPreference): boolean
  // A preference-gated notice of any type (Send test, review completed).
  notify(type: NotificationType, message: string, preference: NotificationPreference): boolean
  // Plan 028: the one toast of a session that ended mid-use (a 401), whatever the preferences,
  // de-duplicated like the errors, so polling and parallel requests show it once.
  notifySessionEnded(): boolean
}

export interface NotificationServiceOption {
  toast?: ToastApi
  now?: () => number
  dedupeMs?: number
}

export const notificationDedupeMs = 2000

// Review-related failures follow the "Review failed" preference, except when the cause is the
// connection or the browser (network, timeout, storage): those are always shown, even during a
// review action, because the user has to act on them. Everything that is not about a review
// (GitHub, support, settings, dashboard, unknown) is always shown, so failures are never silent.
const alwaysShownKindList: AppError['kind'][] = ['network', 'timeout', 'storage']

const reviewCodeList: ErrorCode[] = [
  ERROR_CODE.reviewLoad,
  ERROR_CODE.reviewSave,
  ERROR_CODE.reviewRename,
  ERROR_CODE.reviewDelete,
  ERROR_CODE.reviewCreate,
  ERROR_CODE.reviewRun,
  ERROR_CODE.reportPdf,
  ERROR_CODE.testRegenerate
]

export function preferenceFor(error: Pick<AppError, 'code' | 'kind'>): NotificationType | null {
  if (alwaysShownKindList.includes(error.kind)) return null
  return reviewCodeList.includes(error.code) ? 'reviewFailed' : null
}

// Raises an in-app toast only when the notification type is enabled. "Review failed" is an
// error toast, the others are success toasts.
export function showPreferenceToast(
  toast: ToastApi,
  preference: NotificationPreference,
  type: NotificationType,
  message: string
): boolean {
  if (!preference[type]) return false
  if (type === 'reviewFailed') toast.error(message)
  else toast.success(message)
  return true
}

export function createNotificationService(option: NotificationServiceOption = {}): NotificationService {
  const toast = option.toast ?? sonnerToast
  const now = option.now ?? Date.now
  const dedupeMs = option.dedupeMs ?? notificationDedupeMs
  const shownAt = new Map<string, number>()

  return {
    notifyError(error, preference) {
      if (error.kind === 'abort') return false
      const type = preferenceFor(error)
      if (type && !preference[type]) return false
      const time = now()
      const last = shownAt.get(error.code)
      if (last !== undefined && time - last < dedupeMs) return false
      shownAt.set(error.code, time)
      toast.error(error.userMessage)
      return true
    },
    notifyCriticalFinding(message, preference) {
      return showPreferenceToast(toast, preference, 'criticalFinding', message)
    },
    notify(type, message, preference) {
      return showPreferenceToast(toast, preference, type, message)
    },
    notifySessionEnded() {
      const time = now()
      const last = shownAt.get(ERROR_CODE.unauthorized)
      if (last !== undefined && time - last < dedupeMs) return false
      shownAt.set(ERROR_CODE.unauthorized, time)
      toast.error(SESSION_ERROR_MESSAGE.sessionEnded)
      return true
    }
  }
}
