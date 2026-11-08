import type { AppConfig } from '../config.js'
import { createFakeGithubFetch } from './github-fake.js'
import { createGithubClient, type FetchLike, type GithubClient } from './github-fetch.js'

// The GitHub client `index.ts` hands to the app (plan 049). With GITHUB_FAKE it is the fake
// GitHub, which never gets the token; otherwise it is the real client on Node's `fetch` with
// `Authorization: Bearer <GITHUB_API_TOKEN>` when the setting is set. The token goes nowhere else.
export type GithubClientDependency = { fetch?: FetchLike, fakeFetch?: FetchLike }

export function createConfiguredGithubClient(config: Pick<AppConfig, 'githubFake' | 'githubApiToken'>, dependency: GithubClientDependency = {}): GithubClient {
  if (config.githubFake) return createGithubClient({ fetch: dependency.fakeFetch ?? createFakeGithubFetch() })
  return createGithubClient({
    fetch: dependency.fetch ?? globalThis.fetch,
    authorization: config.githubApiToken === undefined ? undefined : `Bearer ${config.githubApiToken}`
  })
}
