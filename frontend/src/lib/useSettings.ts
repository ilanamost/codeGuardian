import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import { ReactReduxContext } from 'react-redux'
import { toast } from 'sonner'
import { AppSettings } from '../models/settings.model'
import { showPreferenceToast } from '../services/notification.service'
import { notificationSet, settingsUpdated } from '../store/settings.slice'
import type { NotificationType, SettingsState } from '../types'

export type SettingsContextValue = {
  settings: SettingsState
  update: (patch: Partial<SettingsState>) => void
  setNotification: (type: NotificationType, enabled: boolean) => void
}

const defaultSettings = AppSettings.defaultDto()
const noopSubscribe = () => () => {}

/**
 * Thin facade over the Redux settings slice, so components keep the API they had with
 * SettingsProvider. Outside a store Provider it falls back to the defaults (as the old context did).
 */
export function useSettings(): SettingsContextValue {
  const store = useContext(ReactReduxContext)?.store
  const settings = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    () => (store ? (store.getState() as { settings: SettingsState }).settings : defaultSettings)
  )
  const update = useCallback((patch: Partial<SettingsState>) => store?.dispatch(settingsUpdated(patch)), [store])
  const setNotification = useCallback(
    (type: NotificationType, enabled: boolean) => store?.dispatch(notificationSet({ type, enabled })),
    [store]
  )
  return useMemo(() => ({ settings, update, setNotification }), [settings, update, setNotification])
}

/** Raises an in-app toast only when the notification type is enabled. */
export function notify(settings: SettingsState, type: NotificationType, message: string) {
  return showPreferenceToast(toast, settings.notification, type, message)
}

export function useNotify() {
  const { settings } = useSettings()
  return (type: NotificationType, message: string) => notify(settings, type, message)
}
