import { beforeEach, describe, expect, it } from 'vitest'
import { AppSettings } from '../../src/models/settings.model'
import type { DataSource } from '../../src/services/data-source'
import { createSettingsService, settingsStorageKey } from '../../src/services/settings.service'
import { createStorageService } from '../../src/services/storage.service'

// Plan 028, QA R2-D6: once clearCache ran (sign-out, session ended), no request that started
// before it writes the previous account's settings back into cr.settings.

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// A data source whose every answer the test gives by hand.
function manualSource() {
  const answerList: ReturnType<typeof deferred<unknown>>[] = []
  const source: DataSource = {
    request<T>() {
      const answer = deferred<unknown>()
      answerList.push(answer)
      return answer.promise as Promise<T>
    }
  }
  return { source, answerList }
}

const dark = { ...AppSettings.defaultDto(), theme: 'dark' as const }
const cached = () => window.localStorage.getItem(settingsStorageKey)

beforeEach(() => {
  window.localStorage.clear()
})

describe('settings cache after clearCache', () => {
  it('get(): an answer that arrives after clearCache is returned but not cached', async () => {
    const { source, answerList } = manualSource()
    const service = createSettingsService(source, createStorageService())

    const loading = service.get()
    service.clearCache()
    answerList[0].resolve(dark)

    expect((await loading).theme).toBe('dark')
    expect(cached()).toBeNull()
  })

  it('get(): a request started after clearCache caches again', async () => {
    const { source, answerList } = manualSource()
    const service = createSettingsService(source, createStorageService())
    service.clearCache()

    const loading = service.get()
    answerList[0].resolve(dark)
    await loading

    expect(JSON.parse(cached() ?? '{}').theme).toBe('dark')
  })

  it('save(): caches when it starts, and a clearCache during the PUT stays cleared', async () => {
    const { source, answerList } = manualSource()
    const service = createSettingsService(source, createStorageService())

    const saving = service.save(dark)
    expect(JSON.parse(cached() ?? '{}').theme).toBe('dark')
    service.clearCache()
    answerList[0].resolve(undefined)
    await saving

    expect(cached()).toBeNull()
  })

  it('save(): a save after clearCache (the next account) is cached', async () => {
    const { source, answerList } = manualSource()
    const service = createSettingsService(source, createStorageService())
    service.clearCache()

    const saving = service.save(dark)
    answerList[0].resolve(undefined)
    await saving

    expect(JSON.parse(cached() ?? '{}').theme).toBe('dark')
  })
})
