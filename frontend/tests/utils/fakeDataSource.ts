import { vi } from 'vitest'
import type { DataSource, HttpMethod, RequestOption } from '../../src/services/data-source'

export type Respond = (method: HttpMethod, url: string, body?: unknown, option?: RequestOption) => unknown

// A DataSource whose answers come from `respond`; `call` records every request so tests can
// check the method, url, body and option a service sent.
export function createFakeDataSource(respond: Respond = () => undefined) {
  const call = vi.fn<Respond>(respond)
  const source: DataSource = {
    request: async <T>(method: HttpMethod, url: string, body?: unknown, option?: RequestOption) => (await call(method, url, body, option)) as T
  }
  return { source, call }
}

// The same answer for every request.
export function answering(value: unknown) {
  return createFakeDataSource(() => value)
}
