import type { Settings } from '../model/dto.js'
import type { Store } from '../store/store.js'

export type SettingsService = ReturnType<typeof createSettingsService>

// Settings per account (org, plan 028), seeded with the frontend defaults (frontend/src/models/settings.model.ts).
export function createSettingsService(store: Store) {
  return {
    get(orgId: string): Promise<Settings> {
      return store.getSettings(orgId)
    },

    save(orgId: string, settings: Settings): Promise<void> {
      return store.saveSettings(orgId, settings)
    }
  }
}
