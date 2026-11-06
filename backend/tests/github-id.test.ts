import { describe, expect, it } from 'vitest'
import { decodeFileId, encodeFileId, isGithubRepoName, isGithubUsername } from '../src/lib/github-id.js'

// Plan 030, Validation: the user-name pattern and the file-id codec, pure and without network.

const idOf = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

describe('isGithubUsername', () => {
  it.each([
    ['octocat'],
    ['a'],
    ['a-b'],
    ['A1-b2-C3'],
    ['0'],
    ['x'.repeat(39)]
  ])('accepts %j', (value) => {
    expect(isGithubUsername(value)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['40 characters', 'x'.repeat(40)],
    ['a leading hyphen', '-octocat'],
    ['a trailing hyphen', 'octocat-'],
    ['a double hyphen', 'octo--cat'],
    ['only a hyphen', '-'],
    ['a space', 'octo cat'],
    ['a leading space', ' octocat'],
    ['a slash', 'octo/cat'],
    ['dot dot', '..'],
    ['a dot', 'octo.cat'],
    ['an underscore', 'octo_cat'],
    ['unicode letters', 'öctocat'],
    ['a Cyrillic look-alike', 'осtocat'],
    ['a NUL', 'octo\u0000cat'],
    ['a line break', 'octocat\n'],
    ['a percent escape', 'octo%2Fcat'],
    ['a query', 'octocat?x=1'],
    ['a host', 'evil.com@octocat']
  ])('refuses %s', (_label, value) => {
    expect(isGithubUsername(value)).toBe(false)
  })
})

describe('isGithubRepoName', () => {
  it.each([['demo'], ['my.repo'], ['my_repo-2'], ['.github'], ['x'.repeat(100)]])('accepts %j', (value) => {
    expect(isGithubRepoName(value)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['101 characters', 'x'.repeat(101)],
    ['a dot', '.'],
    ['dot dot', '..'],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a space', 'a b'],
    ['a NUL', 'a\u0000'],
    ['unicode', 'répo']
  ])('refuses %s', (_label, value) => {
    expect(isGithubRepoName(value)).toBe(false)
  })
})

describe('encodeFileId and decodeFileId', () => {
  it.each([
    ['src/greet.ts'],
    ['README.md'],
    ['a/b/c/d.py'],
    ['src/ünïcode/文件.ts'],
    ['src/%2e%2e/kept-as-text.ts'],
    ['﻿bom.ts'],
    ['x'.repeat(1000)]
  ])('round-trips %j, and the id is URL-safe', (path) => {
    const id = encodeFileId(path)

    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeFileId(id)).toBe(path)
  })

  it.each([
    ['a .. segment', idOf('src/../secret.ts')],
    ['a leading ..', idOf('../secret.ts')],
    ['a . segment', idOf('./a.ts')],
    ['a backslash', idOf('src\\a.ts')],
    ['a NUL', idOf('src/a\u0000.ts')],
    ['a control character', idOf('src/a\u001f.ts')],
    ['an empty segment', idOf('src//a.ts')],
    ['a leading slash', idOf('/etc/passwd')],
    ['a trailing slash', idOf('src/')],
    ['an empty path', ''],
    ['a path over 1 000 characters', idOf('x'.repeat(1001))],
    ['invalid UTF-8', Buffer.from([0x73, 0xff, 0x2e, 0x74, 0x73]).toString('base64url')],
    ['a lone surrogate in UTF-8 (CESU)', Buffer.from([0xed, 0xa0, 0x80]).toString('base64url')],
    ['standard base64 with +', 'ab+c'],
    ['standard base64 with /', 'ab/c'],
    ['padding', `${idOf('a.ts')}=`],
    ['a non-canonical id (stray bits)', 'YS50cx'],
    ['a dot', 'a.b'],
    ['a percent escape', '%2e%2e'],
    ['over 4 000 characters', 'A'.repeat(4001)]
  ])('refuses %s', (_label, id) => {
    expect(decodeFileId(id)).toBeUndefined()
  })
})
