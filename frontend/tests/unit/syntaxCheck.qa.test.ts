// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSyntaxChecker, type SyntaxWasmSource } from '../../src/lib/syntaxCheck'
import { SYNTAX_LIMIT, SYNTAX_TEXT } from '../../src/lib/review.constants'

// QA adversarial pass for plan 032: the checker on the real grammars (read from node_modules, no
// network). Modern syntax must not false-alarm; broken code must be found at the right spot; odd
// input (deep nesting, garbage, BOM, NUL, surrogates, the size limit) must never throw. Known gaps
// and QA findings are recorded with it.fails: when one is fixed, that test turns red and moves to
// a plain it.
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

// [name, language, code]: valid modern code that must give no mark.
const valid: [string, string, string][] = [
  ['py match', 'Python', 'match cmd:\n    case [x, y, *rest]:\n        pass\n    case {"k": v} if v > 0:\n        pass\n    case Point(x=0) | None:\n        pass\n    case _:\n        pass\n'],
  ['py walrus', 'Python', 'if (n := len(a)) > 10:\n    print(n)\n'],
  ['py fstring nested', 'Python', 'x = f"{a!r:>10} {b:{w}.{p}f} {{lit}}"\n'],
  ['py fstring 312 quotes', 'Python', 'x = f"{d["k"]}"\n'],
  ['py async', 'Python', 'async def f():\n    async with a as b:\n        async for x in b:\n            await x\n    return [y async for y in g()]\n'],
  ['py type params 312', 'Python', 'def first[T](xs: list[T]) -> T:\n    return xs[0]\n\ntype Alias = list[int]\n'],
  ['py except star', 'Python', 'try:\n    pass\nexcept* ValueError as eg:\n    pass\n'],
  ['py posonly kwonly', 'Python', 'def f(a, /, b, *, c=1, **kw):\n    pass\n'],
  ['py decorators', 'Python', '@app.route("/x", methods=["GET"])\n@functools.cache\ndef f():\n    pass\n'],
  ['py lambda star', 'Python', 'f = lambda *a, **k: (a, k)\nfirst, *rest = [1, 2, 3]\nprint(*rest, sep="")\n'],
  ['py global nonlocal', 'Python', 'def f():\n    x = 1\n    def g():\n        nonlocal x\n        global y\n        x += 1\n    return g\n'],
  ['py yield from', 'Python', 'def g():\n    yield from range(3)\n    x = yield\n'],
  ['py one-line blocks', 'Python', 'if x: a = 1\nelif y: a = 2\nelse: a = 3\nfor i in r: pass\nclass A: ...\n'],
  ['py continuation', 'Python', 'x = foo(1,\n        2)\ny = 1 + \\\n    2\nz = [\n  1,\n      2,\n]\n'],
  ['py semicolons', 'Python', 'a = 1; b = 2\nif a: c = 1; d = 2\n'],
  ['py comments odd indent', 'Python', 'def f():\n        # odd comment\n    x = 1\n  # another\n    return x\n# top\n'],
  ['py multiline string', 'Python', 'def f():\n    s = """\nnot indented\n  at all\n"""\n    return s\n'],
  ['py nested defs', 'Python', 'class A:\n    class B:\n        def c(self):\n            if x:\n                while y:\n                    with z:\n                        pass\n'],
  ['py unicode ident', 'Python', 'café = 1\nπ = 3.14\nprint(café + π)\n'],
  ['py tabs', 'Python', 'def f():\n\tif x:\n\t\treturn 1\n\treturn 2\n'],
  ['py crlf', 'Python', 'def f():\r\n    return 1\r\n\r\nx = f()\r\n'],
  ['py no trailing newline', 'Python', 'def f():\n    return 1'],
  ['py dict set comp', 'Python', 'a = {k: v for k, v in d.items() if v}\nb = {x for x in y}\nc = (x for x in y)\n'],
  ['py print chevron py2', 'Python', 'print("ok")\n'],
  ['py try else', 'Python', 'try:\n    pass\nexcept (A, B):\n    pass\nelse:\n    pass\nfinally:\n    pass\n'],
  ['py assert raise from', 'Python', 'assert x, "msg"\nraise ValueError("x") from None\ndel a[0], b\n'],
  ['py match as soft keyword var', 'Python', 'match = 1\ncase = 2\ntype = 3\nprint(match, case, type)\n'],
  ['py ellipsis slice', 'Python', 'a[..., 1:2:3]\nx: int\ny: "Forward" = None\n'],
  ['py bytes raw strings', 'Python', "a = rb'\\d+'\nb = br\"x\"\nc = u'x'\nd = '''multi\nline'''\n"],
  ['py conditional import', 'Python', 'try:\n    import a\nexcept ImportError:\n    a = None\nfrom . import b\nfrom ..c import d as e\n'],
  ['py if with comment-only line inside', 'Python', 'if x:\n    a = 1\n\n    # c\n\n    b = 2\n'],
  ['py class body docstring only', 'Python', 'class A:\n    """Doc."""\n'],
  ['go generics', 'Go', 'package main\n\ntype Number interface {\n\t~int | ~float64\n}\n\nfunc Sum[T Number](xs []T) T {\n\tvar s T\n\tfor _, x := range xs {\n\t\ts += x\n\t}\n\treturn s\n}\n\nfunc Map[T, U any](s []T, f func(T) U) []U { return nil }\n\ntype List[T any] struct{ items []T }\n\nfunc (l *List[T]) Push(x T) { l.items = append(l.items, x) }\n\nvar _ = Sum[int]([]int{1})\n'],
  ['go range int 122', 'Go', 'package main\n\nfunc main() {\n\tfor i := range 10 {\n\t\t_ = i\n\t}\n\tfor range 3 {\n\t}\n}\n'],
  ['go select chan', 'Go', 'package main\n\nfunc main() {\n\tch := make(chan int, 1)\n\tdone := make(<-chan struct{})\n\tselect {\n\tcase v := <-ch:\n\t\t_ = v\n\tcase <-done:\n\tdefault:\n\t}\n\tch <- 1\n}\n'],
  ['go type switch labels', 'Go', 'package main\n\nfunc f(x any) {\nouter:\n\tfor {\n\t\tswitch v := x.(type) {\n\t\tcase int, string:\n\t\t\t_ = v\n\t\t\tbreak outer\n\t\tcase nil:\n\t\t\tgoto end\n\t\t}\n\t}\nend:\n}\n'],
  ['go raw strings runes', 'Go', 'package main\n\nvar a = `raw\nmulti ${x} "q"`\nvar b = \'\\n\'\nvar c = \'😀\'\nconst (\n\tA = iota\n\tB\n)\n'],
  ['go composite if', 'Go', 'package main\n\ntype T struct{ A int }\n\nfunc main() {\n\tif x := (T{A: 1}); x.A > 0 {\n\t}\n\ts := struct{ X, Y int }{1, 2}\n\t_ = s\n\tdefer func() { recover() }()\n}\n'],
  ['go embedding iface', 'Go', 'package main\n\nimport (\n\t"fmt"\n\tio "io"\n\t_ "embed"\n)\n\ntype RW interface {\n\tio.Reader\n\tWrite(p []byte) (n int, err error)\n}\n\ntype S struct {\n\t*fmt.Stringer\n}\n'],
  ['go unicode ident', 'Go', 'package main\n\nfunc main() {\n\tπ := 3.14\n\tcafé := "x"\n\t_, _ = π, café\n}\n'],
  ['go no package (snippet)', 'Go', 'func main() {\n\tx := 1\n\t_ = x\n}\n'],
  ['go crlf', 'Go', 'package main\r\n\r\nfunc main() {\r\n}\r\n'],
  ['go min max clear', 'Go', 'package main\n\nfunc main() {\n\tm := map[int]int{}\n\tclear(m)\n\t_ = min(1, 2)\n}\n'],
  ['java record', 'Java', 'record Point(int x, int y) {\n  Point {\n    if (x < 0) throw new IllegalArgumentException();\n  }\n  static Point origin() { return new Point(0, 0); }\n}\n'],
  ['java sealed', 'Java', 'sealed interface Shape permits Circle, Square {}\nfinal class Circle implements Shape {}\nnon-sealed class Square implements Shape {}\n'],
  ['java text block', 'Java', 'class A {\n  String s = """\n      Hello "world"\n        \\\n      end""";\n}\n'],
  ['java switch expr yield', 'Java', 'class A {\n  int f(int d) {\n    return switch (d) {\n      case 1, 2 -> 10;\n      case 3 -> { yield 20; }\n      default -> {\n        int x = d * 2;\n        yield x;\n      }\n    };\n  }\n}\n'],
  ['java pattern switch', 'Java', 'class A {\n  String f(Object o) {\n    return switch (o) {\n      case Integer i when i > 0 -> "pos";\n      case String s -> s;\n      case null -> "null";\n      default -> "x";\n    };\n  }\n}\n'],
  ['java record pattern', 'Java', 'class A {\n  void f(Object o) {\n    if (o instanceof Point(int x, int y)) {}\n    if (o instanceof String s && !s.isEmpty()) {}\n  }\n}\n'],
  ['java generics wildcard', 'Java', 'import java.util.*;\nclass A<T extends Comparable<? super T>> {\n  <U> List<? extends U> f(Map<String, List<U>> m) { return null; }\n  int[][] grid = new int[3][];\n}\n'],
  ['java enum iface default', 'Java', 'enum Color {\n  RED("r") { @Override String code() { return "R"; } }, GREEN("g");\n  private final String c;\n  Color(String c) { this.c = c; }\n  String code() { return c; }\n}\ninterface I { default void m() {} static int s() { return 1; } private void p() {} }\n'],
  ['java try resources multicatch', 'Java', 'class A {\n  void f() throws Exception {\n    try (var in = open(); var out = open()) {\n    } catch (IOException | RuntimeException e) {\n    } finally {}\n  }\n}\n'],
  ['java anonymous lambda ref', 'Java', 'class A {\n  Runnable r = new Runnable() { public void run() {} };\n  java.util.function.Function<String, Integer> f = String::length;\n  Comparator<String> c = (var a, var b) -> a.compareTo(b);\n}\n'],
  ['java annotations', 'Java', '@SuppressWarnings({"unchecked", "rawtypes"})\n@Target(ElementType.METHOD)\npublic @interface Ann { String value() default ""; int[] n() default {}; }\n'],
  ['java statements only (snippet)', 'Java', 'int x = 1;\nSystem.out.println(x);\n'],
  ['java method only (snippet)', 'Java', 'public static void main(String[] args) {\n  System.out.println("hi");\n}\n'],
  ['java unicode ident', 'Java', 'class Café {\n  int π = 3;\n  String s = "😀";\n}\n'],
  ['java var lambda labeled', 'Java', 'class A {\n  void f() {\n    outer:\n    for (var e : list) {\n      for (;;) { continue outer; }\n    }\n    do { } while (false);\n    assert x : "m";\n    synchronized (this) {}\n  }\n}\n'],
  ['java unnamed var 22', 'Java', 'class A {\n  void f() {\n    try { } catch (Exception _) { }\n    for (int _ : list) {}\n  }\n}\n'],
  ['java module info', 'Java', 'module com.example {\n  requires java.base;\n  exports com.example.api;\n}\n'],
  ['java char literals hex', 'Java', 'class A {\n  char c = \'\\u0041\';\n  long l = 0xFF_FFL;\n  double d = 1e-3d;\n  int b = 0b1010;\n}\n']
]

const invalid: [string, string, string][] = [
  ['py missing colon if', 'Python', 'x = 1\nif x > 0\n    print(x)\n'],
  ['py missing colon class', 'Python', 'class A\n    pass\n'],
  ['py missing colon else', 'Python', 'if x:\n    pass\nelse\n    pass\n'],
  ['py unclosed [', 'Python', 'a = [1, 2\nb = 3\n'],
  ['py unclosed {', 'Python', 'a = {"k": 1\n'],
  ['py mismatched', 'Python', 'a = (1, 2]\n'],
  ['py unterminated single', 'Python', "x = 'abc\n"],
  ['py unterminated triple', 'Python', 'x = """abc\ny = 1\n'],
  ['py unterminated fstring', 'Python', 'x = f"abc {y}\n'],
  ['py bad keyword use', 'Python', 'def = 1\n'],
  ['py return outside expr', 'Python', 'x = return 1\n'],
  ['py two exprs', 'Python', 'x = 1 2\n'],
  ['py dedent wrong level', 'Python', 'def f():\n    if x:\n        a = 1\n  b = 2\n'],
  ['py elif without if', 'Python', 'elif x:\n    pass\n'],
  ['py empty block at EOF', 'Python', 'def f():\n'],
  ['py stray ]', 'Python', 'print(1)]\n'],
  ['py lambda bad', 'Python', 'f = lambda x: return x\n'],
  ['py walrus top level bare', 'Python', 'x := 1\n'],
  ['py unclosed call deep line', 'Python', 'def f():\n    return g(1,\n             2\n\nx = 1\n'],
  ['py whole file indented', 'Python', '    x = 1\n    y = 2\n    z = 3\n'],
  ['py tab then spaces', 'Python', 'if x:\n\ta = 1\n        b = 2\n'],
  ['go missing {', 'Go', 'package main\n\nfunc main()\n\tx := 1\n}\n'],
  ['go brace on next line', 'Go', 'package main\n\nfunc main()\n{\n}\n'],
  ['go if brace next line', 'Go', 'package main\n\nfunc main() {\n\tif x\n\t{\n\t}\n}\n'],
  ['go := at top', 'Go', 'package main\n\nx := 1\n'],
  ['go missing )', 'Go', 'package main\n\nfunc main() {\n\tfmt.Println("a"\n}\n'],
  ['go bad for', 'Go', 'package main\n\nfunc main() {\n\tfor i := 0; i < 3 {\n\t}\n}\n'],
  ['go unterminated raw', 'Go', 'package main\n\nvar s = `abc\n'],
  ['go func keyword misuse', 'Go', 'package main\n\nfunc func() {}\n'],
  ['go else newline', 'Go', 'package main\n\nfunc main() {\n\tif true {\n\t}\n\telse {\n\t}\n}\n'],
  ['go two stmts one line', 'Go', 'package main\n\nfunc main() {\n\tx := 1 y := 2\n}\n'],
  ['java missing ; return', 'Java', 'class A {\n  int f() {\n    return 1\n  }\n}\n'],
  ['java missing ( in if', 'Java', 'class A {\n  void f() {\n    if x > 0) {}\n  }\n}\n'],
  ['java unclosed (', 'Java', 'class A {\n  void f() {\n    g(1, 2;\n  }\n}\n'],
  ['java bad class decl', 'Java', 'class {\n}\n'],
  ['java stray else', 'Java', 'class A {\n  void f() {\n    else {}\n  }\n}\n'],
  ['java unterminated text block', 'Java', 'class A {\n  String s = """\n    hi\n}\n'],
  ['java double type', 'Java', 'class A {\n  int int x = 1;\n}\n'],
  ['java missing method body brace', 'Java', 'class A {\n  void f() \n    int x = 1;\n  }\n}\n'],
  ['java unterminated char', 'Java', "class A {\n  char c = 'a;\n}\n"]
]

// Grammar leniencies: the real compilers reject these, tree-sitter accepts them.
const KNOWN_MISS = new Set(['py walrus top level bare', 'go brace on next line', 'go if brace next line', 'go := at top'])

// [name, language, code, line, column, message] of the first mark.
const exactTable: [string, string, string, number, number, string][] = [
  ['py unclosed [', 'Python', 'a = [1, 2\nb = 3\n', 1, 5, SYNTAX_TEXT.unclosed('[', ']')],
  ['py mismatched', 'Python', 'a = (1, 2]\n', 1, 10, SYNTAX_TEXT.unexpected(']')],
  ['py unterminated triple', 'Python', 'x = """abc\ny = 1\n', 1, 5, SYNTAX_TEXT.unterminatedString],
  ['py unterminated f-string', 'Python', 'x = f"abc {y}\n', 1, 5, SYNTAX_TEXT.unterminatedString],
  ['py missing colon if', 'Python', 'x = 1\nif x > 0\n    print(x)\n', 2, 8, SYNTAX_TEXT.missing(':')],
  ['py dedent to a level never opened', 'Python', 'def f():\n    if x:\n        a = 1\n  b = 2\n', 4, 3, SYNTAX_TEXT.unexpectedIndent],
  ['py tab then spaces', 'Python', 'if x:\n\ta = 1\n        b = 2\n', 3, 9, SYNTAX_TEXT.unexpectedIndent],
  ['go missing )', 'Go', 'package main\n\nfunc main() {\n\tfmt.Println("a"\n}\n', 4, 16, SYNTAX_TEXT.missing(')')],
  ['go else on a new line', 'Go', 'package main\n\nfunc main() {\n\tif true {\n\t}\n\telse {\n\t}\n}\n', 6, 2, SYNTAX_TEXT.unexpected('else')],
  ['java missing ; after return', 'Java', 'class A {\n  int f() {\n    return 1\n  }\n}\n', 3, 12, SYNTAX_TEXT.missing(';')],
  ['java emoji before the error', 'Java', 'class A {\n  String s = "😀😀😀"; int y = )\n}\n', 2, 32, SYNTAX_TEXT.unexpected(')')],
  ['go CJK before the error', 'Go', 'package main\n\nvar s = "日本語" + )\n', 3, 17, SYNTAX_TEXT.unexpected(')')]
]

describe('checkSyntax, QA adversarial pass', () => {
  it.each(valid)('no false alarm: %s', async (_name, language, code) => {
    expect(await check(language, code)).toEqual([])
  })

  it.each(invalid.filter(([name]) => !KNOWN_MISS.has(name)))('finds the error: %s', async (_name, language, code) => {
    const markList = await check(language, code)
    expect(markList.length).toBeGreaterThan(0)
    for (const mark of markList) {
      expect(mark.startLine).toBe(mark.endLine)
      expect(mark.endColumn).toBeGreaterThan(mark.startColumn)
      expect(mark.startLine).toBeLessThanOrEqual(code.split('\n').length)
    }
  })

  it.each(exactTable)('points at the bad spot: %s', async (_name, language, code, line, column, message) => {
    const [first] = await check(language, code)
    expect(first).toMatchObject({ startLine: line, startColumn: column, message })
  })

  it.fails.each(invalid.filter(([name]) => KNOWN_MISS.has(name)))('known miss (the grammar accepts it): %s', async (_name, language, code) => {
    expect((await check(language, code)).length).toBeGreaterThan(0)
  })

  it.each([
    ['Python balanced', 'Python', `x = ${'('.repeat(20000)}1${')'.repeat(20000)}\n`, 0],
    ['Python unclosed', 'Python', `x = ${'('.repeat(20000)}1\n`, 1],
    ['Java balanced', 'Java', `class A { void f() ${'{'.repeat(10000)}${'}'.repeat(10000)} }\n`, 0],
    ['Java unclosed', 'Java', `class A { void f() ${'{'.repeat(10000)} }\n`, 1],
    ['Go unary chain', 'Go', `package main\nvar x = ${'-'.repeat(30000)}1\n`, 0]
  ])('very deep nesting (%s) does not overflow the stack', async (_name, language, code, count) => {
    expect(await check(language as string, code as string)).toHaveLength(count as number)
  })

  it.each(['Python', 'Go', 'Java'])('100 000 characters of garbage in %s give 1 to 20 marks and do not throw', async (language) => {
    const alphabet = ')]}"\'(:;=+ a1\n\t'
    const garbage = Array.from({ length: SYNTAX_LIMIT.contentMax }, (_, i) => alphabet[(i * 7919) % alphabet.length]).join('')
    const markList = await check(language, garbage)
    expect(markList.length).toBeGreaterThan(0)
    expect(markList.length).toBeLessThanOrEqual(SYNTAX_LIMIT.markMax)
  })

  it('the 100 000-character limit is inclusive: exactly at the limit is checked, one more is not', async () => {
    const at = `x = )\n${'#'.repeat(SYNTAX_LIMIT.contentMax - 6)}`
    expect(at.length).toBe(SYNTAX_LIMIT.contentMax)
    expect(await check('Python', at)).toHaveLength(1)
    expect(await check('Python', `${at}#`)).toEqual([])
  })

  it('caps the Python indent marks at 20 on a big noisy file', async () => {
    const code = Array.from({ length: 16000 }, (_, i) => `${' '.repeat(i % 5)}x${i} = 1`).join('\n').slice(0, SYNTAX_LIMIT.contentMax)
    expect(await check('Python', code)).toHaveLength(SYNTAX_LIMIT.markMax)
  })

  it('NUL and a lone surrogate do not throw', async () => {
    expect((await check('Python', 'x = 1\u0000\ny = 2\n')).length).toBeGreaterThan(0)
    expect(await check('Python', 'x = "\uD800"\ny = )\n')).toMatchObject([{ startLine: 2, startColumn: 5 }])
  })

  it('an unknown or lower-case language name is not checked', async () => {
    expect(await check('Rust', 'fn main( {')).toEqual([])
    expect(await check('python', 'x = )')).toEqual([])
  })

  it('checks of several languages at once do not mix up the shared parser', async () => {
    const [py, go, java, ok] = await Promise.all([
      check('Python', 'x = )\n'),
      check('Go', 'package main\n}\n'),
      check('Java', 'class A {\n}\n}\n'),
      check('Python', 'y = 1\n')
    ])
    expect(py).toMatchObject([{ startLine: 1, startColumn: 5 }])
    expect(go).toMatchObject([{ startLine: 2, startColumn: 1 }])
    expect(java).toMatchObject([{ startLine: 3, startColumn: 1 }])
    expect(ok).toEqual([])
  })

  // QA findings (.orchestrate/qa-report.md). Each test states the expected behaviour.
  it.fails('F3: a leading byte-order mark is not an "Unexpected indent"', async () => {
    expect(await check('Python', '\uFEFFx = 1\n')).toEqual([])
  })

  it.fails('F4: "Unexpected indent" is only given to a statement that starts its line', async () => {
    const markList = await check('Python', 'def = 1\n')
    expect(markList.filter((mark) => mark.message === SYNTAX_TEXT.unexpectedIndent)).toEqual([])
  })

  it.fails('F1: a 5 000-line file with an early unclosed ( parses within the 100 ms long-task budget', async () => {
    let code = 'x = (1,\n'
    for (let i = 0; code.length < 98_000; i++) code += `def f${i}(a, b):\n    if a > b:\n        return [x * 2 for x in range(a)]\n    return {"k": (a, b)}\n\n`
    await check('Python', 'x = 1')
    const start = performance.now()
    await check('Python', code)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

