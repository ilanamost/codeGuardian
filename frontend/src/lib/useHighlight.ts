import { useEffect, useState } from 'react'
import { loader, type Monaco } from '@monaco-editor/react'

// The editor's Shiki highlighting (plan 027), loaded once for the whole app. It never holds the
// editor back (QA round 3, R3-1): the editor renders at once with Monaco's own coloring and
// vs-dark, and Shiki is put on the Monaco instance as soon as both are loaded, whichever comes
// last. `ready`: Shiki is loaded and `apply` puts it on a Monaco instance (also used by the
// editor's beforeMount). `failed`: the editor keeps Monaco's own coloring, as before plan 027.
export type HighlightStatus = 'loading' | 'ready' | 'failed'

export type Highlight = { status: HighlightStatus; apply?: (monaco: Monaco) => void }

let load: Promise<void> | null = null
let current: Highlight = { status: 'loading' }

export function loadHighlight(): Promise<void> {
  if (!load) {
    // The same CDN load @monaco-editor/react's Editor waits for (it reports its own failure).
    const monacoLoad = loader.init()
    monacoLoad.then(
      () => undefined,
      () => undefined
    )
    load = import('./shikiHighlight')
      .then(async ({ createEditorHighlighter, applyHighlight }) => {
        const highlighter = await createEditorHighlighter()
        const apply = (monaco: Monaco) => applyHighlight(monaco, highlighter)
        current = { status: 'ready', apply }
        // An editor that already mounted with vs-dark switches now: Shiki's theme and tokenizers
        // apply to the shared instance and its models are tokenized again, without a remount.
        // Applied synchronously when Monaco is already there, so the theme exists before React
        // passes its name to the editor.
        const monaco = loader.__getMonacoInstance()
        if (monaco) apply(monaco)
        else monacoLoad.then(apply, () => undefined)
      })
      .catch(() => {
        current = { status: 'failed' }
      })
  }
  return load
}

// The highlighting state. The editor does not wait for it; it only picks the theme name.
export function useHighlight(): Highlight {
  const [highlight, setHighlight] = useState<Highlight>(current)
  useEffect(() => {
    if (highlight.status !== 'loading') return
    let active = true
    void loadHighlight().then(() => {
      if (active) setHighlight(current)
    })
    return () => {
      active = false
    }
  }, [highlight.status])
  return highlight
}
