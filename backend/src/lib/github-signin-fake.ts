import { GithubSignInError, type GithubProfile, type GithubSignInClient } from './github-signin-client.js'

// The in-memory GitHub sign-in client (plan 040): tests and the e2e backend never reach
// github.com. The "authorization code" the callback receives picks the profile; an unknown code,
// or a code mapped to `null`, fails like a GitHub error (`provider_error`).

export type FakeProfileTable = Record<string, GithubProfile | null>

// The codes the e2e backend (GITHUB_OAUTH_FAKE=true) answers; the profiles are made up.
export const FAKE_SIGNIN_PROFILE: FakeProfileTable = {
  'fake-octocat': { id: '583231', login: 'fake-octocat', name: 'The Octocat', email: 'fake-octocat@example.com', emailVerified: true },
  'fake-unverified': { id: '583232', login: 'fake-unverified', name: null, email: null, emailVerified: false },
  'fake-broken': null
}

export type FakeGithubSignInClient = GithubSignInClient & {
  // Every call the callback made, in order: the code and verifier it exchanged, the token it
  // read the profile with.
  exchangeList: { code: string, verifier: string }[]
  profileList: string[]
  // Adds or replaces a profile for a code (a test arranges a user before the callback).
  set(code: string, profile: GithubProfile | null): void
}

export function createFakeGithubSignInClient(table: FakeProfileTable = {}): FakeGithubSignInClient {
  const profileByCode = new Map<string, GithubProfile | null>(Object.entries(table))
  const exchangeList: { code: string, verifier: string }[] = []
  const profileList: string[] = []
  return {
    exchangeList,
    profileList,
    set(code, profile) {
      profileByCode.set(code, profile)
    },
    async exchangeCode(code, verifier) {
      exchangeList.push({ code, verifier })
      if (!profileByCode.get(code)) throw new GithubSignInError()
      return `fake-token-for-${code}`
    },
    async fetchProfile(accessToken) {
      profileList.push(accessToken)
      const profile = profileByCode.get(accessToken.replace(/^fake-token-for-/, ''))
      if (!profile) throw new GithubSignInError()
      return { ...profile }
    }
  }
}
