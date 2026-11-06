import { API_PATH } from '../lib/api.constants'
import type { SettingsDto, ThemeMode } from '../models/dto'
import { isOneOf, isRecord } from '../models/guard'
import { AppSettings } from '../models/settings.model'
import { get, put, type DataSource } from './data-source'
import type { StorageService } from './storage.service'

export interface SettingsService {
  // Synchronous read of the locally cached settings, used to hydrate the store before the first
  // paint so the theme never flashes. Never throws; falls back to the defaults.
  read(): SettingsDto
  get(): Promise<SettingsDto>
  save(settings: SettingsDto): Promise<void>
  // Drops the browser cache (`cr.settings`) on sign-out or when the session ends (plan 028), so
  // the next account never starts from this one's preferences. Never throws.
  clearCache(): void
  // Plan 046: the device theme (`cr.theme`), kept apart from the account cache so the sign-in
  // pages and the moment after sign-out use the theme the user chose. Never throws.
  readTheme(): ThemeMode | undefined
  saveTheme(theme: ThemeMode): void
}

// Browser storage key kept from lib/SettingsProvider.tsx so users keep their preferences. It
// holds a cache of the saved settings only; the backend keeps the settings themselves.
export const settingsStorageKey = 'cr.settings'

// The device theme: a per-browser preference like `ui.fileList`, NOT removed by clearCache.
export const themeStorageKey = 'cr.theme'

const isThemeMode = isOneOf(['light', 'dark', 'system'] as const)

function readCache(storage: StorageService): SettingsDto {
  return AppSettings.merge(AppSettings.defaultDto(), storage.get(settingsStorageKey, isRecord)).toDto()
}

function writeCache(storage: StorageService, settings: SettingsDto) {
  try {
    storage.set(settingsStorageKey, settings)
  } catch {
    // The cache is optional: when storage is unavailable the settings last for this session only.
  }
}

export function createSettingsService(source: DataSource, storage: StorageService): SettingsService {
  // Bumped by every clearCache (QA R2-D6): a request that started before the cache was cleared
  // (sign-out, session ended) never writes the previous account's settings back into it, even
  // when its answer had already arrived when the sign-out cancelled the requests in flight.
  let cacheVersion = 0

  function writeCacheIfCurrent(settings: SettingsDto, startedVersion: number) {
    if (startedVersion === cacheVersion) writeCache(storage, settings)
  }

  return {
    read: () => readCache(storage),
    readTheme: () => storage.get(themeStorageKey, isThemeMode),
    saveTheme(theme) {
      try {
        storage.set(themeStorageKey, theme)
      } catch {
        // Storage is unavailable: the choice lasts for this session only.
      }
    },
    clearCache() {
      cacheVersion += 1
      try {
        storage.remove(settingsStorageKey)
      } catch {
        // Storage is unavailable: there is no cache to drop.
      }
    },
    // The app shell's silent load (plan 037): never shows the global loader.
    async get() {
      const startedVersion = cacheVersion
      const settings = AppSettings.merge(AppSettings.defaultDto(), await get<unknown>(source, API_PATH.settings, { background: true })).toDto()
      writeCacheIfCurrent(settings, startedVersion)
      return settings
    },
    // The cache is written when the save starts (the theme applies on the next load even before
    // the server answers), never after the await, so a clear during the PUT stays cleared.
    async save(settings) {
      writeCacheIfCurrent(settings, cacheVersion)
      await put(source, API_PATH.settings, settings)
    }
  }
}
