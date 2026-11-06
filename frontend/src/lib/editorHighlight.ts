import type { LanguageRegistration, ThemeRegistration } from 'shiki/core'
import { LANGUAGE_META } from './review.constants'

// Code editor highlighting (plan 027, Revision 3). Monaco still loads from the CDN through
// @monaco-editor/react, with all its features; Shiki colors it with VS Code's own TextMate
// grammars and the VS Code "Dark+" theme, recolored to the app's code tokens
// (lib/shikiHighlight.ts). This module stays light: the grammars load only through the loaders
// below.

// The one theme of both editors (Summary and Generated tests).
export const EDITOR_THEME_ID = 'code-dark'

type GrammarModule = { default: LanguageRegistration[] }

// How long @shikijs/monaco may tokenize one line before it gives up and leaves the rest of the
// line uncolored (its default is 500 ms). The JavaScript regex engine compiles a grammar's
// patterns on first use, which on a slow CPU took longer than that for the first line (QA round 2,
// R2-2); the warm-up below does that work up front, and this limit is the safety margin.
export const TOKENIZE_TIME_LIMIT_MS = 5000

// Per Monaco language id of LANGUAGE_META: the VS Code grammar Shiki tokenizes it with (Shiki's
// ids are Monaco's), and a short sample with the usual constructs, tokenized once when the
// highlighter is created so the grammar's patterns are compiled before the first editor paints.
export const HIGHLIGHT_LANGUAGE: Record<string, { grammar: () => Promise<GrammarModule>; sample: string }> = {
  typescript: {
    grammar: () => import('shiki/langs/typescript.mjs'),
    sample: [
      "import { load, type Item } from './item'",
      "// comment /* block */",
      "interface User { name: string; tags?: string[] }",
      "type Id = number | `id-${string}`",
      "export class Store<T> extends Base implements Api {",
      "  private readonly list: T[] = []",
      "  async get(id: Id): Promise<User | null> {",
      "    const value: any = eval(input) ?? \"text\" + 'x'",
      "    if (id > 0 && !done) return { id, re: /a+b/g, n: 1.5e3 }",
      "    return null",
      "  }",
      "}",
      "export const run = (a: number): void => console.log(a)"
    ].join('\n')
  },
  javascript: {
    grammar: () => import('shiki/langs/javascript.mjs'),
    sample: [
      "import { load } from './item.js'",
      "// comment /* block */",
      "export class Store extends Base {",
      "  #list = []",
      "  async get(id) {",
      "    const value = eval(input) ?? \"text\" + 'x' + `t${id}`",
      "    if (id > 0 && !done) return { id, re: /a+b/g, n: 1.5e3 }",
      "    return null",
      "  }",
      "}",
      "export const run = (a) => console.log(a)"
    ].join('\n')
  },
  python: {
    grammar: () => import('shiki/langs/python.mjs'),
    sample: [
      "from typing import Optional",
      "# comment",
      "@decorator",
      "class User(Base):",
      "    \"\"\"Doc string.\"\"\"",
      "    def get(self, id: int = 0) -> Optional[str]:",
      "        value = f\"text {id}\" + 'x' + r'raw'",
      "        if id > 0 and not done:",
      "            return [n * 1.5 for n in range(3)]",
      "        return None",
      "",
      "async def run(a: int) -> None:",
      "    await load(a)"
    ].join('\n')
  },
  go: {
    grammar: () => import('shiki/langs/go.mjs'),
    sample: [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "// comment",
      "type User struct {",
      "\tName string `json:\"name\"`",
      "}",
      "",
      "func (u *User) Get(id int) (string, error) {",
      "\tvalue := fmt.Sprintf(\"text %d\", id) + string('x')",
      "\tif id > 0 && !done {",
      "\t\treturn value, nil",
      "\t}",
      "\treturn \"\", fmt.Errorf(\"none %v\", 1.5)",
      "}"
    ].join('\n')
  },
  java: {
    grammar: () => import('shiki/langs/java.mjs'),
    sample: [
      "package app;",
      "",
      "import java.util.List;",
      "",
      "// comment /* block */",
      "@Service",
      "public class Store<T> extends Base implements Api {",
      "  private final List<T> list = new ArrayList<>();",
      "  public String get(int id) throws Exception {",
      "    String value = \"text\" + 'x' + 1.5f;",
      "    if (id > 0 && !done) return value;",
      "    return null;",
      "  }",
      "}"
    ].join('\n')
  }
}

// The Monaco language ids of the selector that have no highlighting entry (expected: none).
export function missingHighlightLanguage(): string[] {
  return Object.values(LANGUAGE_META)
    .map(({ monacoId }) => monacoId)
    .filter((id) => !(id in HIGHLIGHT_LANGUAGE))
}

export type EditorColor = { background?: string; foreground?: string }

const HEX_COLOR = /^#[0-9a-f]{6}$/i

// The editor background and default text color from the app's code tokens
// (styles/setup/variables.css). A token that is missing or not a 6-digit hex is left out, and the
// theme keeps its own color for it.
export function readEditorColor(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): EditorColor {
  const color: EditorColor = {}
  const background = style.getPropertyValue('--color-code-bg').trim()
  const foreground = style.getPropertyValue('--color-code-text').trim()
  if (HEX_COLOR.test(background)) color.background = background
  if (HEX_COLOR.test(foreground)) color.foreground = foreground
  return color
}

// The editor theme: the base theme's token colors, renamed to EDITOR_THEME_ID, on the app's code
// background and text color. The base is not changed.
export function buildEditorTheme(base: ThemeRegistration, color: EditorColor): ThemeRegistration {
  const colors = { ...base.colors }
  if (color.background) {
    colors['editor.background'] = color.background
    colors['editorGutter.background'] = color.background
  }
  if (color.foreground) colors['editor.foreground'] = color.foreground
  return { ...base, name: EDITOR_THEME_ID, colors }
}
