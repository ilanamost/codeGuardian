import { createAction, createListenerMiddleware, isAnyOf, isRejected, type TypedStartListening } from '@reduxjs/toolkit'
import { REVIEW_TEXT } from '../lib/review.constants'
import { SETTINGS_WAIT_MAX_MS } from '../lib/settings.constants'
import { AppError, isAppErrorJson, type AppErrorJson } from '../models/app-error'
import { Review, REVIEW_STATUS } from '../models/review.model'
import type { NotificationPreference, NotificationType } from '../models/dto'
import type { Services } from '../services'
import { preferenceFor } from '../services/notification.service'
import { ERROR_CODE, FIELD_ERROR_MESSAGE } from '../utils/error-messages'
import { HTTP_STATUS } from '../lib/api.constants'
import { changePassword, fetchAccount, fetchAvatarSrc, updateAccount } from './account.slice'
import { isSessionReset, register, restoreSession, sessionEnded, signIn } from './session.slice'
import { searchRepo, selectRepo } from './github.slice'
import { fetchReview, isSupersededReviewRequest } from './review.slice'
import { fetchSettings, notificationSet, saveSettings, settingsUpdated, themeRestored } from './settings.slice'
import type { AppDispatch, RootState } from './index'

// For failures that do not come from a thunk (e.g. the clipboard in CopyButton).
export const errorReported = createAction<AppErrorJson>('notification/errorReported')

type AppStartListening = TypedStartListening<RootState, AppDispatch>

// A failure of a request that a newer one replaced (the user moved on) is not reported.
function isSuperseded(action: unknown, state: RootState): boolean {
  if (fetchReview.rejected.match(action)) return isSupersededReviewRequest(state, action.meta.requestId)
  if (searchRepo.rejected.match(action)) return state.github.latestSearchId !== action.meta.requestId
  if (selectRepo.rejected.match(action)) return isSupersededFileList(action, state)
  return false
}

// Plan 030 QA F1: a 409 conflict clears the account and with it the selected repository in the
// same reducer, so the failure would look outdated. The reducer clears the account only when the
// failed repository was still the selected one, so a cleared account after a 409 means this
// failure is current, and its toast is kept.
function isSupersededFileList(action: ReturnType<typeof selectRepo.rejected>, state: RootState): boolean {
  if (action.payload?.causeCode === ERROR_CODE.conflict && state.github.account === null) return false
  return state.github.selectedRepoId !== action.meta.arg
}

// A failure the page shows next to a form field instead (a wrong current password, 422 with
// `details.issue[]`): no toast on top of the field error.
// A background account load (the Sidebar) fails silently, unless a page that shows the account
// asked for it while it ran (`reportFailure`).
// Plan 033: the profile photo's load fails silently too; the initials are shown instead.
function isSilentAccountFailure(action: unknown, before: RootState): boolean {
  if (fetchAvatarSrc.rejected.match(action)) return true
  return fetchAccount.rejected.match(action) && !before.account.reportFailure
}

// The login and register pages show these answers under the form instead of a toast (plan 028).
const inlineSessionStatusList: number[] = [HTTP_STATUS.unauthorized, HTTP_STATUS.conflict, HTTP_STATUS.unprocessable, HTTP_STATUS.rateLimited]

function isShownInline(action: unknown): boolean {
  if (signIn.rejected.match(action) || register.rejected.match(action)) {
    return action.payload?.status !== undefined && inlineSessionStatusList.includes(action.payload.status)
  }
  // Plan 034: the Account form shows a taken name or email (409), the wait (429) and its fields'
  // 422 under the form.
  if (updateAccount.rejected.match(action)) {
    const status = action.payload?.status
    if (status === HTTP_STATUS.conflict || status === HTTP_STATUS.rateLimited) return true
    return status === HTTP_STATUS.unprocessable
  }
  if (!changePassword.rejected.match(action)) return false
  return action.payload?.issueList?.some((item) => Object.hasOwn(FIELD_ERROR_MESSAGE, item.field)) ?? false
}

// A 401 of any request after sign-in means the session ended (expired, signed out elsewhere, or
// the password changed elsewhere). The restore, sign-in and registration answer 401 by design.
function isSessionEndedFailure(action: unknown): boolean {
  if (!isRejected(action)) return false
  if (restoreSession.rejected.match(action) || signIn.rejected.match(action) || register.rejected.match(action)) return false
  return isAppErrorJson(action.payload) && action.payload.status === HTTP_STATUS.unauthorized
}

function toAppError(action: { payload?: unknown; error?: { message?: string } }): AppError {
  if (isAppErrorJson(action.payload)) return AppError.fromJson(action.payload)
  return new AppError({ code: ERROR_CODE.unknown, kind: 'unknown', message: action.error?.message })
}

// Where the saved settings are, for preference-gated notices (QA AI-43, D3). The store starts
// from the browser's cached settings (the defaults when the cache is empty), which can differ
// from the saved ones. While GET /api/settings is in flight a gated notice waits for it:
// - 'idle': no load was started (a store without the app shell, e.g. in tests): the current
//   state decides;
// - 'loading': wait until the load settles, at most SETTINGS_WAIT_MAX_MS;
// - 'loaded': the saved preference (merged with the user's changes since) decides;
// - 'failed' (or the wait timed out): the notice is shown, so an error is never lost because
//   the preference could not be read.
type SettingsLoad = 'idle' | 'loading' | 'loaded' | 'failed'

function withShown(preference: NotificationPreference, type: NotificationType): NotificationPreference {
  return { ...preference, [type]: true }
}

// One place turns failures into notifications: every rejected thunk and every errorReported
// action becomes an AppError and goes to notification.service, which applies the Settings
// preferences and the 2 second de-duplication. Settings changes are saved from here too.
export function createAppListener(services: Services) {
  const listener = createListenerMiddleware()
  const startListening = listener.startListening as AppStartListening

  let settingsLoad: SettingsLoad = 'idle'
  let settingsSettled: Promise<void> = Promise.resolve()
  let settle = () => {}

  startListening({
    actionCreator: fetchSettings.pending,
    effect: () => {
      // A reload after a successful one keeps the loaded preference meanwhile, and a second load
      // while one is in flight (React StrictMode mounts twice) shares its wait.
      if (settingsLoad === 'loaded' || settingsLoad === 'loading') return
      settingsLoad = 'loading'
      settingsSettled = new Promise<void>((resolve) => {
        settle = resolve
      })
    }
  })

  startListening({
    matcher: isAnyOf(fetchSettings.fulfilled, fetchSettings.rejected),
    effect: (action) => {
      if (fetchSettings.fulfilled.match(action)) settingsLoad = 'loaded'
      else if (settingsLoad !== 'loaded') settingsLoad = 'failed'
      settle()
    }
  })

  // The preference a gated notice of `type` is decided with, once the settings can be trusted.
  async function preferenceReady(type: NotificationType, getState: () => RootState): Promise<NotificationPreference> {
    if (settingsLoad === 'loading') {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), SETTINGS_WAIT_MAX_MS)
      })
      const outcome = await Promise.race([settingsSettled, timeout])
      clearTimeout(timer)
      if (outcome === 'timeout') return withShown(getState().settings.notification, type)
    }
    const preference = getState().settings.notification
    return settingsLoad === 'failed' ? withShown(preference, type) : preference
  }

  startListening({
    predicate: (action) => isRejected(action) || errorReported.match(action),
    effect: async (action, api) => {
      // A thunk cancelled by its caller or skipped by its condition is not an error.
      if (isRejected(action) && (action.meta.aborted || action.meta.condition)) return
      // Plan 028: the session ended. `sessionEnded` once (the guard redirects to
      // /login, keeping the path), one toast, and no error toast for the 401 itself.
      if (isSessionEndedFailure(action)) {
        if (api.getState().session.status !== 'signedIn') return
        api.dispatch(sessionEnded())
        services.settings.clearCache()
        services.session.abortAll()
        services.notification.notifySessionEnded()
        return
      }
      if (isSuperseded(action, api.getState()) || isShownInline(action)) return
      if (isSilentAccountFailure(action, api.getOriginalState())) return
      const error = errorReported.match(action) ? AppError.fromJson(action.payload) : toAppError(action)
      // Network, timeout and storage failures (and failures no preference covers) are shown at once.
      const type = error.kind === 'abort' ? null : preferenceFor(error)
      if (!type) {
        services.notification.notifyError(error, api.getState().settings.notification)
        return
      }
      const preference = await preferenceReady(type, api.getState)
      // The user may have moved on while the settings loaded.
      if (isSuperseded(action, api.getState())) return
      services.notification.notifyError(error, preference)
    }
  })

  // A review the page was waiting for (pending, queued or in progress) has completed: the
  // "Review completed" notice, which follows its Settings preference.
  startListening({
    actionCreator: fetchReview.fulfilled,
    effect: async (action, api) => {
      const before = api.getOriginalState().review.current
      const after = action.payload
      if (isSupersededReviewRequest(api.getState(), action.meta.requestId)) return
      if (!after || before?.id !== after.id || !before.review) return
      if (new Review(before.review).isFinished || after.review.status !== REVIEW_STATUS.completed) return
      services.notification.notify('reviewCompleted', REVIEW_TEXT.completed, await preferenceReady('reviewCompleted', api.getState))
      // Plan 028: the "Critical security findings" notice, when the completed review has a
      // critical finding and only when that toggle is on.
      if (!new Review(after.review).hasCriticalFinding) return
      services.notification.notifyCriticalFinding(REVIEW_TEXT.criticalFinding, await preferenceReady('criticalFinding', api.getState))
    }
  })

  // After a sign-out or a session that ended the settings are those of no one: the next
  // account's preference-gated notices wait for its own GET /api/settings again.
  startListening({
    predicate: (action) => isSessionReset(action),
    effect: (_, api) => {
      settingsLoad = 'idle'
      settle()
      // Plan 046: the theme is a device preference; it survives the reset (no save is sent).
      const theme = services.settings.readTheme()
      if (theme) api.dispatch(themeRestored(theme))
    }
  })

  // Plan 046: the device theme is written at once, independent of the PUT; after a load the
  // account value wins and the device key follows.
  startListening({
    actionCreator: fetchSettings.fulfilled,
    effect: (action) => {
      services.settings.saveTheme(action.payload.theme)
    }
  })

  startListening({
    matcher: isAnyOf(settingsUpdated, notificationSet),
    effect: (_, api) => {
      services.settings.saveTheme(api.getState().settings.theme)
      api.dispatch(saveSettings(api.getState().settings))
    }
  })

  return listener
}
