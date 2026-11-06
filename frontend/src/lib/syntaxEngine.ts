import type { Language, Node, Parser } from 'web-tree-sitter'
import { SYNTAX_LIMIT, SYNTAX_TEXT } from './review.constants'

// Plan 032: the editor's syntax check engine. The only module that uses web-tree-sitter; the app
// runs it in a Web Worker (lib/syntax.worker.ts, through lib/syntaxCheck.ts), so a slow parse of a
// large broken file never blocks the page (QA F1). Unit tests run it directly. Python, Go and
// Java are parsed with their tree-sitter grammars (WebAssembly), bundled with the app and served
// from its own origin (`?url` asset imports, themselves imported lazily so that not even their URL
// modules load with the page): the runtime and a language's grammar are requested only the first
// time code of that language is checked, then cached for the session. The code is
// parsed, never run, and never leaves the browser. TypeScript and JavaScript get no result here:
// Monaco's own syntax validation marks them (lib/editorDiagnostic.ts).

// One syntax error. Lines and columns start at 1 (as in the editor); the end column is exclusive.
export type SyntaxErrorMark = {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  message: string
}

export type GrammarLanguage = 'Python' | 'Go' | 'Java'

// Where a WebAssembly file comes from: its URL in the app, given when first needed, or the bytes
// themselves (unit tests).
export type WasmFile = (() => Promise<string>) | Uint8Array

export type SyntaxWasmSource = {
  runtime: WasmFile
  grammar: Record<GrammarLanguage, WasmFile>
}

const GRAMMAR_LANGUAGE_LIST: GrammarLanguage[] = ['Python', 'Go', 'Java']

const urlOf = (module: { default: string }) => module.default

const defaultSource: SyntaxWasmSource = {
  runtime: () => import('web-tree-sitter/web-tree-sitter.wasm?url').then(urlOf),
  grammar: {
    Python: () => import('tree-sitter-python/tree-sitter-python.wasm?url').then(urlOf),
    Go: () => import('tree-sitter-go/tree-sitter-go.wasm?url').then(urlOf),
    Java: () => import('tree-sitter-java/tree-sitter-java.wasm?url').then(urlOf)
  }
}

const resolveFile = async (file: WasmFile) => (file instanceof Uint8Array ? file : file())

// Whether a language of the selector is checked here (and needs a grammar file).
export function hasSyntaxGrammar(language: string): language is GrammarLanguage {
  return (GRAMMAR_LANGUAGE_LIST as string[]).includes(language)
}

// Checks one code text; rejects when the runtime or the grammar cannot load.
export type SyntaxChecker = (language: string, code: string) => Promise<SyntaxErrorMark[]>

type Engine = { parser: Parser; load: (source: string | Uint8Array) => Promise<Language> }

export function createSyntaxChecker(source: SyntaxWasmSource = defaultSource): SyntaxChecker {
  // A failed load stays failed for the session: no new request on every keystroke.
  let engine: Promise<Engine> | null = null
  const grammar = new Map<GrammarLanguage, Promise<Language>>()

  const loadEngine = () => {
    engine ??= Promise.all([import('web-tree-sitter'), resolveFile(source.runtime)]).then(async ([{ Parser, Language }, runtime]) => {
      await Parser.init(typeof runtime === 'string' ? { locateFile: () => runtime } : { wasmBinary: runtime })
      return { parser: new Parser(), load: (file: string | Uint8Array) => Language.load(file) }
    })
    return engine
  }

  const loadGrammar = (language: GrammarLanguage) => {
    let load = grammar.get(language)
    if (!load) {
      load = Promise.all([loadEngine(), resolveFile(source.grammar[language])]).then(([item, file]) => item.load(file))
      grammar.set(language, load)
    }
    return load
  }

  return async (language, code) => {
    if (!hasSyntaxGrammar(language) || code.length > SYNTAX_LIMIT.contentMax || !code.trim()) return []
    const [{ parser }, grammarLanguage] = await Promise.all([loadEngine(), loadGrammar(language)])
    // Parsing is synchronous, so no other check can switch the parser's language in between.
    parser.setLanguage(grammarLanguage)
    const tree = parser.parse(code)
    if (!tree) return []
    try {
      return markList(tree.rootNode, code, language)
    } finally {
      tree.delete()
    }
  }
}

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE_SET = new Set(Object.values(OPEN_TO_CLOSE))
const QUOTE_SET = new Set(['"', "'", '`', '"""', "'''", 'string_start'])
// Python statements whose first line ends with `:`.
const PYTHON_COMPOUND_SET = new Set(['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with'])

type Point = { row: number; column: number }

function compare(a: SyntaxErrorMark, b: SyntaxErrorMark) {
  return a.startLine - b.startLine || a.startColumn - b.startColumn
}

function quote(text: string) {
  const line = text.split('\n')[0]
  return line.length > SYNTAX_LIMIT.tokenMax ? `${line.slice(0, SYNTAX_LIMIT.tokenMax)}…` : line
}

// The errors of a tree, in position order, at most SYNTAX_LIMIT.markMax.
function markList(root: Node, code: string, language: GrammarLanguage): SyntaxErrorMark[] {
  const lineList = code.split('\n')
  const result: SyntaxErrorMark[] = []
  if (root.hasError) collectError(root, lineList, language, result)
  if (language === 'Python') result.push(...pythonIndentList(root, lineList))
  return result.sort(compare).slice(0, SYNTAX_LIMIT.markMax)
}

// Walks only the subtrees that hold an error, in document order, and stops once the cap is hit.
// A cursor, not recursion: a long expression nests thousands of levels deep.
function collectError(root: Node, lineList: string[], language: GrammarLanguage, result: SyntaxErrorMark[]) {
  const cursor = root.walk()
  try {
    for (;;) {
      const node = cursor.currentNode
      let enter = false
      if (node.isMissing) result.push(missingMark(node, lineList))
      else if (node.isError) result.push(errorMark(node, lineList, language))
      else enter = node.hasError
      if (result.length >= SYNTAX_LIMIT.markMax) return
      if (enter && cursor.gotoFirstChild()) continue
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return
      }
    }
  } finally {
    cursor.delete()
  }
}

// The range of a token on its first line (a token never marks more than one line).
function tokenMark(start: Point, end: Point, lineList: string[], message: string): SyntaxErrorMark {
  const lineLength = lineList[start.row]?.length ?? 0
  const endColumn = end.row === start.row ? end.column : lineLength
  if (endColumn > start.column) {
    return { startLine: start.row + 1, startColumn: start.column + 1, endLine: start.row + 1, endColumn: endColumn + 1, message }
  }
  return pointMark(start, lineList, message)
}

// A zero-width spot: the character at it, or the one before it at the end of a line, or the last
// character of the closest line above that has one (a `}` missing at the end of the file).
function pointMark(point: Point, lineList: string[], message: string): SyntaxErrorMark {
  let { row, column } = point
  const line = lineList[row] ?? ''
  if (column >= line.length) {
    while (row > 0 && column === 0 && !(lineList[row] ?? '').trim()) {
      row -= 1
      column = (lineList[row] ?? '').trimEnd().length
    }
    column = Math.max(0, Math.min(column, (lineList[row] ?? '').length) - 1)
  }
  return { startLine: row + 1, startColumn: column + 1, endLine: row + 1, endColumn: column + 2, message }
}

function missingMark(node: Node, lineList: string[]): SyntaxErrorMark {
  const message = node.isNamed ? SYNTAX_TEXT.missingName(node.type.replaceAll('_', ' ')) : SYNTAX_TEXT.missing(node.type)
  return pointMark(node.startPosition, lineList, message)
}

// The tokens of a node in order (MISSING ones left out), walked with a cursor.
function leafList(node: Node): Node[] {
  const result: Node[] = []
  const cursor = node.walk()
  try {
    for (;;) {
      if (cursor.gotoFirstChild()) continue
      const leaf = cursor.currentNode
      if (!leaf.isMissing) result.push(leaf)
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return result
      }
    }
  } finally {
    cursor.delete()
  }
}

function isLooseQuote(leaf: Node, error: Node) {
  return QUOTE_SET.has(leaf.type) && (leaf.id === error.id || leaf.parent?.isError === true)
}

// An ERROR node can wrap a whole statement. It is narrowed to the first token that explains it:
// a closing bracket without its opener, a string quote that is never closed, an opener that is
// never closed, a Python header without its `:`, and else the last token of the node's first line
// (the parser gives up right after the longest part that still parses).
function errorMark(error: Node, lineList: string[], language: GrammarLanguage): SyntaxErrorMark {
  const leaves = leafList(error)
  if (leaves.length === 0) return tokenMark(error.startPosition, error.endPosition, lineList, SYNTAX_TEXT.invalid)
  const mark = (leaf: Node, message: string) => tokenMark(leaf.startPosition, leaf.endPosition, lineList, message)
  const openList: Node[] = []
  for (const leaf of leaves) {
    if (isLooseQuote(leaf, error)) return mark(leaf, SYNTAX_TEXT.unterminatedString)
    if (Object.hasOwn(OPEN_TO_CLOSE, leaf.type)) openList.push(leaf)
    else if (CLOSE_SET.has(leaf.type)) {
      const open = openList.at(-1)
      if (open && OPEN_TO_CLOSE[open.type] === leaf.type) openList.pop()
      else return mark(leaf, SYNTAX_TEXT.unexpected(leaf.type))
    }
  }
  const open = openList.at(-1)
  if (open) return mark(open, SYNTAX_TEXT.unclosed(open.type, OPEN_TO_CLOSE[open.type]))
  if (language === 'Python') {
    const header = pythonHeaderWithoutColon(leaves)
    if (header) return mark(header, SYNTAX_TEXT.missing(':'))
  }
  const firstRow = leaves[0].startPosition.row
  const last = leaves.filter((leaf) => leaf.startPosition.row === firstRow).at(-1) ?? leaves[0]
  return mark(last, SYNTAX_TEXT.unexpected(quote(last.text)))
}

// The last token of the first `def`/`if`/... line that has no `:`, if there is one.
function pythonHeaderWithoutColon(leaves: Node[]): Node | null {
  const header = leaves.find((leaf) => PYTHON_COMPOUND_SET.has(leaf.type))
  if (!header) return null
  const row = header.startPosition.row
  const lineLeafList = leaves.filter((leaf) => leaf.startPosition.row === row)
  if (lineLeafList.some((leaf) => leaf.type === ':')) return null
  return lineLeafList.at(-1) ?? null
}

// Indentation errors the Python grammar accepts without an ERROR node: a block with no
// statement ("def f():" followed by an unindented line), and a statement that starts a line at
// another indent than the first statement of its block (column 0 at the top level).
function pythonIndentList(root: Node, lineList: string[]): SyntaxErrorMark[] {
  const result = indentMarkList(statementListOf(root), 0, lineList)
  for (const block of root.descendantsOfType('block')) {
    if (!block || block.hasError) continue
    const statementList = statementListOf(block)
    if (statementList.length === 0) result.push(expectedBlockMark(block, lineList))
    else result.push(...indentMarkList(statementList, statementList[0].startPosition.column, lineList))
  }
  return result
}

function statementListOf(node: Node): Node[] {
  return node.namedChildren.filter((item): item is Node => item !== null && item.type !== 'comment' && !item.hasError)
}

function indentMarkList(statementList: Node[], column: number, lineList: string[]): SyntaxErrorMark[] {
  const result: SyntaxErrorMark[] = []
  let lastRow = -1
  for (const statement of statementList) {
    const { row } = statement.startPosition
    if (row > lastRow && statement.startPosition.column !== column) {
      result.push(tokenMark(statement.startPosition, statement.endPosition, lineList, SYNTAX_TEXT.unexpectedIndent))
    }
    lastRow = statement.endPosition.row
  }
  return result
}

// Marks the line after the header (where the block should start), or the header's end.
function expectedBlockMark(block: Node, lineList: string[]): SyntaxErrorMark {
  const nextRow = lineList.findIndex((line, row) => row > block.startPosition.row && line.trim() !== '' && !line.trim().startsWith('#'))
  if (nextRow < 0) return pointMark(block.startPosition, lineList, SYNTAX_TEXT.expectedBlock)
  const line = lineList[nextRow]
  const column = line.length - line.trimStart().length
  return tokenMark({ row: nextRow, column }, { row: nextRow, column: line.trimEnd().length }, lineList, SYNTAX_TEXT.expectedBlock)
}
