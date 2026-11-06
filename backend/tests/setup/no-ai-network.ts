import { env } from 'node:process'

// Plan 039: no test may reach the real Anthropic API, and no test run holds a key. The guard
// fails any `fetch` to an anthropic.com host (a test that wants the SDK's own retry loop passes
// the SDK a fake `fetch` of its own, so nothing leaves the machine).
delete env.ANTHROPIC_API_KEY
delete env.ANTHROPIC_AUTH_TOKEN
delete env.ANTHROPIC_BASE_URL
delete env.ANTHROPIC_MODEL

const blockedHost = /(^|\.)anthropic\.com$/i
const realFetch = globalThis.fetch

function hostOf(input: Parameters<typeof fetch>[0]): string {
  try {
    if (typeof input === 'string') return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    return new URL(input.url).hostname
  } catch {
    return ''
  }
}

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (blockedHost.test(hostOf(input))) {
    return Promise.reject(new Error('Tests must not reach the Anthropic API: inject a fake client.'))
  }
  return realFetch(input, init)
}) as typeof fetch
