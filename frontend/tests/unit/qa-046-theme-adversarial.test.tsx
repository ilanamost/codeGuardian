import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { ROUTE_PATH } from '../../src/lib/route.constants'
import { AppSettings } from '../../src/models/settings.model'
import { createSettingsService, settingsStorageKey, themeStorageKey } from '../../src/services/settings.service'
import { createStorageService } from '../../src/services/storage.service'
import { createAppStore } from '../../src/store'
import { fetchSettings, settingsUpdated } from '../../src/store/settings.slice'
import { sessionEnded, signOut } from '../../src/store/session.slice'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStoreSettled, settle, signedInState } from '../utils/renderWithStore'

// QA plan 046: try to break the device theme (corrupt values, unavailable storage, rapid
// switching, account switching, no PUT while signed out).

vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

const theme = () => document.documentElement.dataset.theme
const stored = () => window.localStorage.getItem(themeStorageKey)

function realServices(serverTheme: 'light' | 'dark' | 'system' = 'light') {
  const fake = createFakeServices()
  const request = vi.fn(async (_method: string, path: string) => {
    if (path.includes('settings')) return { ...AppSettings.defaultDto(), theme: serverTheme }
    return undefined
  })
  const settings = createSettingsService({ request } as never, createStorageService())
  Object.assign(fake.services, { settings: { ...settings, get: vi.fn(settings.get), save: vi.fn(settings.save) } })
  fake.services.session.restore.mockRejectedValue(new Error('no session'))
  fake.services.session.signOut.mockResolvedValue(undefined)
  return { ...fake, request }
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('corrupt cr.theme', () => {
  it.each(['42', 'null', '[]', '{"theme":"dark"}', '""', '"DARK"', '"dark "', '{not json', JSON.stringify('x'.repeat(100000)), 'true'])(
    'ignores %s and renders /login with the default',
    async (raw) => {
      window.localStorage.setItem(themeStorageKey, raw)
      const { services } = realServices()
      await renderWithStoreSettled(<App />, { route: ROUTE_PATH.login, services, session: 'unknown' })
      expect(theme()).toBe('light')
    }
  )

  it('falls back to the cr.settings theme when cr.theme is corrupt', async () => {
    window.localStorage.setItem(themeStorageKey, '"purple"')
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({ ...AppSettings.defaultDto(), theme: 'dark' }))
    const { services } = realServices()
    await renderWithStoreSettled(<App />, { route: ROUTE_PATH.login, services, session: 'unknown' })
    expect(theme()).toBe('dark')
  })
})

describe('storage unavailable', () => {
  it('setItem throwing does not break a theme change or the app', async () => {
    const { services } = realServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => store.dispatch(settingsUpdated({ theme: 'dark' }))).not.toThrow()
    await settle()
    expect(store.getState().settings.theme).toBe('dark')
  })

  it('getItem throwing: /login still renders with the default theme', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const { services } = realServices()
    await renderWithStoreSettled(<App />, { route: ROUTE_PATH.login, services, session: 'unknown' })
    expect(theme()).toBe('light')
  })

  it('no readable storage: a session end does not throw', async () => {
    const { services } = realServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gone')
    })
    expect(() => store.dispatch(sessionEnded())).not.toThrow()
    await settle()
    expect(['light', 'dark']).toContain(store.getState().settings.theme)
  })
})

describe('rapid switching', () => {
  it('60 quick changes leave cr.theme and the state on the last value, with a failing PUT', async () => {
    const { services } = realServices()
    services.settings.save = vi.fn(() => Promise.reject(new Error('down')))
    const store = createAppStore({ services, preloadedState: signedInState() })
    const values = ['dark', 'light', 'system'] as const
    for (let i = 0; i < 60; i++) {
      store.dispatch(settingsUpdated({ theme: values[i % 3] }))
      expect(stored()).toBe(JSON.stringify(values[i % 3]))
    }
    await settle()
    expect(store.getState().settings.theme).toBe('system')
    expect(stored()).toBe('"system"')
  })

  it('a slow GET answer racing a user choice leaves state and cr.theme in agreement', async () => {
    const { services } = realServices('light')
    const store = createAppStore({ services, preloadedState: signedInState() })
    const pending = store.dispatch(fetchSettings())
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    await pending
    await settle()
    expect(stored()).toBe(JSON.stringify(store.getState().settings.theme))
  })
})

describe('sign-out and account switch', () => {
  it('sign-out via the thunk keeps theme, clears cr.settings, sends no settings PUT while signed out', async () => {
    const { services, request } = realServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    await settle()
    const puts = () => request.mock.calls.filter(([m, p]) => m === 'PUT' && String(p).includes('settings')).length
    const before = puts()
    await store.dispatch(signOut())
    await settle()
    expect(store.getState().settings.theme).toBe('dark')
    expect(stored()).toBe('"dark"')
    expect(window.localStorage.getItem(settingsStorageKey)).toBeNull()
    expect(puts()).toBe(before)
    expect(services.settings.save).toHaveBeenCalledTimes(1)
  })

  it('session expiry keeps the theme and sends no PUT; repeated resets are stable', async () => {
    const { services } = realServices()
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: 'system' }))
    await settle()
    for (let i = 0; i < 5; i++) store.dispatch(sessionEnded())
    await settle()
    expect(store.getState().settings.theme).toBe('system')
    expect(stored()).toBe('"system"')
    expect(services.settings.save).toHaveBeenCalledTimes(1)
  })

  it('account A dark signs out, account B (server light) loads: B wins and cr.theme follows', async () => {
    const { services } = realServices('light')
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    await settle()
    store.dispatch(sessionEnded())
    await settle()
    expect(store.getState().settings.theme).toBe('dark')
    await store.dispatch(fetchSettings())
    await settle()
    expect(store.getState().settings.theme).toBe('light')
    expect(stored()).toBe('"light"')
  })

  it('a failing GET for the next account leaves the device theme in place', async () => {
    window.localStorage.setItem(themeStorageKey, '"dark"')
    const { services } = realServices('light')
    services.settings.get = vi.fn(() => Promise.reject(new Error('down')))
    const store = createAppStore({ services, preloadedState: signedInState() })
    await store.dispatch(fetchSettings())
    await settle()
    expect(store.getState().settings.theme).toBe('dark')
    expect(stored()).toBe('"dark"')
  })

  it('a late settings answer of the previous session cannot overwrite cr.theme after the reset', async () => {
    const { services } = realServices('light')
    let release: (value: unknown) => void = () => {}
    services.settings.get = vi.fn(() => new Promise((resolve) => (release = resolve)) as never)
    const store = createAppStore({ services, preloadedState: signedInState() })
    store.dispatch(settingsUpdated({ theme: 'dark' }))
    const pending = store.dispatch(fetchSettings())
    store.dispatch(sessionEnded())
    release({ ...AppSettings.defaultDto(), theme: 'light' })
    await pending
    await settle()
    expect(stored()).toBe('"dark"')
    expect(store.getState().settings.theme).toBe('dark')
  })
})
