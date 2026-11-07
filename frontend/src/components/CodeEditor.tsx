import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { editorHorizontalScrollbarSize, scrollbarSize } from '../lib/config'
import { useSettings } from '../lib/useSettings'
import { useBreakpoint } from '../lib/useBreakpoint'
import { fontSizePx } from '../lib/settings.constants'
import {
  EDITOR_MODEL_PATH,
  EDITOR_TEXT,
  FINDING_MARKER_OWNER,
  SYNTAX_CHECK_DELAY_MS,
  SYNTAX_MARKER_OWNER,
  SYNTAX_MARKER_SOURCE,
  UPLOAD_ACCEPT
} from '../lib/review.constants'
import { monacoLanguageId, readCodeFile, type CodeFile } from '../lib/codeFile'
import { findingToMarker, type MarkerLevel } from '../lib/findingMarker'
import { applyScriptDiagnosticOption, staleDiagnosticOwnerList } from '../lib/editorDiagnostic'
import { EDITOR_THEME_ID } from '../lib/editorHighlight'
import { pinEditorScroll } from '../lib/editorScrollGuard'
import { useHighlight } from '../lib/useHighlight'
import { checkSyntax } from '../lib/syntaxCheck'
import { scheduleSyntaxCheck, syntaxFailureOnce } from '../lib/syntaxSchedule'
import { AppError } from '../models/app-error'
import { toLf } from '../services/util.service'
import { useAppDispatch } from '../store/hooks'
import { errorReported } from '../store/listener'
import type { Finding } from '../types'
import { ERROR_CODE } from '../utils/error-messages'

type Props = {
  value: string
  language: string
  languageList?: string[]
  onLanguageChange?: (language: string) => void
  title?: string
  action?: ReactNode
  readOnly?: boolean
  onChange?: (value: string) => void
  // An uploaded or dropped file that passed the checks (editable editor only).
  onFileLoad?: (file: CodeFile) => void
  // The review's findings, marked on their lines (Summary tab only).
  finding?: Finding[]
}

type EditorInstance = Parameters<OnMount>[0]
type DecorationCollection = ReturnType<EditorInstance['createDecorationsCollection']>

// The editor's own scrollbars follow the editor scrollbar tokens (styles/setup/variables.css).
// Plan 029: a light slider that stands out on the dark editor, and a visible track on the
// horizontal bar, so a short slider on a long line can be found and dragged on a phone.
// Monaco's CSS (and its theme's --vscode-* values on .monaco-editor) is not in a cascade layer
// and beats a Tailwind utility on the same element, so the values are set as Monaco's own
// variables on the scrollbar elements of the main editor (not on hover or suggest widgets).
// Revision 2: Monaco hides the horizontal bar while no line is wider than the editor (the empty
// /review/new editor, short code), so on a phone there was no bar at all. Below md the track now
// always shows: `!` beats Monaco's unlayered `.invisible` (opacity 0, visibility hidden), and
// z-11 is what Monaco gives `.visible` (or the lines paint over the track). Its slider shows only
// when there is something to scroll. Monaco fixes the slider's minimum length at 20 px; a CSS
// min-width would put it out of step with the scroll position, so it is not changed.
const sliderColorClass =
  '[&_.editor-scrollable>.scrollbar]:[--vscode-scrollbarSlider-background:var(--editor-scrollbar-thumb)] [&_.editor-scrollable>.scrollbar]:[--vscode-scrollbarSlider-hoverBackground:var(--editor-scrollbar-thumb-hover)] [&_.editor-scrollable>.scrollbar]:[--vscode-scrollbarSlider-activeBackground:var(--editor-scrollbar-thumb-hover)] [&_.editor-scrollable>.scrollbar.horizontal]:[--vscode-scrollbar-background:var(--editor-scrollbar-track)] max-md:[&_.editor-scrollable>.scrollbar.horizontal]:opacity-100! max-md:[&_.editor-scrollable>.scrollbar.horizontal]:z-11! max-md:[&_.editor-scrollable>.scrollbar.horizontal]:visible! max-md:[&_.editor-scrollable>.scrollbar.horizontal.invisible>.slider]:hidden'

// Monaco's built-in dark theme, used until the highlighting is ready, and if it cannot load.
const MONACO_THEME_FALLBACK = 'vs-dark'

function hasFile(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

export default function CodeEditor({
  value,
  language,
  languageList,
  onLanguageChange,
  title = EDITOR_TEXT.title,
  action,
  readOnly = true,
  onChange,
  onFileLoad,
  finding
}: Props) {
  const isTabletUp = useBreakpoint('md')
  const { settings } = useSettings()
  const dispatch = useAppDispatch()
  const inputRef = useRef<HTMLInputElement>(null)
  const decoration = useRef<DecorationCollection | null>(null)
  // The language the syntax markers on the model were set for.
  const syntaxLanguage = useRef<string | null>(null)
  const [mounted, setMounted] = useState<{ editor: EditorInstance; monaco: Monaco } | null>(null)
  // Only the latest upload or drop is applied (QA round 1, D3): a slower earlier read is dropped.
  const loadId = useRef(0)
  const canUpload = !readOnly && onFileLoad !== undefined
  // Shiki's highlighting (plan 027). The editor never waits for it (QA round 3, R3-1): until it is
  // ready the editor uses Monaco's own coloring and vs-dark, then switches in place. beforeMount
  // puts it on Monaco before the first paint when it is already loaded.
  const highlight = useHighlight()

  const loadFile = async (file: File | undefined) => {
    if (!file || !onFileLoad) return
    loadId.current += 1
    const id = loadId.current
    const result = await readCodeFile(file)
    if (id !== loadId.current) return
    if (!result.ok) {
      dispatch(errorReported(new AppError({ code: result.code, kind: 'validation' }).toJSON()))
      return
    }
    onFileLoad(result.file)
    toast.success(EDITOR_TEXT.fileLoaded(result.file.fileName))
  }

  // Drops are caught before Monaco sees them, so a dropped file is never inserted as text.
  const handleDragOver = (event: DragEvent) => {
    if (!canUpload || !hasFile(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (event: DragEvent) => {
    if (!canUpload || !hasFile(event)) return
    event.preventDefault()
    event.stopPropagation()
    void loadFile(event.dataTransfer.files[0])
  }

  // Monaco's TypeScript/JavaScript diagnostics only stay on a model of that language (QA round 3,
  // P1). They are cleared when the language changes, and again whenever the service still marks
  // the model after the change (a check of the old language can finish late, for example right
  // after an uploaded .py file replaced TypeScript code). Since plan 032 these are syntax errors only
  // (semantic validation is off). Only Monaco's TS/JS owners are cleared: the syntax and finding
  // markers set below have their own owners and are never touched here, although setting them
  // fires onDidChangeMarkers too.
  useEffect(() => {
    if (!mounted) return
    const { editor, monaco } = mounted
    const clearStale = () => {
      const model = editor.getModel()
      if (!model) return
      for (const owner of staleDiagnosticOwnerList(model.getLanguageId())) {
        if (monaco.editor.getModelMarkers({ resource: model.uri, owner }).length > 0) monaco.editor.setModelMarkers(model, owner, [])
      }
    }
    clearStale()
    const languageListener = editor.onDidChangeModelLanguage(clearStale)
    const markerListener = monaco.editor.onDidChangeMarkers((uriList: readonly { toString: () => string }[]) => {
      const uri = editor.getModel()?.uri.toString()
      if (uri && uriList.some((item) => item.toString() === uri)) clearStale()
    })
    return () => {
      languageListener.dispose()
      markerListener.dispose()
    }
  }, [mounted])

  // Syntax errors (plan 032), on the editable editor only: 400 ms after the last change of the code
  // or the language, the code is parsed in the browser (lib/syntaxCheck.ts) and the markers of
  // SYNTAX_MARKER_OWNER are replaced; finding markers and Monaco's own TS/JS markers are left
  // alone. A result for an older version of the model is dropped (lib/syntaxSchedule.ts). The
  // markers of another language are cleared at once on a switch. If the checker cannot load, no
  // marker is shown and one toast is shown per session; the editor keeps working.
  useEffect(() => {
    if (!mounted || readOnly) return
    const { editor, monaco } = mounted
    const model = editor.getModel()
    if (!model) return
    const setSyntaxMarker = (markerList: Parameters<typeof monaco.editor.setModelMarkers>[2]) => {
      if (!model.isDisposed()) monaco.editor.setModelMarkers(model, SYNTAX_MARKER_OWNER, markerList)
    }
    if (syntaxLanguage.current !== language) {
      if (syntaxLanguage.current !== null) setSyntaxMarker([])
      syntaxLanguage.current = language
    }
    return scheduleSyntaxCheck({
      delayMs: SYNTAX_CHECK_DELAY_MS,
      read: () => (model.isDisposed() ? null : { language, code: model.getValue(), version: model.getVersionId() }),
      check: checkSyntax,
      isCurrent: (version) => !model.isDisposed() && model.getVersionId() === version,
      apply: (markList) =>
        setSyntaxMarker(
          markList.map((mark) => ({
            severity: monaco.MarkerSeverity.Error,
            source: SYNTAX_MARKER_SOURCE,
            message: mark.message,
            startLineNumber: mark.startLine,
            startColumn: mark.startColumn,
            endLineNumber: mark.endLine,
            endColumn: mark.endColumn
          }))
        ),
      fail: () => {
        setSyntaxMarker([])
        if (syntaxFailureOnce()) dispatch(errorReported(new AppError({ code: ERROR_CODE.syntaxCheck, kind: 'unknown' }).toJSON()))
      }
    })
  }, [mounted, readOnly, language, value, dispatch])

  // Finding markers (squiggle and hover) and glyph-margin dots, set on mount and whenever the
  // findings change; cleared when there is none. The Review page passes none while the code is
  // an uploaded file the findings do not belong to.
  useEffect(() => {
    if (!mounted) return
    const { editor, monaco } = mounted
    const model = editor.getModel()
    if (!model) return
    const markerList = findingToMarker(finding ?? [], model.getLinesContent())
    const severityOf: Record<MarkerLevel, number> = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info
    }
    monaco.editor.setModelMarkers(
      model,
      FINDING_MARKER_OWNER,
      markerList.map(({ level, message, startLineNumber, startColumn, endLineNumber, endColumn }) => ({
        severity: severityOf[level],
        message,
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn
      }))
    )
    const decorationList = markerList.map((marker) => ({
      range: new monaco.Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn),
      options: {
        isWholeLine: true,
        // A line inserted at either edge does not join the decoration (QA round 1, D2).
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        glyphMarginClassName: marker.glyphClassName,
        glyphMarginHoverMessage: { value: marker.message }
      }
    }))
    if (!decoration.current) decoration.current = editor.createDecorationsCollection()
    decoration.current.set(decorationList)
  }, [mounted, finding])

  // Plan 029 revision 3: below md the editor is 42% of the screen height (at least 16rem, about
  // 8 lines), so with the editor placed first it fits, with its scrollbar, above the bottom nav on
  // the first screen of a phone. From md up it keeps 60% (tablet) and fills the column (lg).
  return (
    <section
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
      className={`flex h-[42dvh] min-h-64 w-full min-w-0 flex-col md:h-[60dvh] md:min-h-80 lg:h-auto lg:min-h-0 lg:flex-1 overflow-hidden rounded-md bg-code-bg text-code-text ${sliderColorClass}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 data-testid="editor-title" title={title} className="min-w-0 truncate text-sm font-semibold text-white">
          {title}
        </h2>
        {(canUpload || languageList) && (
          <div className="flex flex-wrap items-center gap-2">
            {canUpload && (
              <>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-code-text hover:text-white"
                >
                  <Upload size={14} aria-hidden="true" />
                  {EDITOR_TEXT.upload}
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  aria-label={EDITOR_TEXT.fileInput}
                  accept={UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // Cleared so choosing the same file again still fires a change.
                    event.target.value = ''
                    void loadFile(file)
                  }}
                />
              </>
            )}
            {languageList && (
              <select
                aria-label="Language"
                value={language}
                onChange={(event) => onLanguageChange?.(event.target.value)}
                className="rounded-sm border border-input-border bg-code-bg px-2 py-1 text-base text-code-text sm:text-xs"
              >
                {languageList.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {action}
      </div>
      <Editor
        height="100%"
        theme={highlight.status === 'ready' ? EDITOR_THEME_ID : MONACO_THEME_FALLBACK}
        beforeMount={(monaco) => {
          // Plan 032: TypeScript and JavaScript show syntax errors only (lib/editorDiagnostic.ts).
          applyScriptDiagnosticOption(monaco)
          highlight.apply?.(monaco)
        }}
        language={monacoLanguageId(language)}
        // QA F2: a `.tsx` model path, so JSX in TypeScript code is not a syntax error. Editable
        // editor only; the read-only Generated tests editor keeps Monaco's own model.
        path={readOnly ? undefined : EDITOR_MODEL_PATH}
        // The model always uses LF (set on mount), so the code is passed with LF too: with CRLF on
        // one side the wrapper's `value !== getValue()` check never matched (QA round 1, F3).
        value={toLf(value)}
        // @monaco-editor/react syncs `value` in an effect and replaces the whole content when it
        // differs from the model. Rendered later, that effect could see an older value while a
        // newer key was already typed: the key was lost and the cursor jumped to the end (QA
        // round 1, F3). flushSync commits the page's update, and runs that effect, before the
        // next key event, so the value it compares is always the model's own. Only an editor with
        // an onChange gets one: the read-only Generated tests editor gets new code through the
        // wrapper's setValue inside React's commit, where flushSync is not allowed (QA round 2, R2-1).
        onChange={onChange && ((next) => flushSync(() => onChange(next ?? '')))}
        onMount={(editor, monaco) => {
          editor.getModel()?.setEOL(monaco.editor.EndOfLineSequence.LF)
          // Keeps the browser from scrolling Monaco's clipping boxes (lib/editorScrollGuard.ts).
          const root = editor.getDomNode()
          if (root) {
            const unpin = pinEditorScroll(root)
            editor.onDidDispose(unpin)
          }
          setMounted({ editor, monaco })
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          wordWrap: 'off',
          glyphMargin: finding !== undefined,
          fontSize: fontSizePx[settings.editorFontSize] + (isTabletUp ? 0 : 2),
          scrollBeyondLastColumn: 3,
          scrollbar: {
            horizontal: 'visible',
            verticalScrollbarSize: scrollbarSize,
            horizontalScrollbarSize: isTabletUp ? editorHorizontalScrollbarSize.md : editorHorizontalScrollbarSize.base
          }
        }}
      />
    </section>
  )
}
