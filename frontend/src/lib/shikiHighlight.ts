import type { Monaco } from '@monaco-editor/react'
import { shikiToMonaco } from '@shikijs/monaco'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import darkPlus from 'shiki/themes/dark-plus.mjs'
import { buildEditorTheme, EDITOR_THEME_ID, HIGHLIGHT_LANGUAGE, readEditorColor, TOKENIZE_TIME_LIMIT_MS } from './editorHighlight'

// Shiki for the code editor (plan 027). Loaded lazily by lib/useHighlight.ts, so Shiki stays out
// of the app's main chunk. Monaco itself still comes from the CDN through @monaco-editor/react:
// Shiki only replaces its tokenizers (the colors) for the five languages of LANGUAGE_META and
// defines EDITOR_THEME_ID. Monaco's language services (IntelliSense, TS/JS diagnostics), its
// language configuration (comments, brackets) and every editor feature are left as they are.

// The highlighter with the five VS Code grammars and the editor theme. Each grammar is warmed up
// with its sample, so its patterns are compiled before the first editor paints (QA round 2, R2-2).
export async function createEditorHighlighter(): Promise<HighlighterCore> {
  const highlighter = await createHighlighterCore({
    themes: [buildEditorTheme(darkPlus, readEditorColor(getComputedStyle(document.documentElement)))],
    langs: Object.values(HIGHLIGHT_LANGUAGE).map(({ grammar }) => grammar),
    // The JavaScript regex engine needs no WebAssembly; `forgiving` skips a pattern it cannot
    // translate instead of failing the whole grammar.
    engine: createJavaScriptRegexEngine({ forgiving: true })
  })
  for (const [lang, { sample }] of Object.entries(HIGHLIGHT_LANGUAGE)) {
    highlighter.codeToTokensBase(sample, { lang, theme: EDITOR_THEME_ID })
  }
  return highlighter
}

type Languages = Monaco['languages']
type TokensProvider = Parameters<Languages['setTokensProvider']>[1]

const highlighted = new WeakSet<Monaco>()
const kept = { dispose: () => {} }

// Puts Shiki on a Monaco instance once (both editors share the CDN instance), from the editor's
// beforeMount or, when Shiki arrives later, right away (QA round 3, R3-1). shikiToMonaco sets its
// tokenizers, which makes Monaco tokenize the open models again, and switches the theme.
export function applyHighlight(monaco: Monaco, highlighter: HighlighterCore): void {
  if (highlighted.has(monaco)) return
  highlighted.add(monaco)
  const { languages } = monaco
  const shikiLanguageSet = new Set(Object.keys(HIGHLIGHT_LANGUAGE))

  // Shiki's tokens provider of each language, captured while shikiToMonaco registers them.
  const setTokensProvider = languages.setTokensProvider.bind(languages)
  const shikiProvider = new Map<string, TokensProvider>()
  languages.setTokensProvider = ((languageId: string, provider: TokensProvider) => {
    shikiProvider.set(languageId, provider)
    return setTokensProvider(languageId, provider)
  }) as Languages['setTokensProvider']
  shikiToMonaco(highlighter, monaco, { tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS })

  // Shiki stays the tokenizer of the five languages for the rest of the session (QA round 4,
  // R4-1). The CDN Monaco loads a language's own (Monarch) tokenizer lazily, through a factory
  // that registers it when its module arrives: if Shiki came in between, the late Monarch
  // tokenizer replaced it. Registering Shiki's provider as the language's factory too disposes a
  // pending Monarch factory (Monaco drops its late result), and later registrations for these
  // languages are ignored.
  const registerTokensProviderFactory = languages.registerTokensProviderFactory.bind(languages)
  for (const [languageId, provider] of shikiProvider) {
    if (shikiLanguageSet.has(languageId)) registerTokensProviderFactory(languageId, { create: () => provider })
  }
  const setMonarchTokensProvider = languages.setMonarchTokensProvider.bind(languages)
  languages.setTokensProvider = ((languageId: string, provider: TokensProvider) =>
    shikiLanguageSet.has(languageId) ? kept : setTokensProvider(languageId, provider)) as Languages['setTokensProvider']
  languages.setMonarchTokensProvider = ((languageId: string, provider: Parameters<Languages['setMonarchTokensProvider']>[1]) =>
    shikiLanguageSet.has(languageId) ? kept : setMonarchTokensProvider(languageId, provider)) as Languages['setMonarchTokensProvider']
  languages.registerTokensProviderFactory = ((languageId: string, factory: Parameters<Languages['registerTokensProviderFactory']>[1]) =>
    shikiLanguageSet.has(languageId) ? kept : registerTokensProviderFactory(languageId, factory)) as Languages['registerTokensProviderFactory']

  // From now on the Shiki theme is the editor theme: an editor that still asks for vs-dark (it
  // rendered before Shiki was ready) gets it too, as Shiki's setTheme only knows its own themes.
  const shikiSetTheme = monaco.editor.setTheme.bind(monaco.editor)
  const themeList = highlighter.getLoadedThemes()
  monaco.editor.setTheme = (name: string) => shikiSetTheme(themeList.includes(name) ? name : EDITOR_THEME_ID)
}
