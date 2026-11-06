import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/error.js'
import { isSafeRepoPath, parseGithubUrl } from '../src/lib/github-url.js'

// The hostile-link table of plan 023 (Validation, "Parser table"). The parser is pure: none of
// these cases touches the network.

const sha = '0123456789abcdef0123456789abcdef01234567'

function refusal(input: string): AppError {
  try {
    parseGithubUrl(input)
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error(`Accepted ${input}`)
}

describe('parseGithubUrl accepts', () => {
  it.each([
    ['a branch', 'https://github.com/octo-org/repo/blob/main/src/a.ts', 'main', ['src', 'a.ts']],
    ['a tag', 'https://github.com/octo/repo.js/blob/v1.2.0/lib/index.js', 'v1.2.0', ['lib', 'index.js']],
    ['a 40-hex commit SHA', `https://github.com/octo/repo/blob/${sha}/main.go`, sha, ['main.go']],
    ['a line fragment and a query', 'https://github.com/octo/repo/blob/main/a.py?plain=1#L10-L20', 'main', ['a.py']],
    ['an encoded space, decoded once', 'https://github.com/octo/repo/blob/main/my%20file.ts', 'main', ['my file.ts']],
    ['a double-encoded dot, decoded once only', 'https://github.com/octo/repo/blob/main/%252e%252e.ts', 'main', ['%2e%2e.ts']],
    ['surrounding white space', '  https://github.com/octo/repo/blob/main/a.ts\n', 'main', ['a.ts']]
  ])('a blob link with %s', (_label, input, ref, path) => {
    expect(parseGithubUrl(input)).toEqual({ kind: 'file', owner: expect.any(String), repo: expect.any(String), ref, path })
  })

  it('keeps the owner and repository as typed', () => {
    expect(parseGithubUrl('https://github.com/Octo-Org/My_Repo.v2/blob/main/a.ts'))
      .toMatchObject({ owner: 'Octo-Org', repo: 'My_Repo.v2' })
  })

  it.each([
    'https://github.com/octo/repo/pull/42',
    'https://github.com/octo/repo/pull/42/',
    'https://github.com/octo/repo/pull/42/files',
    'https://github.com/octo/repo/pull/42/files#diff-abc',
    'HTTPS://GITHUB.COM/octo/repo/pull/42'
  ])('a pull request link %s', (input) => {
    expect(parseGithubUrl(input)).toEqual({ kind: 'pull', owner: 'octo', repo: 'repo', number: 42 })
  })
})

describe('parseGithubUrl rejects with 422', () => {
  it.each([
    ['http', 'http://github.com/octo/repo/blob/main/a.ts'],
    ['a look-alike host', 'https://github.com.evil.com/octo/repo/blob/main/a.ts'],
    ['www', 'https://www.github.com/octo/repo/blob/main/a.ts'],
    ['user info', 'https://user@github.com/octo/repo/blob/main/a.ts'],
    ['user info after the host', 'https://github.com@evil.com/octo/repo/blob/main/a.ts'],
    ['a port', 'https://github.com:443/octo/repo/blob/main/a.ts'],
    ['raw.githubusercontent.com', 'https://raw.githubusercontent.com/octo/repo/main/a.ts'],
    ['gist.github.com', 'https://gist.github.com/octo/0123456789abcdef'],
    ['the API host', 'https://api.github.com/repos/octo/repo/contents/a.ts'],
    ['a protocol-relative link', '//github.com/octo/repo/blob/main/a.ts'],
    ['a tree link', 'https://github.com/octo/repo/tree/main/src'],
    ['a commit link', `https://github.com/octo/repo/commit/${sha}`],
    ['a compare link', 'https://github.com/octo/repo/compare/main...dev'],
    ['a path with ..', 'https://github.com/octo/repo/blob/main/../secret.ts'],
    ['a path with .', 'https://github.com/octo/repo/blob/main/./a.ts'],
    ['an encoded ..', 'https://github.com/octo/repo/blob/main/%2e%2e/secret.ts'],
    ['an encoded upper-case ..', 'https://github.com/octo/repo/blob/main/%2E%2E/secret.ts'],
    ['an encoded slash in the path', 'https://github.com/octo/repo/blob/main/src%2f..%2fa.ts'],
    ['an encoded slash in the owner', 'https://github.com/octo%2frepo/x/blob/main/a.ts'],
    ['an encoded slash in the ref (a branch with a slash)', 'https://github.com/octo/repo/blob/feature%2Fx/a.ts'],
    ['a backslash', 'https://github.com/octo/repo/blob/main/src\\a.ts'],
    ['an encoded backslash', 'https://github.com/octo/repo/blob/main/src%5ca.ts'],
    ['a NUL', 'https://github.com/octo/repo/blob/main/a\u0000.ts'],
    ['a lone surrogate (QA AI-46 D1)', 'https://github.com/octo/repo/blob/main/a\uD800.ts'],
    ['a lone low surrogate in the owner', 'https://github.com/oc\uDC00to/repo/blob/main/a.ts'],
    ['an encoded lone surrogate', 'https://github.com/octo/repo/blob/main/a%ED%A0%80.ts'],
    ['an encoded NUL', 'https://github.com/octo/repo/blob/main/a%00.ts'],
    ['an encoded line break', 'https://github.com/octo/repo/blob/main/a%0a.ts'],
    ['a space', 'https://github.com/octo/repo/blob/main/my file.ts'],
    ['an empty segment', 'https://github.com/octo/repo/blob/main/src//a.ts'],
    ['an empty owner', 'https://github.com//repo/blob/main/a.ts'],
    ['a trailing slash on a file', 'https://github.com/octo/repo/blob/main/a.ts/'],
    ['a missing repo', 'https://github.com/octo'],
    ['a missing kind', 'https://github.com/octo/repo'],
    ['a missing path', 'https://github.com/octo/repo/blob/main'],
    ['a malformed escape', 'https://github.com/octo/repo/blob/main/a%zz.ts'],
    ['a non-numeric PR number', 'https://github.com/octo/repo/pull/abc'],
    ['PR number 0', 'https://github.com/octo/repo/pull/0'],
    ['a PR number with a leading zero', 'https://github.com/octo/repo/pull/042'],
    ['a PR number over 10 digits', 'https://github.com/octo/repo/pull/12345678901'],
    ['a PR sub-page other than files', 'https://github.com/octo/repo/pull/42/commits'],
    ['an owner starting with a dash', 'https://github.com/-octo/repo/blob/main/a.ts'],
    ['an owner with two dashes', 'https://github.com/oc--to/repo/blob/main/a.ts'],
    ['an owner over 39 characters', `https://github.com/${'o'.repeat(40)}/repo/blob/main/a.ts`],
    ['a repo of ..', 'https://github.com/octo/../blob/main/a.ts'],
    ['a repo with a character outside the rule', 'https://github.com/octo/re$po/blob/main/a.ts'],
    ['a ref starting with a dot', 'https://github.com/octo/repo/blob/.hidden/a.ts'],
    ['a ref with ..', 'https://github.com/octo/repo/blob/a..b/a.ts'],
    ['a javascript: link', 'javascript:alert(1)'],
    ['a file: link', 'file:///etc/passwd'],
    ['an empty string', '']
  ])('%s', (_label, input) => {
    const error = refusal(input)
    expect(error.status).toBe(422)
    expect(error.code).toBe('validation_error')
    expect(error.details).toEqual({ issue: [{ field: 'url', message: expect.any(String) }] })
  })

  it('refuses a link over 2 000 characters, and accepts one at the limit', () => {
    // The path itself is capped at 1 000 characters, so the padding is an ignored fragment.
    const base = 'https://github.com/octo/repo/blob/main/a.ts#'
    const atLimit = `${base}${'L'.repeat(2000 - base.length)}`
    expect(atLimit).toHaveLength(2000)
    expect(() => parseGithubUrl(atLimit)).not.toThrow()
    expect(refusal(`${atLimit}x`).status).toBe(422)
  })

  it('refuses a file path over 1 000 characters, and accepts one at the limit', () => {
    const base = 'https://github.com/octo/repo/blob/main/'
    const path = `${'a'.repeat(996)}.ts`
    expect(path).toHaveLength(999)
    expect(() => parseGithubUrl(`${base}${path}`)).not.toThrow()
    expect(() => parseGithubUrl(`${base}a${path}`)).not.toThrow()
    expect(refusal(`${base}aa${path}`).status).toBe(422)
  })

  it('names the rule broken and never echoes the link', () => {
    const error = refusal('https://github.com.evil.com/secret-token/repo/blob/main/a.ts')
    expect(error.message).not.toContain('evil')
    expect(error.message).not.toContain('secret-token')
    expect(error.message).toMatch(/https:\/\/github\.com\//)
  })

  it('asks for a commit link when the branch name has a slash', () => {
    expect(refusal('https://github.com/octo/repo/blob/feature%2Fx/a.ts').message).toMatch(/commit/)
  })
})

describe('isSafeRepoPath (PR file names)', () => {
  it.each(['src/a.ts', 'a.ts', 'dir with space/a.py', '%2e%2e/a.ts'])('accepts %j', (path) => {
    expect(isSafeRepoPath(path)).toBe(true)
  })

  it.each(['', '../a.ts', 'src/../a.ts', './a.ts', 'src//a.ts', '/a.ts', 'a\\b.ts', 'a\u0000.ts', 'a\n.ts', 'src/a\uD800.ts', 'x'.repeat(1001)])('refuses %j', (path) => {
    expect(isSafeRepoPath(path)).toBe(false)
  })
})
