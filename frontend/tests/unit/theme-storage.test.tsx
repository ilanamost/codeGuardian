import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { AppError } from '../../src/models/app-error'
import { AppSettings } from '../../src/models/settings.model'
import { createSettingsService, settingsStorageKey, themeStorageKey } from '../../src/services/settings.service'
import { createStorageService } from '../../src/services/storage.service'
import { createAppStore } from '../../src/store'
import { fetchSettings, settingsUpdated } from '../../src/store/settings.slice'
import { sessionEnded } from '../../src/store/session.slice'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStoreSettled, settle, signedInState } from '../utils/renderWithStore'

// Plan 046: the theme is a device preference in `cr.theme`, applied on every page (the sign-in
// pages included) and kept when the account settings cache is dropped.

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

const unauthorized = () => AppError.fromResponse(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })
const theme = () => document.documentElement.dataset.theme
const stored = () => window.localStorage.getItem(themeStorageKey)

// Real settings service over the fake data source calls, so storage behaves as in the browser.
function realSettingsServices(serverTheme: 'light' | 'dark' | 'system' = 'light') {
  const fake = createFakeServices()
  const settings = createSettingsService(
    {
      request: vi.fn(async (_method: string, path: string) => {
        if (path.includes('settings')) return { ...AppSettings.defaultDto(), theme: serverTheme }
        return undefined
      })
    } as never,
    createStorageService()
  )
  Object.assign(fake.services, { settings: { ...settings, get: vi.fn(settings.get), save: vi.fn(settings.save) } })
  fake.services.session.restore.mockRejectedValue(unauthorized())
  return fake
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

describe('theme service', () => {
  it('readTheme returns the stored value and ignores an invalid or corrupt one', () => {
    const service = createSettingsService({ request: vi.fn() } as never, createStorageService())
    expect(service.readTheme()).toBeUndefined()
    window.localStorage.setItem(themeStorageKey, JSON.stringify('dark'))
    expect(service.readTheme()).toBe('dark')
    window.localStorage.setItem(themeStorageKey, JSON.stringify('purple'))
    expect(service.readTheme()).toBeUndefined()
    window.localStorage.setItem(themeStorageKey, '{not json')
    expect(service.readTheme()).toBeUndefined()
  })

  it('saveTheme writes the value and never throws when storage is unavailable', () => {
    const service = createSettingsService({ request: vi.fn() } as never, createStorageService())
    service.saveTheme('system')
    expect(stored()).toBe('"system"')
    const broken = createSettingsService({ request: vi.fn() } as never, createStorageService(() => undefined))
    expect(() => broken.saveTheme('dark')).not.toThrow()
  })

  it('clearCache keeps the device theme and removes cr.settings', () => {
    const service = createSettingsService({ request: vi.fn() } as never, createStorageService())
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ theme: 'dark' }))
    service.saveTheme('dark')
    service.clearCache()
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(stored()).toBe('"dark"')
  })
})

describe('theme on the sign-in pages', () => {
  it.each([
    [ROUTE_PATH.login, 'dark'],
    [ROUTE_PATH.register, 'dark'],
    [ROUTE_PATH.login, 'light'],
    [ROUTE_PATH.register, 'light']
  ] as const)('%s follows the stored device theme %s', async (route, value) => {
    window.localStorage.setItem(themeStorageKey, JSON.stringify(value))
    const { services } = realSettingsServices()
    await renderWithStoreSettled(<App />, { route, services, session: 'unknown' })
    expect(theme()).toBe(value)
  })

  it('shows light when nothing is stored', async () => {
    const { services } = realSettingsServices()
    await renderWithStoreSettled(<App />, { route: ROUTE_PATH.login, services, session: 'unknown' })
    expect(theme()).toBe('light')
  })

  it('system follows the OS preference live', async () => {
    let listener: () => void = () => {}
    const query = { matches: true, addEventListener: (_: string, fn: () => void) => (listener = fn), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', () => query)
    try {
      window.localStorage.setItem(themeStorageKey, JSON.stringify('system'))
      const { services } = realSettingsServices()
      await renderWithStoreSettled(<App />, { route: ROUTE_PATH.login, services, session: 'unknown' })
      expect(theme()).toBe('dark')
      query.matches = false
      act(() => listener())
      expect(theme()).toBe('light')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('theme is saved when it changes', () => {
  it.each(['dark', 'system', 'light'] as const)('writes cr.theme "%s" before the PUT answers, and keeps it when the PUT fails', async (value) => {
    const { services } = realSettingsServices()
    services.settings.save = vi.fn(() => Promise.reject(new Error('down')))
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: value }))
    expect(stored()).toBe(JSON.stringify(value))
    await settle()
    expect(stored()).toBe(JSON.stringify(value))
  })
})

describe('theme after the session resets', () => {
  it('sign-out keeps the theme, drops cr.settings and sends no PUT', async () => {
    const { services } = realSettingsServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    await settle()
    expect(services.settings.save).toHaveBeenCalledTimes(1)
    store.dispatch(sessionEnded())
    services.settings.clearCache()
    await settle()
    expect(store.getState().settings.theme).toBe('dark')
    expect(stored()).toBe('"dark"')
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(services.settings.save).toHaveBeenCalledTimes(1)
  })

  it('the account theme wins after the settings load and the device key follows', async () => {
    window.localStorage.setItem(themeStorageKey, JSON.stringify('light'))
    const { services } = realSettingsServices('dark')
    const store = createAppStore({ services, preloadedState: signedInState() })
    await store.dispatch(fetchSettings())
    expect(store.getState().settings.theme).toBe('dark')
    expect(stored()).toBe('"dark"')
  })
})
