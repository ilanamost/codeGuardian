// @vitest-environment node
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseGithubLink, type GithubLink } from '../../src/models/github.model'

// QA AI-46 re-verification of D3: the client shape check must accept exactly what the backend
// parser (backend/src/lib/github-url.ts) accepts, with the same parts. Differential: a fixed
// corpus of hostile and valid links, plus a seeded fuzzer over tricky tokens. No network.

type BackendLink =
  | { kind: 'file'; owner: string; repo: string; ref: string; path: string[] }
  | { kind: 'pull'; owner: string; repo: string; number: number }

let parseBackend: (input: string) => BackendLink

beforeAll(async () => {
  const module = (await import(/* @vite-ignore */ resolve(__dirname, '../../../backend/src/lib/github-url.ts'))) as {
    parseGithubUrl: (input: string) => BackendLink
  }
  parseBackend = module.parseGithubUrl
})

function backend(input: string): GithubLink | null {
  try {
    const link = parseBackend(input)
    return link.kind === 'file' ? { ...link, path: link.path.join('/') } : link
  } catch {
    return null
  }
}

const b = 'https://github.com'
const corpus = [
  // mixed case
  'HTTPS://GITHUB.COM/octo/repo/pull/1', 'https://GitHub.com/octo/repo/blob/main/a.ts', 'https://github.COM/Octo/Repo/blob/Main/A.TS',
  'https://github.com/octo/repo/BLOB/main/a.ts', 'https://github.com/octo/repo/Pull/1', 'https://github.com/octo/repo/pull/1/FILES',
  // trailing slashes
  `${b}/octo/repo/pull/1/`, `${b}/octo/repo/pull/1//`, `${b}/octo/repo/pull/1/files/`, `${b}/octo/repo/pull/1/files//`,
  `${b}/octo/repo/blob/main/a.ts/`, `${b}/octo/repo/blob/main/`, `${b}/octo/repo/`, `${b}/octo/repo/pull/`, `${b}/`,
  `${b}/octo/repo/pull/1/?x=1`, `${b}/octo/repo/pull/1/#files`,
  // spaces and white space
  `${b}/octo/repo/blob/main/my file.ts`, `${b}/octo/repo/blob/main/my%20file.ts`, `  ${b}/octo/repo/pull/1  `, `\t${b}/octo/repo/pull/1\n`,
  `${b}/octo/repo/blob/main/a .ts`, `${b}/octo/repo/blob/main/a　.ts`, `${b}/octo/repo/blob/main/a .ts`, `${b}/octo/repo/blob/main/a%09.ts`,
  `${b}/octo/repo/blob/main/a%E3%80%80.ts`, `${b}/octo/repo/blob/main/a﻿.ts`,
  // backslashes
  `${b}\\octo/repo/pull/1`, `${b}/octo/repo/blob/main/a\\b.ts`, `${b}/octo/repo/blob/main/a%5Cb.ts`, `${b}/octo/repo/blob/ma%5cin/a.ts`, 'https:\\\\github.com/octo/repo/pull/1',
  // owners
  `${b}/oc--to/repo/pull/1`, `${b}/octo-/repo/pull/1`, `${b}/-octo/repo/pull/1`, `${b}/o-c-t-o/repo/pull/1`, `${b}/${'o'.repeat(39)}/repo/pull/1`,
  `${b}/${'o'.repeat(40)}/repo/pull/1`, `${b}/oc%74o/repo/pull/1`, `${b}/oc%2Dto/repo/pull/1`, `${b}/oc_to/repo/pull/1`, `${b}/octo.x/repo/pull/1`,
  // repos
  `${b}/octo/./pull/1`, `${b}/octo/../pull/1`, `${b}/octo/.../pull/1`, `${b}/octo/%2e/pull/1`, `${b}/octo/.git/pull/1`, `${b}/octo/${'r'.repeat(100)}/pull/1`,
  `${b}/octo/${'r'.repeat(101)}/pull/1`, `${b}/octo/re%2Fpo/pull/1`,
  // refs
  `${b}/octo/repo/blob/v1.0.0/a.ts`, `${b}/octo/repo/blob/_x/a.ts`, `${b}/octo/repo/blob/-x/a.ts`, `${b}/octo/repo/blob/a..b/a.ts`, `${b}/octo/repo/blob/feature%2Fx/a.ts`,
  `${b}/octo/repo/blob/${'r'.repeat(100)}/a.ts`, `${b}/octo/repo/blob/${'r'.repeat(101)}/a.ts`, `${b}/octo/repo/blob/%6Dain/a.ts`, `${b}/octo/repo/blob/ma%zzin/a.ts`,
  // paths
  `${b}/octo/repo/blob/main/${'a'.repeat(997)}.ts`, `${b}/octo/repo/blob/main/${'a'.repeat(998)}.ts`, `${b}/octo/repo/blob/main/${'d/'.repeat(400)}a.ts`,
  `${b}/octo/repo/blob/main/${'%61'.repeat(600)}.ts`, `${b}/octo/repo/blob/main/%252e%252e/a.ts`, `${b}/octo/repo/blob/main/%2e%2e/a.ts`,
  `${b}/octo/repo/blob/main/.%2E/a.ts`, `${b}/octo/repo/blob/main/.../a.ts`, `${b}/octo/repo/blob/main/a%2fb.ts`, `${b}/octo/repo/blob/main/a%00.ts`,
  `${b}/octo/repo/blob/main/a%7f.ts`, `${b}/octo/repo/blob/main/a%C2%85.ts`, `${b}/octo/repo/blob/main/a‮.ts`, `${b}/octo/repo/blob/main/a%zz.ts`,
  `${b}/octo/repo/blob/main/a%.ts`, `${b}/octo/repo/blob/main/%F0%9F%98%80.ts`, `${b}/octo/repo/blob/main/😀.ts`,
  // malformed Unicode (D1)
  `${b}/octo/repo/blob/main/a\ud800.ts`, `${b}/octo/repo/blob/main/a\udc00.ts`, `${b}/oc\ud800to/repo/pull/1`, `${b}/octo/repo/pull/1#\ud800`,
  `${b}/octo/repo/blob/main/a.ts?x=\udfff`, `${b}/octo/repo/blob/main/a%ED%A0%80.ts`,
  // PR numbers and tails
  `${b}/octo/repo/pull/0`, `${b}/octo/repo/pull/01`, `${b}/octo/repo/pull/9999999999`, `${b}/octo/repo/pull/10000000000`, `${b}/octo/repo/pull/1e3`,
  `${b}/octo/repo/pull/+1`, `${b}/octo/repo/pull/%31`, `${b}/octo/repo/pull/1/commits`, `${b}/octo/repo/pull/1/files/x`, `${b}/octo/repo/pulls/1`,
  // hosts and schemes
  'http://github.com/octo/repo/pull/1', 'https://www.github.com/octo/repo/pull/1', 'https://github.com.evil.com/octo/repo/pull/1',
  'https://user@github.com/octo/repo/pull/1', 'https://github.com:443/octo/repo/pull/1', 'https://gіthub.com/octo/repo/pull/1',
  'https://github.com@evil.com/octo/repo/pull/1', '//github.com/octo/repo/pull/1', 'github.com/octo/repo/pull/1', '', ' ',
  // length
  `${b}/octo/repo/pull/1#${'x'.repeat(2000 - `${b}/octo/repo/pull/1#`.length)}`,
  `${b}/octo/repo/pull/1#${'x'.repeat(2001 - `${b}/octo/repo/pull/1#`.length)}`,
  ` ${b}/octo/repo/pull/1#${'x'.repeat(2000 - `${b}/octo/repo/pull/1#`.length)}`
]

// Raw unpaired surrogates (not percent-encoded): the backend refuses them with 422 (D1 fix).
const loneSurrogateList = [
  `${b}/octo/repo/blob/main/a\ud800.ts`, `${b}/octo/repo/blob/main/a\udc00.ts`, `${b}/octo/repo/pull/1#\ud800`, `${b}/octo/repo/blob/main/a.ts?x=\udfff`
]
for (const url of loneSurrogateList) corpus.splice(corpus.indexOf(url), 1)

describe('QA D3: parseGithubLink matches the backend parser', () => {
  it.each(corpus.map((url) => [JSON.stringify(url).slice(0, 120), url]))('%s', (_label, url) => {
    expect(parseGithubLink(url)).toEqual(backend(url))
  })

  // New defect D5 (re-verification): the D1 fix (`isWellFormed`) is in the backend parser only.
  it.each(loneSurrogateList.map((url) => [JSON.stringify(url), url]))('D5: refuses malformed Unicode %s, as the backend does', (_label, url) => {
    expect(parseGithubLink(url)).toEqual(backend(url))
  })

  it('agrees on 20 000 seeded random links built from tricky tokens', () => {
    const token = [
      '/', '//', '.', '..', '%2e', '%2E', '%2f', '%2F', '%5c', '\\', '%00', '%', '%zz', ' ', '%20', '\t', '?', '#', '@', ':', '-', '--', '_',
      'a', 'Z', '0', '1', 'files', 'blob', 'pull', 'main', '.ts', '.py', '😀', '\ud800', ' ', '%ED%A0%80', '%C3%A9', 'é', '%C2%85', '202e', 'A.TS', '%7f'
    ]
    let seed = 46
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pick = () => token[Math.floor(random() * token.length)]
    const prefixList = ['https://github.com/octo/repo/blob/main/', 'https://github.com/', 'HTTPS://GitHub.com/', 'https://github.com/octo/repo/', 'https://github.com/octo/repo/blob/', 'https://github.com/octo/repo/pull/']
    const mismatchList: string[] = []
    const malformedMismatchList: string[] = []
    for (let index = 0; index < 20_000; index += 1) {
      let url = prefixList[Math.floor(random() * prefixList.length)]
      const count = 1 + Math.floor(random() * 8)
      for (let part = 0; part < count; part += 1) url += pick()
      if (JSON.stringify(parseGithubLink(url)) === JSON.stringify(backend(url))) continue
      if (url.isWellFormed()) mismatchList.push(url)
      else malformedMismatchList.push(url)
    }
    expect(mismatchList.slice(0, 10)).toEqual([])
    // D5: every remaining mismatch is a raw unpaired surrogate the client accepts and the backend refuses.
    for (const url of malformedMismatchList) {
      expect(backend(url)).toBeNull()
      expect(parseGithubLink(url)).not.toBeNull()
    }
  })
})
