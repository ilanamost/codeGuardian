// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSyntaxChecker, hasSyntaxGrammar, type SyntaxErrorMark, type SyntaxWasmSource } from '../../src/lib/syntaxCheck'
import { languageList, SYNTAX_LIMIT, SYNTAX_TEXT } from '../../src/lib/review.constants'

// Plan 032: the syntax checker on the real tree-sitter grammars. The WebAssembly files are read
// from node_modules (the same files the app bundles), so no network is used.
const nodeModule = resolve(__dirname, '../../node_modules')
const bytes = (path: string) => new Uint8Array(readFileSync(resolve(nodeModule, path)))

const source: SyntaxWasmSource = {
  runtime: bytes('web-tree-sitter/web-tree-sitter.wasm'),
  grammar: {
    Python: bytes('tree-sitter-python/tree-sitter-python.wasm'),
    Go: bytes('tree-sitter-go/tree-sitter-go.wasm'),
    Java: bytes('tree-sitter-java/tree-sitter-java.wasm')
  }
}

const check = createSyntaxChecker(source)

type First = Pick<SyntaxErrorMark, 'startLine' | 'startColumn' | 'message'>

async function firstError(language: string, code: string): Promise<First | undefined> {
  const [first] = await check(language, code)
  return first && { startLine: first.startLine, startColumn: first.startColumn, message: first.message }
}

const validCode: Record<string, string> = {
  Python: [
    'import os',
    '',
    'class Shape:',
    '    """A shape."""',
    '',
    '    def __init__(self, name: str) -> None:',
    '        self.name = name  # the name',
    '',
    '    @property',
    '    def area(self):',
    "        if self.name == 'x':",
    '            return [i for i in range(3)]',
    '        elif True:',
    '            pass',
    '        else:',
    "            return {'a': (1, 2)}",
    '',
    'async def main():',
    '    try:',
    '        await run()',
    '    except Exception as error:',
    '        raise',
    '    finally:',
    '        print(f"{error!r}")',
    ''
  ].join('\n'),
  Go: [
    'package main',
    '',
    'import "fmt"',
    '',
    'type S struct {',
    '\tA int `json:"a"`',
    '}',
    '',
    'func (s *S) M(x ...int) (int, error) {',
    '\tfor i := range x {',
    '\t\tswitch i {',
    '\t\tcase 1:',
    '\t\t\tgo func() {}()',
    '\t\t}',
    '\t}',
    '\tm := map[string][]int{"a": {1}}',
    '\t_ = m',
    '\treturn 0, nil',
    '}',
    '',
    'func main() {',
    '\tfmt.Println("hi")',
    '}',
    ''
  ].join('\n'),
  Java: [
    'package a;',
    '',
    'import java.util.*;',
    '',
    'public class Main<T> {',
    '  private final List<String> list = new ArrayList<>();',
    '',
    '  @Override',
    '  public String toString() {',
    '    var s = "x";',
    '    for (int i = 0; i < 3; i++) { s += i; }',
    '    Runnable r = () -> System.out.println(s);',
    '    return switch (s) { case "a" -> "b"; default -> s; };',
    '  }',
    '}',
    ''
  ].join('\n')
}

// [name, language, code, first error]
const invalidTable: [string, string, string, First][] = [
  ['Python missing colon', 'Python', 'def f()\n    return 1\n', { startLine: 1, startColumn: 7, message: SYNTAX_TEXT.missing(':') }],
  ['Python missing colon in for', 'Python', 'for i in range(3)\n    print(i)\n', { startLine: 1, startColumn: 17, message: SYNTAX_TEXT.missing(':') }],
  ['Python missing closing bracket', 'Python', 'x = (1, 2\ny = 3\n', { startLine: 1, startColumn: 5, message: SYNTAX_TEXT.unclosed('(', ')') }],
  ['Python missing ) in parameters', 'Python', 'def f(:\n    pass\n', { startLine: 1, startColumn: 7, message: SYNTAX_TEXT.missing(')') }],
  ['Python unterminated string', 'Python', 's = "abc\nprint(s)\n', { startLine: 1, startColumn: 5, message: SYNTAX_TEXT.unterminatedString }],
  ['Python body not indented', 'Python', 'def f():\nreturn 1\n', { startLine: 2, startColumn: 1, message: SYNTAX_TEXT.expectedBlock }],
  ['Python unexpected indent in a block', 'Python', 'if x:\n    a = 1\n      b = 2\n', { startLine: 3, startColumn: 7, message: SYNTAX_TEXT.unexpectedIndent }],
  ['Python unexpected indent at the top', 'Python', 'x = 1\n  y = 2\n', { startLine: 2, startColumn: 3, message: SYNTAX_TEXT.unexpectedIndent }],
  ['Python stray )', 'Python', 'x = 1)\n', { startLine: 1, startColumn: 6, message: SYNTAX_TEXT.unexpected(')') }],
  ['Go missing }', 'Go', 'package main\n\nfunc main() {\n\tx := 1\n', { startLine: 4, startColumn: 7, message: SYNTAX_TEXT.missing('}') }],
  ['Go named func inside a func', 'Go', 'package main\n\nfunc main() {\n\tfunc inner() {}\n}\n', { startLine: 4, startColumn: 7, message: SYNTAX_TEXT.unexpected('inner') }],
  ['Go unterminated string', 'Go', 'package main\n\nfunc main() {\n\tfmt.Println("hi)\n}\n', { startLine: 4, startColumn: 14, message: SYNTAX_TEXT.unterminatedString }],
  ['Go stray }', 'Go', 'package main\n}\n', { startLine: 2, startColumn: 1, message: SYNTAX_TEXT.unexpected('}') }],
  ['Go unclosed (', 'Go', 'package main\n\nfunc (\n', { startLine: 3, startColumn: 6, message: SYNTAX_TEXT.unclosed('(', ')') }],
  ['Java missing semicolon', 'Java', 'class A {\n  void f() {\n    int x = 1\n  }\n}\n', { startLine: 3, startColumn: 13, message: SYNTAX_TEXT.missing(';') }],
  ['Java missing }', 'Java', 'class A {\n  void f() {\n    int x = 1;\n  }\n', { startLine: 4, startColumn: 3, message: SYNTAX_TEXT.missing('}') }],
  ['Java unterminated string', 'Java', 'class A {\n  String s = "abc;\n}\n', { startLine: 2, startColumn: 14, message: SYNTAX_TEXT.unterminatedString }],
  ['Java stray }', 'Java', 'class A {\n}\n}\n', { startLine: 3, startColumn: 1, message: SYNTAX_TEXT.unexpected('}') }],
  ['Java missing )', 'Java', 'class A {\n\tvoid f() { int y = (1 + 2; }\n}\n', { startLine: 2, startColumn: 27, message: SYNTAX_TEXT.missing(')') }]
]

describe('checkSyntax', () => {
  it('checks Python, Go and Java and leaves TypeScript and JavaScript to Monaco', async () => {
    expect(languageList.filter(hasSyntaxGrammar)).toEqual(['Python', 'Go', 'Java'])
    expect(await check('TypeScript', 'const x = )')).toEqual([])
    expect(await check('JavaScript', 'const x = )')).toEqual([])
  })

  it.each(Object.entries(validCode))('finds no error in valid %s code', async (language, code) => {
    expect(await check(language, code)).toEqual([])
  })

  it.each(invalidTable)('%s: points at the bad spot', async (_name, language, code, expected) => {
    expect(await firstError(language, code)).toEqual(expected)
  })

  it('marks a range on one line, with columns from 1 and an exclusive end', async () => {
    expect(await check('Java', 'class A {\n  void f() {\n    int x = 1\n  }\n}\n')).toEqual([
      { startLine: 3, startColumn: 13, endLine: 3, endColumn: 14, message: SYNTAX_TEXT.missing(';') }
    ])
  })

  it.each(['Python', 'Go', 'Java'])('finds no error in empty or blank %s code', async (language) => {
    expect(await check(language, '')).toEqual([])
    expect(await check(language, '  \n\t\n')).toEqual([])
  })

  it.each([
    ['Python', '# one\n# two\n'],
    ['Go', '// one\n/* two */\n'],
    ['Java', '// one\n/* two\n   three */\n']
  ])('finds no error in %s code that is only comments', async (language, code) => {
    expect(await check(language, code)).toEqual([])
  })

  it('counts columns in UTF-16 units, as the editor does (accents and emoji)', async () => {
    expect(await firstError('Python', 'name = "héllo 😀"\nx = )\n')).toEqual({ startLine: 2, startColumn: 5, message: SYNTAX_TEXT.unexpected(')') })
    expect(await firstError('Go', 'package main\n\nfunc main() {\n\ts := "😀😀" + )\n}\n')).toEqual({
      startLine: 4,
      startColumn: 16,
      message: SYNTAX_TEXT.unexpected(')')
    })
  })

  it('counts a tab as one column', async () => {
    expect(await firstError('Python', 'def f():\n\tif x:\n\t\treturn 1\n\treturn )\n')).toEqual({
      startLine: 4,
      startColumn: 9,
      message: SYNTAX_TEXT.unexpected(')')
    })
    expect(await firstError('Java', 'class A {\n\tvoid f() {\n\t\tint x = 1\n\t}\n}\n')).toEqual({ startLine: 3, startColumn: 11, message: SYNTAX_TEXT.missing(';') })
  })

  it('handles CRLF line breaks', async () => {
    expect(await firstError('Python', 'x = 1\r\ny = )\r\n')).toEqual({ startLine: 2, startColumn: 5, message: SYNTAX_TEXT.unexpected(')') })
  })

  it('finds an error at the end of a very long line', async () => {
    const line = `x = ${'1 + '.repeat(5000)}1)`
    const [mark] = await check('Python', `${line}\n`)
    expect(mark).toEqual({ startLine: 1, startColumn: line.length, endLine: 1, endColumn: line.length + 1, message: SYNTAX_TEXT.unexpected(')') })
  })

  it('checks a valid file of 100 000 characters without an error', async () => {
    const unit = 'x = 1\n'
    const code = `${unit.repeat(Math.floor(SYNTAX_LIMIT.contentMax / unit.length))}`.padEnd(SYNTAX_LIMIT.contentMax, '#')
    expect(code.length).toBe(SYNTAX_LIMIT.contentMax)
    expect(await check('Python', code)).toEqual([])
  })

  it('does not check code over 100 000 characters', async () => {
    const code = `x = )\n${'#'.repeat(SYNTAX_LIMIT.contentMax)}`
    expect(code.length).toBeGreaterThan(SYNTAX_LIMIT.contentMax)
    expect(await check('Python', code)).toEqual([])
  })

  it('marks at most 20 errors, the first by position', async () => {
    const body = Array.from({ length: 30 }, (_, index) => `    int x${index} = ${index}`).join('\n')
    const markList = await check('Java', `class A {\n  void f() {\n${body}\n  }\n}\n`)
    expect(markList).toHaveLength(SYNTAX_LIMIT.markMax)
    expect(markList.every((mark) => mark.message === SYNTAX_TEXT.missing(';'))).toBe(true)
    expect(markList.map((mark) => mark.startLine)).toEqual(Array.from({ length: 20 }, (_, index) => index + 3))
  })

  it('cuts a long token in the message', async () => {
    const name = 'a'.repeat(40)
    const [mark] = await check('Go', `package main\n\nfunc main() {\n\tfunc ${name}() {}\n}\n`)
    expect(mark.message).toBe(SYNTAX_TEXT.unexpected(`${'a'.repeat(SYNTAX_LIMIT.tokenMax)}…`))
  })

  it('checks 5 000 lines in well under the 100 ms long-task budget', async () => {
    const code = Array.from({ length: 5000 }, (_, index) => `x${index} = (${index} + 1) * 2`).join('\n')
    await check('Python', 'x = 1')
    const start = performance.now()
    expect(await check('Python', code)).toEqual([])
    expect(performance.now() - start).toBeLessThan(100)
  })

  it('rejects when a grammar cannot load, and keeps the other languages working', async () => {
    const broken = createSyntaxChecker({ ...source, grammar: { ...source.grammar, Go: new Uint8Array([0, 1, 2, 3]) } })
    await expect(broken('Go', 'package main\n')).rejects.toBeDefined()
    expect(await broken('Python', 'x = )\n')).toHaveLength(1)
  })
})
