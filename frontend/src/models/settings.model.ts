import type { NotificationPreference, NotificationType, SettingsDto } from './dto'
import { isBoolean, isOneOf, isRecord, isString } from './guard'

export const autoLanguage = 'auto'

export const notificationTypeList: readonly NotificationType[] = ['reviewCompleted', 'reviewFailed', 'criticalFinding', 'email']

const defaultSettingsDto: SettingsDto = {
  notification: { reviewCompleted: true, reviewFailed: true, criticalFinding: true, email: false },
  theme: 'light',
  editorFontSize: 'medium',
  historyDensity: 'comfortable',
  reviewFocus: 'all',
  strictness: 'balanced',
  explanation: 'detailed',
  generatedTest: true,
  language: autoLanguage
}

const fieldGuard: { [K in Exclude<keyof SettingsDto, 'notification'>]: (value: unknown) => boolean } = {
  theme: isOneOf(['light', 'dark', 'system'] as const),
  editorFontSize: isOneOf(['small', 'medium', 'large'] as const),
  historyDensity: isOneOf(['comfortable', 'compact'] as const),
  reviewFocus: isOneOf(['all', 'bugs', 'security', 'performance', 'readability'] as const),
  strictness: isOneOf(['high_confidence', 'balanced', 'comprehensive'] as const),
  explanation: isOneOf(['concise', 'detailed'] as const),
  generatedTest: isBoolean,
  language: isString
}

const settingsKeyList = [...Object.keys(fieldGuard), 'notification']

// A complete Settings object and nothing else (the backend's strict schema for PUT /api/settings).
export function isSettingsDto(value: unknown): value is SettingsDto {
  if (!isRecord(value) || !isRecord(value.notification)) return false
  const notification = value.notification
  const keyList = Object.keys(value)
  return (
    keyList.length === settingsKeyList.length &&
    settingsKeyList.every((key) => Object.hasOwn(value, key)) &&
    (Object.keys(fieldGuard) as (keyof typeof fieldGuard)[]).every((key) => fieldGuard[key](value[key])) &&
    Object.keys(notification).length === notificationTypeList.length &&
    notificationTypeList.every((type) => isBoolean(notification[type]))
  )
}

export class AppSettings {
  readonly value: SettingsDto

  constructor(value: SettingsDto) {
    this.value = value
  }

  static defaults(): AppSettings {
    return new AppSettings(AppSettings.defaultDto())
  }

  static defaultDto(): SettingsDto {
    return { ...defaultSettingsDto, notification: { ...defaultSettingsDto.notification } }
  }

  // Merges a partial (possibly stale or hand-edited) stored value over the defaults, field by
  // field; unknown keys and invalid values are dropped, so a bad record never breaks the app.
  static merge(base: SettingsDto, patch: unknown): AppSettings {
    if (!isRecord(patch)) return new AppSettings({ ...base, notification: { ...base.notification } })
    const next: SettingsDto = { ...base, notification: { ...base.notification } }
    for (const key of Object.keys(fieldGuard) as (keyof typeof fieldGuard)[]) {
      if (fieldGuard[key](patch[key])) Object.assign(next, { [key]: patch[key] })
    }
    if (isRecord(patch.notification)) {
      for (const type of notificationTypeList) {
        const enabled = patch.notification[type]
        if (isBoolean(enabled)) next.notification[type] = enabled
      }
    }
    return new AppSettings(next)
  }

  isEnabled(type: NotificationType): boolean {
    return this.value.notification[type]
  }

  get notification(): NotificationPreference {
    return this.value.notification
  }

  toDto(): SettingsDto {
    return { ...this.value, notification: { ...this.value.notification } }
  }
}
