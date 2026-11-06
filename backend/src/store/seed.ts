import settingsSeed from '../data/settings.json' with { type: 'json' }
import settingsDefaultSeed from '../data/settings-default.json' with { type: 'json' }
import { hashPassword } from '../lib/password.js'
import type { Settings } from '../model/dto.js'
import type { AccountRecord } from './store.js'

// The defaults both stores start from and go back to on reset (`src/data/*.json`): the default
// settings and the demo account (`john.doe`, owner of the `default` org; plan 028, Open
// Question 8). There are no seeded reviews (plan 019 addendum). The demo password is a local
// demo credential only (README).

// Hashing is deliberately slow, so the seeded password is hashed once per process.
let seedPasswordHash: string | undefined

export function seedSettings(): Settings {
  return structuredClone(settingsDefaultSeed) as Settings
}

export function seedAccount(): AccountRecord {
  seedPasswordHash ??= hashPassword(settingsSeed.password)
  return {
    username: settingsSeed.account.username,
    fullName: settingsSeed.account.fullName,
    email: settingsSeed.account.email.toLowerCase(),
    memberSince: settingsSeed.account.memberSince,
    passwordHash: seedPasswordHash,
    avatarDigest: null,
    githubLogin: null
  }
}
