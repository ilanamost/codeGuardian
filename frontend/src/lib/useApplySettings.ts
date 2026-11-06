import { useEffect } from 'react'
import { resolveTheme, watchSystemTheme } from './systemTheme'
import { useSettings } from './useSettings'

/**
 * Mirrors theme and density onto <html> (was SettingsProvider), on every page including the
 * login page. The settings themselves load in the app shell (components/AppShell.tsx), once
 * signed in (plan 028). The theme comes from the device key `cr.theme` (plan 046) until the
 * account settings load, so the sign-in pages are themed too.
 */
export function useApplySettings() {
  const { settings } = useSettings()

  useEffect(() => {
    document.documentElement.dataset.density = settings.historyDensity
  }, [settings.historyDensity])

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(settings.theme)
    }
    apply()
    return settings.theme === 'system' ? watchSystemTheme(apply) : undefined
  }, [settings.theme])
}
