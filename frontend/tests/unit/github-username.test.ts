import { describe, expect, it } from 'vitest'
import { githubDisplayNameOf, isGithubUsername } from '../../src/models/github.model'
import { buildUserMessage, ERROR_CODE, ERROR_HINT, GITHUB_WIZARD_HINT } from '../../src/utils/error-messages'

// Plan 030, Validation "User name (unit table)": the same rule as the backend (contract GithubConnect).
describe('isGithubUsername', () => {
  it.each(['octocat', 'a', 'a-b', 'A1-b2-C3', 'x'.repeat(39)])('accepts %j', (value) => {
    expect(isGithubUsername(value)).toBe(true)
  })

  it.each(['', 'x'.repeat(40), '-a', 'a-', 'a--b', 'a b', ' a', 'a/b', '..', 'a.b', 'a_b', 'ö', 'a\u0000', 'a\n'])('refuses %j', (value) => {
    expect(isGithubUsername(value)).toBe(false)
  })
})

describe('githubDisplayNameOf', () => {
  it('uses the display name, else the user name', () => {
    expect(githubDisplayNameOf({ login: 'octocat', name: 'The Octocat' })).toBe('The Octocat')
    expect(githubDisplayNameOf({ login: 'octocat', name: null })).toBe('octocat')
    expect(githubDisplayNameOf({ login: 'octocat', name: '  ' })).toBe('octocat')
  })
})

describe('GitHub wizard error hints (plan 030)', () => {
  it.each([
    [ERROR_CODE.githubConnect, ERROR_CODE.notFound, GITHUB_WIZARD_HINT.userNotFound],
    [ERROR_CODE.githubConnect, ERROR_CODE.validation, GITHUB_WIZARD_HINT.usernameInvalid],
    [ERROR_CODE.githubConnect, ERROR_CODE.rateLimited, GITHUB_WIZARD_HINT.rateLimited],
    [ERROR_CODE.githubRepoLoad, ERROR_CODE.conflict, GITHUB_WIZARD_HINT.notConnected],
    [ERROR_CODE.githubFileLoad, ERROR_CODE.conflict, GITHUB_WIZARD_HINT.notConnected],
    [ERROR_CODE.githubFileLoad, ERROR_CODE.notFound, GITHUB_WIZARD_HINT.repoNotFound],
    [ERROR_CODE.githubFileImport, ERROR_CODE.conflict, GITHUB_WIZARD_HINT.notConnected],
    [ERROR_CODE.githubFileImport, ERROR_CODE.payloadTooLarge, GITHUB_WIZARD_HINT.fileChar],
    [ERROR_CODE.githubFileImport, ERROR_CODE.upstreamTimeout, ERROR_HINT.upstreamTimeout],
    [ERROR_CODE.githubDisconnect, ERROR_CODE.conflict, ERROR_HINT.conflict],
    [ERROR_CODE.reviewSave, ERROR_CODE.conflict, ERROR_HINT.conflict]
  ])('%s caused by %s ends with its hint', (code, cause, hint) => {
    expect(buildUserMessage(code, cause)).toMatch(new RegExp(`\\. ${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  })
})
