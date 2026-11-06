import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { NotificationType, SettingsDto, ThemeMode } from '../models/dto'
import { AppSettings } from '../models/settings.model'
import { ERROR_CODE } from '../utils/error-messages'
import { attempt, createAppAsyncThunk } from './thunk'
import type { RootState } from './index'

// Replaces the SettingsProvider state; same shape as SettingsState. Hydrated synchronously from
// settings.service.read() when the store is created, saved by the listener middleware on change.
export type SettingsSliceState = SettingsDto

// Keeps every field the user changed while the request was in flight: the loaded value fills
// only the fields that are still as they were when the request started.
export function mergeLoadedSettings(before: SettingsDto, current: SettingsDto, loaded: SettingsDto): SettingsDto {
  const next: SettingsDto = { ...loaded, notification: { ...loaded.notification } }
  for (const key of Object.keys(current) as (keyof SettingsDto)[]) {
    if (key === 'notification') continue
    if (current[key] !== before[key]) Object.assign(next, { [key]: current[key] })
  }
  for (const type of Object.keys(current.notification) as NotificationType[]) {
    if (current.notification[type] !== before.notification[type]) next.notification[type] = current.notification[type]
  }
  return next
}

export const fetchSettings = createAppAsyncThunk('settings/fetch', (_: void, { extra, rejectWithValue, getState }) =>
  attempt(ERROR_CODE.settingsLoad, rejectWithValue, async () => {
    const before = getState().settings
    const loaded = await extra.settings.get()
    return mergeLoadedSettings(before, getState().settings, loaded)
  })
)

export const saveSettings = createAppAsyncThunk('settings/save', (settings: SettingsDto, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.settingsSave, rejectWithValue, () => extra.settings.save(settings))
)

const settingsSlice = createSlice({
  name: 'settings',
  initialState: AppSettings.defaultDto(),
  reducers: {
    settingsUpdated: (state, action: PayloadAction<Partial<SettingsDto>>) => ({ ...state, ...action.payload }),
    // Plan 046: restores only the device theme after a session reset; not saved to the account.
    themeRestored: (state, action: PayloadAction<ThemeMode>) => ({ ...state, theme: action.payload }),
    notificationSet: (state, action: PayloadAction<{ type: NotificationType; enabled: boolean }>) => {
      state.notification[action.payload.type] = action.payload.enabled
    }
  },
  extraReducers: (builder) => {
    builder.addCase(fetchSettings.fulfilled, (_, action) => action.payload)
  }
})

export const { settingsUpdated, notificationSet, themeRestored } = settingsSlice.actions
export const settingsReducer = settingsSlice.reducer

export const selectSettings = (state: RootState) => state.settings
export const selectNotificationPreference = (state: RootState) => state.settings.notification
