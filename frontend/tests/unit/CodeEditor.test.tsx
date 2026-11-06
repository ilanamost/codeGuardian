import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import CodeEditor from '../../src/components/CodeEditor'
import { languageFromFileName, monacoLanguageId, readCodeFile } from '../../src/lib/codeFile'
import { findingToMarker } from '../../src/lib/findingMarker'
import { errorList } from '../../src/lib/help.constants'
import {
  EDITOR_TEXT,
  FINDING_GLYPH_CLASS,
  LANGUAGE_BY_EXTENSION,
  LANGUAGE_META,
  languageList,
  REVIEW_LIMIT,
  UPLOAD_ACCEPT,
  UPLOAD_MAX_BYTE
} from '../../src/lib/review.constants'
import type { Finding } from '../../src/types'
import { ERROR_CODE, ERROR_MESSAGE } from '../../src/utils/error-messages'
import { renderWithStore, renderWithStoreSettled } from '../utils/renderWithStore'

// Plan 021: upload and drop, language detection, finding markers and the wide scrollbar.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language, onChange }: { value: string; language: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco" data-language={language} value={value} onChange={(event) => onChange?.(event.target.value)} />
  )
}))

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: { success: vi.fn(), error: vi.fn() }
}))

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

function finding(id: string, severity: Finding['severity'], line: number): Finding {
  return { id, severity, category: 'bug', message: `message ${id}`, detail: `detail ${id}`, line_start: line }
}

describe('languageFromFileName', () => {
  it.each(Object.entries(LANGUAGE_BY_EXTENSION))('maps %s to %s', (extension, language) => {
    expect(languageFromFileName(`main${extension}`)).toBe(language)
  })

  it('covers every extension of the plan and only languages of the selector', () => {
    expect(Object.keys(LANGUAGE_BY_EXTENSION).sort()).toEqual(
      ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java'].sort()
    )
    expect(Object.keys(LANGUAGE_META)).toEqual(languageList)
    expect(UPLOAD_ACCEPT.split(',')).toEqual(Object.keys(LANGUAGE_BY_EXTENSION))
  })

  it('is case-insensitive and uses the last extension', () => {
    expect(languageFromFileName('App.TS')).toBe('TypeScript')
    expect(languageFromFileName('a.test.ts')).toBe('TypeScript')
    expect(languageFromFileName('src/dir.py/main.go')).toBe('Go')
  })

  it('returns null for an unknown or missing extension', () => {
    expect(languageFromFileName('notes.pdf')).toBeNull()
    expect(languageFromFileName('Makefile')).toBeNull()
    expect(languageFromFileName('.ts')).toBeNull()
    expect(languageFromFileName('main.')).toBeNull()
    expect(languageFromFileName('')).toBeNull()
  })
})

describe('monacoLanguageId', () => {
  it('takes the Monaco id from the language map', () => {
    for (const [language, { monacoId }] of Object.entries(LANGUAGE_META)) expect(monacoLanguageId(language)).toBe(monacoId)
  })

  it('lower-cases a language outside the map', () => {
    expect(monacoLanguageId('Rust')).toBe('rust')
  })
})

describe('readCodeFile', () => {
  it('reads a supported file', async () => {
    const result = await readCodeFile(new File(['print(1)\n'], 'main.py'))
    expect(result).toEqual({ ok: true, file: { fileName: 'main.py', content: 'print(1)\n', language: 'Python' } })
  })

  it('rejects an unsupported, an empty and a too long file', async () => {
    expect(await readCodeFile(new File(['%PDF'], 'notes.pdf'))).toEqual({ ok: false, code: ERROR_CODE.fileType })
    expect(await readCodeFile(new File([''], 'main.ts'))).toEqual({ ok: false, code: ERROR_CODE.fileEmpty })
    expect(await readCodeFile(new File([' \n\t'], 'main.ts'))).toEqual({ ok: false, code: ERROR_CODE.fileEmpty })
    const tooLong = new File(['a'.repeat(REVIEW_LIMIT.contentMax + 1)], 'main.ts')
    expect(await readCodeFile(tooLong)).toEqual({ ok: false, code: ERROR_CODE.fileSize })
  })

  it('accepts exactly the limit, counting CR LF as one character', async () => {
    const content = 'a'.repeat(REVIEW_LIMIT.contentMax - 2) + '\r\n' + 'b'
    expect((await readCodeFile(new File([content], 'main.ts'))).ok).toBe(true)
  })

  it('rejects a huge file by its byte size without reading it', async () => {
    const text = vi.fn(async () => 'code')
    expect(await readCodeFile({ name: 'big.ts', size: UPLOAD_MAX_BYTE + 1, text })).toEqual({ ok: false, code: ERROR_CODE.fileSize })
    expect(text).not.toHaveBeenCalled()
  })

  it('reuses the Help error table texts for an unsupported and a too large file', () => {
    const helpMessage = errorList.map((item) => item.message)
    expect(helpMessage.some((message) => ERROR_MESSAGE.fileType.startsWith(message))).toBe(true)
    expect(ERROR_MESSAGE.fileType.startsWith('Unsupported file type')).toBe(true)
    expect(ERROR_MESSAGE.fileSize.startsWith('File size exceeds limit')).toBe(true)
    expect(helpMessage).toContain('File size exceeds limit')
  })
})

describe('findingToMarker', () => {
  const lineList = ['const a = 1', 'eval(input)', '', 'x']

  it('maps each severity to the planned marker level and glyph color', () => {
    const markerList = findingToMarker(
      [finding('c', 'critical', 1), finding('h', 'high', 2), finding('m', 'medium', 3), finding('l', 'low', 4), finding('i', 'info', 4)],
      lineList
    )
    expect(markerList.map((item) => item.level)).toEqual(['error', 'error', 'warning', 'info', 'info'])
    expect(markerList.map((item) => item.glyphClassName)).toEqual([
      'editor-finding-glyph editor-finding-glyph-critical',
      'editor-finding-glyph editor-finding-glyph-high',
      'editor-finding-glyph editor-finding-glyph-medium',
      'editor-finding-glyph editor-finding-glyph-low',
      'editor-finding-glyph editor-finding-glyph-info'
    ])
  })

  // QA round 1, F2: Monaco replaces every character outside [a-z0-9-_] in a decoration class
  // name with a space, so a Tailwind variant class would reach the DOM broken apart.
  it('uses only class names Monaco keeps unchanged', () => {
    for (const className of Object.values(FINDING_GLYPH_CLASS)) {
      expect(className.replace(/[^a-z0-9\-_]/gi, ' ')).toBe(className)
    }
  })

  it('covers the whole line line_start and carries the message and detail', () => {
    const [marker] = findingToMarker([finding('h', 'high', 2)], lineList)
    expect(marker).toMatchObject({
      findingId: 'h',
      startLineNumber: 2,
      endLineNumber: 2,
      startColumn: 1,
      endColumn: 'eval(input)'.length + 1,
      message: 'message h\ndetail h'
    })
  })

  it('skips findings past the last line or before the first', () => {
    const markerList = findingToMarker([finding('a', 'low', 5), finding('b', 'low', 0), finding('c', 'low', 4)], lineList)
    expect(markerList.map((item) => item.findingId)).toEqual(['c'])
  })

  it('returns no marker without findings', () => {
    expect(findingToMarker([], lineList)).toEqual([])
  })
})

const editor = () => screen.getByTestId('monaco')
const languageSelect = () => screen.getByRole('combobox', { name: 'Language' })
const fileInput = () => screen.getByLabelText(EDITOR_TEXT.fileInput) as HTMLInputElement
const runButton = () => screen.getByRole('button', { name: 'Run review' })

async function openNewReview() {
  await renderWithStoreSettled(<App />, { route: '/review/new' })
}

describe('Upload on the Review page', () => {
  it('uploads main.py: Python is selected, the content fills the editor and the title shows the file name', async () => {
    const user = userEvent.setup()
    await openNewReview()
    expect(languageSelect()).toHaveValue('TypeScript')

    await user.click(screen.getByRole('button', { name: EDITOR_TEXT.upload }))
    await user.upload(fileInput(), new File(['print("hi")\n'], 'main.py', { type: 'text/x-python' }))

    await waitFor(() => expect(editor()).toHaveValue('print("hi")\n'))
    expect(languageSelect()).toHaveValue('Python')
    expect(editor()).toHaveAttribute('data-language', 'python')
    expect(screen.getByTestId('editor-title')).toHaveTextContent('main.py')
    expect(toast.success).toHaveBeenCalledWith(EDITOR_TEXT.fileLoaded('main.py'))
    expect(runButton()).toBeEnabled()
  })

  it('replaces existing code without asking', async () => {
    const user = userEvent.setup()
    await openNewReview()
    await user.type(editor(), 'old code')

    await user.upload(fileInput(), new File(['package main\n'], 'main.go'))

    await waitFor(() => expect(editor()).toHaveValue('package main\n'))
    expect(languageSelect()).toHaveValue('Go')
  })

  it('limits the file picker to the supported extensions', async () => {
    await openNewReview()
    expect(fileInput()).toHaveAttribute('accept', UPLOAD_ACCEPT)
  })

  it.each([
    { label: 'an unsupported file', file: () => new File(['%PDF'], 'notes.pdf'), message: ERROR_MESSAGE.fileType },
    { label: 'an empty file', file: () => new File([''], 'empty.ts'), message: ERROR_MESSAGE.fileEmpty },
    {
      label: 'a file over the limit',
      file: () => new File(['a'.repeat(REVIEW_LIMIT.contentMax + 1)], 'big.ts'),
      message: ERROR_MESSAGE.fileSize
    }
  ])('rejects $label with an error toast and keeps the code and language', async ({ file, message }) => {
    const user = userEvent.setup({ applyAccept: false })
    await openNewReview()
    await user.selectOptions(languageSelect(), 'Java')
    await user.type(editor(), 'kept')

    await user.upload(fileInput(), file())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(editor()).toHaveValue('kept')
    expect(languageSelect()).toHaveValue('Java')
    expect(screen.getByTestId('editor-title')).toHaveTextContent(EDITOR_TEXT.title)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('loads a file dropped onto the editor with the same checks', async () => {
    await openNewReview()
    const section = editor().closest('section') as HTMLElement

    fireEvent.drop(section, { dataTransfer: { types: ['Files'], files: [new File(['const a = 1\n'], 'a.test.ts')] } })
    await waitFor(() => expect(editor()).toHaveValue('const a = 1\n'))
    expect(languageSelect()).toHaveValue('TypeScript')
    expect(screen.getByTestId('editor-title')).toHaveTextContent('a.test.ts')

    fireEvent.drop(section, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'notes.pdf')] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ERROR_MESSAGE.fileType))
    expect(editor()).toHaveValue('const a = 1\n')
  })
})

describe('Typing and pasting', () => {
  it('pasted code fills the editor and enables Run review', async () => {
    const user = userEvent.setup()
    await openNewReview()
    expect(runButton()).toBeDisabled()

    await user.click(editor())
    await user.paste('const pasted = true')

    expect(editor()).toHaveValue('const pasted = true')
    expect(runButton()).toBeEnabled()
  })

  it('pasted code over the limit shows the length error and disables Run review', async () => {
    const user = userEvent.setup()
    await openNewReview()

    await user.click(editor())
    await user.paste('a'.repeat(REVIEW_LIMIT.contentMax + 1))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(runButton()).toBeDisabled()
  })
})

describe('Read-only editor', () => {
  it('has no Upload button and ignores dropped files', async () => {
    const onFileLoad = vi.fn()
    renderWithStore(<CodeEditor value="test()" language="TypeScript" title="Generated tests" onFileLoad={onFileLoad} />)

    expect(screen.queryByRole('button', { name: EDITOR_TEXT.upload })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(EDITOR_TEXT.fileInput)).not.toBeInTheDocument()
    fireEvent.drop(editor().closest('section') as HTMLElement, {
      dataTransfer: { types: ['Files'], files: [new File(['x'], 'main.ts')] }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onFileLoad).not.toHaveBeenCalled()
  })

  it('is not offered in the Generated tests tab of a saved review', async () => {
    const user = userEvent.setup()
    await renderWithStoreSettled(<App />, { route: '/review/r1' })
    expect(screen.getByRole('button', { name: EDITOR_TEXT.upload })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Generated tests/ }))
    expect(screen.queryByRole('button', { name: EDITOR_TEXT.upload })).not.toBeInTheDocument()
  })
})
