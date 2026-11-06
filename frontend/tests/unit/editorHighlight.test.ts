import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import darkPlus from 'shiki/themes/dark-plus.mjs'
import { describe, expect, it } from 'vitest'
import {
  buildEditorTheme,
  EDITOR_THEME_ID,
  HIGHLIGHT_LANGUAGE,
  missingHighlightLanguage,
  readEditorColor,
  TOKENIZE_TIME_LIMIT_MS
} from '../../src/lib/editorHighlight'
import { LANGUAGE_META } from '../../src/lib/review.constants'

// Plan 027: the highlighting map covers the selector's languages; the theme uses the code tokens.
function styleOf(value: Record<string, string>) {
  return { getPropertyValue: (name: string) => value[name] ?? '' }
}

const base = {
  name: 'dark-plus',
  type: 'dark' as const,
  colors: { 'editor.background': '#1E1E1E', 'editor.foreground': '#D4D4D4', 'editor.lineHighlightBackground': '#ffffff10' },
  tokenColors: [{ scope: 'keyword', settings: { foreground: '#569CD6' } }]
}

describe('HIGHLIGHT_LANGUAGE', () => {
  it('has a grammar and a warm-up sample for every language of the selector', () => {
    expect(missingHighlightLanguage()).toEqual([])
    expect(Object.keys(HIGHLIGHT_LANGUAGE).sort()).toEqual(Object.values(LANGUAGE_META).map(({ monacoId }) => monacoId).sort())
  })

  it.each(Object.keys(HIGHLIGHT_LANGUAGE))('loads the VS Code grammar named %s', async (id) => {
    const grammar = await HIGHLIGHT_LANGUAGE[id].grammar()
    expect(grammar.default.map(({ name }) => name)).toContain(id)
  })
})

describe('readEditorColor', () => {
  it('reads the code background and text tokens', () => {
    expect(readEditorColor(styleOf({ '--color-code-bg': ' #0a1224 ', '--color-code-text': '#d7e0f5' }))).toEqual({
      background: '#0a1224',
      foreground: '#d7e0f5'
    })
  })

  it('leaves out a missing token and one that is not a 6-digit hex', () => {
    expect(readEditorColor(styleOf({}))).toEqual({})
    expect(readEditorColor(styleOf({ '--color-code-bg': 'var(--x)', '--color-code-text': '#fff' }))).toEqual({})
  })
})

describe('buildEditorTheme', () => {
  it('renames the theme and puts it on the code colors, keeping the token colors', () => {
    const theme = buildEditorTheme(base, { background: '#0a1224', foreground: '#d7e0f5' })
    expect(theme.name).toBe(EDITOR_THEME_ID)
    expect(theme.colors).toEqual({
      'editor.background': '#0a1224',
      'editorGutter.background': '#0a1224',
      'editor.foreground': '#d7e0f5',
      'editor.lineHighlightBackground': '#ffffff10'
    })
    expect(theme.tokenColors).toBe(base.tokenColors)
  })

  it('keeps the base colors when no token was read, and never changes the base', () => {
    const theme = buildEditorTheme(base, {})
    expect(theme.colors).toEqual(base.colors)
    expect(base.colors['editor.background']).toBe('#1E1E1E')
    expect(base.name).toBe('dark-plus')
  })
})

// QA round 2, R2-2: setupMonaco tokenizes each sample once so the grammar is compiled before
// the first editor paints. The samples must tokenize with the real grammars and theme.
describe('HIGHLIGHT_LANGUAGE samples', () => {
  it('raises the per-line tokenize limit above the 500 ms default', () => {
    expect(TOKENIZE_TIME_LIMIT_MS).toBeGreaterThan(500)
  })

  it.each(Object.keys(HIGHLIGHT_LANGUAGE))('tokenizes the %s sample in several colors', async (id) => {
    const { sample, grammar } = HIGHLIGHT_LANGUAGE[id]
    expect(sample.split('\n').length).toBeGreaterThan(5)
    const highlighter = await createHighlighterCore({
      themes: [buildEditorTheme(darkPlus, {})],
      langs: [grammar],
      engine: createJavaScriptRegexEngine({ forgiving: true })
    })
    const colorList = new Set(highlighter.codeToTokensBase(sample, { lang: id, theme: EDITOR_THEME_ID }).flat().map(({ color }) => color))
    expect(colorList.size).toBeGreaterThanOrEqual(5)
    highlighter.dispose()
  })
})
