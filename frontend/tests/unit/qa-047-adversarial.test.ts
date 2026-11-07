import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COOKIE_BLOCKED_WINDOW_MS } from '../../src/lib/session.constants'
import { AppError } from '../../src/models/app-error'
import { createAppStore } from '../../src/store'
import { fetchDashboard } from '../../src/store/dashboard.slice'
import { initialSessionState, signIn } from '../../src/store/session.slice'
import { SESSION_ERROR_MESSAGE } from '../../src/utils/error-messages'
import { createFakeServices } from '../utils/fakeServices'
import { settle } from '../utils/renderWithStore'

// QA plan 047: try to break the zoom fix and the cookieBlocked window.

afterEach(() => {
  vi.useRealTimers()
})

const unauthorized = () => AppError.fromResponse(401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } })

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.tsx') ? [path] : []
  })
}

describe('every visible text control is 16px on phones', () => {
  it('no <input>, <textarea> or <select> that shows text keeps a bare text-sm or text-xs', () => {
    const offender: string[] = []
    for (const file of walk(join(__dirname, '../../src'))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<(input|textarea|select)\b[\s\S]*?\/>/g)) {
        const tag = match[0]
        if (/type="(checkbox|radio|file)"/.test(tag) || /\bhidden\b/.test(tag)) continue
        if (/(^|[\s"`'])text-(sm|xs)\b/.test(tag) && !/text-base/.test(tag)) offender.push(`${file}: ${tag.slice(0, 80)}`)
        if (!/text-base|inputClass|\$\{|\{\.\.\./.test(tag)) offender.push(`${file}: no text-base in ${tag.slice(0, 80)}`)
      }
    }
    expect(offender).toEqual([])
  })
})

describe('cookieBlocked window edges', () => {
  function setup() {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fake = createFakeServices()
    const store = createAppStore({ services: fake.services, preloadedState: { session: { ...initialSessionState(), status: 'signedOut' } } })
    fake.services.dashboard.get.mockRejectedValue(unauthorized())
    return { ...fake, store }
  }

  it('exactly at the window limit still reads as cookieBlocked', async () => {
    const { store, toast } = setup()
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    vi.setSystemTime(Date.now() + COOKIE_BLOCKED_WINDOW_MS)
    await store.dispatch(fetchDashboard())
    await settle()
    expect(toast.error).toHaveBeenCalledWith(SESSION_ERROR_MESSAGE.cookieBlocked)
  })

  it('one millisecond past the window reads as sessionEnded', async () => {
    const { store, toast } = setup()
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    vi.setSystemTime(Date.now() + COOKIE_BLOCKED_WINDOW_MS + 1)
    await store.dispatch(fetchDashboard())
    await settle()
    expect(toast.error).toHaveBeenCalledWith(SESSION_ERROR_MESSAGE.sessionEnded)
  })

  it('a second sign-in after an old session end is judged on its own time, not the first', async () => {
    const { store, toast } = setup()
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    vi.setSystemTime(Date.now() + 60_000)
    await store.dispatch(fetchDashboard())
    await settle()
    expect(toast.error).toHaveBeenLastCalledWith(SESSION_ERROR_MESSAGE.sessionEnded)

    vi.setSystemTime(Date.now() + 60_000)
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    await store.dispatch(fetchDashboard())
    await settle()
    expect(toast.error).toHaveBeenLastCalledWith(SESSION_ERROR_MESSAGE.cookieBlocked)
  })

  it('a late 401 after an early, already-reported one does not reuse the stale sign-in time', async () => {
    const { store, toast } = setup()
    await store.dispatch(signIn({ username: 'john.doe', password: 'x' }))
    await store.dispatch(fetchDashboard())
    await settle()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(store.getState().session.status).toBe('signedOut')
    await store.dispatch(fetchDashboard())
    await settle()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
