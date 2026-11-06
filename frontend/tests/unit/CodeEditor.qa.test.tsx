import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { languageFromFileName, readCodeFile } from '../../src/lib/codeFile'
import { findingToMarker } from '../../src/lib/findingMarker'
import { EDITOR_TEXT, REVIEW_LIMIT, UPLOAD_MAX_BYTE } from '../../src/lib/review.constants'
import type { Finding } from '../../src/types'
import { ERROR_CODE, ERROR_MESSAGE } from '../../src/utils/error-messages'
import { renderWithStoreSettled } from '../utils/renderWithStore'

// QA (AI-39): adversarial checks for plan 021, the code editor. The known defects found in QA
// round 1 are fixed; their tests are named "D<n> fixed".
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

const editor = () => screen.getByTestId('monaco')
const languageSelect = () => screen.getByRole('combobox', { name: 'Language' })
const fileInput = () => screen.getByLabelText(EDITOR_TEXT.fileInput) as HTMLInputElement
const title = () => screen.getByTestId('editor-title')

function fileLike(name: string, content: string, size = new TextEncoder().encode(content).length) {
  return { name, size, text: () => Promise.resolve(content) }
}

describe('QA: languageFromFileName edge cases', () => {
  it.each([
    ['main.py.ts', 'TypeScript'],
    ['App.Test.TSX', 'TypeScript'],
    ['Main.JAVA', 'Java'],
    ['SERVER.GO', 'Go'],
    ['index.MJS', 'JavaScript'],
    ['types.d.cts', 'TypeScript'],
    ['C:\\work\\src\\main.go', 'Go'],
    ['../a.b.c/script.py', 'Python']
  ])('%s is %s', (name, language) => {
    expect(languageFromFileName(name)).toBe(language)
  })

  it.each(['archive.ts.bak', 'main.ts.pdf', 'main.tsx~', 'main.pyc', 'main.typescript', '..', '.', 'dir.ts/'])('%s is not supported', (name) => {
    expect(languageFromFileName(name)).toBeNull()
  })
})

describe('QA: readCodeFile multibyte content near the limit', () => {
  it('accepts contentMax two-byte characters although the file has 2x contentMax bytes', async () => {
    const content = 'é'.repeat(REVIEW_LIMIT.contentMax)
    const result = await readCodeFile(fileLike('accents.py', content))
    expect(result.ok).toBe(true)
  })

  it('rejects contentMax + 1 two-byte characters as too large', async () => {
    const result = await readCodeFile(fileLike('accents.py', 'é'.repeat(REVIEW_LIMIT.contentMax + 1)))
    expect(result).toEqual({ ok: false, code: ERROR_CODE.fileSize })
  })

  it('accepts three-byte CJK text at exactly the limit', async () => {
    const result = await readCodeFile(fileLike('cjk.ts', '漢'.repeat(REVIEW_LIMIT.contentMax)))
    expect(result.ok).toBe(true)
  })

  it('counts emoji in UTF-16 units, the same way the Review page does', async () => {
    const half = REVIEW_LIMIT.contentMax / 2
    expect((await readCodeFile(fileLike('emoji.ts', '😀'.repeat(half)))).ok).toBe(true)
    expect(await readCodeFile(fileLike('emoji.ts', '😀'.repeat(half + 1)))).toEqual({ ok: false, code: ERROR_CODE.fileSize })
  })

  it('rejects a file one byte over UPLOAD_MAX_BYTE without reading it', async () => {
    const text = vi.fn(() => Promise.resolve('x'))
    const result = await readCodeFile({ name: 'big.ts', size: UPLOAD_MAX_BYTE + 1, text })
    expect(result).toEqual({ ok: false, code: ERROR_CODE.fileSize })
    expect(text).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only file and a BOM-only-like whitespace file as empty', async () => {
    expect(await readCodeFile(fileLike('blank.ts', ' \n\t\r\n  '))).toEqual({ ok: false, code: ERROR_CODE.fileEmpty })
    expect(await readCodeFile(fileLike('blank.ts', '\uFEFF\n'))).toEqual({ ok: false, code: ERROR_CODE.fileEmpty })
  })

  it('checks the extension before the size, so a huge PDF reports the file type', async () => {
    expect(await readCodeFile({ name: 'huge.pdf', size: UPLOAD_MAX_BYTE * 10, text: () => Promise.resolve('') })).toEqual({
      ok: false,
      code: ERROR_CODE.fileType
    })
  })
})

describe('QA: findingToMarker malformed findings', () => {
  const lineList = ['a', 'bb', '']
  const base: Finding = { id: 'f', severity: 'high', category: 'bug', message: 'm', detail: '', line_start: 1 }

  it('skips zero, negative, fractional, NaN and past-the-end lines', () => {
    const list = [0, -1, 1.5, Number.NaN, 4, Number.POSITIVE_INFINITY].map((line, index) => ({ ...base, id: `f${index}`, line_start: line }))
    expect(findingToMarker(list, lineList)).toEqual([])
  })

  it('keeps two findings on the same line and marks an empty last line', () => {
    const result = findingToMarker(
      [
        { ...base, id: 'a', line_start: 2 },
        { ...base, id: 'b', severity: 'low', line_start: 2 },
        { ...base, id: 'c', line_start: 3 }
      ],
      lineList
    )
    expect(result.map((item) => [item.findingId, item.startLineNumber, item.endColumn])).toEqual([
      ['a', 2, 3],
      ['b', 2, 3],
      ['c', 3, 1]
    ])
  })

  it('uses the message alone when there is no detail', () => {
    expect(findingToMarker([base], lineList)[0].message).toBe('m')
  })
})

describe('QA: upload interactions on the Review page', () => {
  async function openNewReview() {
    await renderWithStoreSettled(<App />, { route: '/review/new' })
  }

  it('upload then a manual language change keeps the code and uses the chosen language', async () => {
    const user = userEvent.setup()
    await openNewReview()
    await user.upload(fileInput(), new File(['print(1)\n'], 'main.py'))
    await waitFor(() => expect(editor()).toHaveValue('print(1)\n'))

    await user.selectOptions(languageSelect(), 'Java')

    expect(languageSelect()).toHaveValue('Java')
    expect(editor()).toHaveAttribute('data-language', 'java')
    expect(editor()).toHaveValue('print(1)\n')
  })

  it('a rejected upload after a good one keeps the previous file, title and language', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await openNewReview()
    await user.upload(fileInput(), new File(['package main\n'], 'main.go'))
    await waitFor(() => expect(title()).toHaveTextContent('main.go'))

    await user.upload(fileInput(), new File(['x'], 'notes.PDF'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ERROR_MESSAGE.fileType))
    expect(title()).toHaveTextContent('main.go')
    expect(languageSelect()).toHaveValue('Go')
    expect(editor()).toHaveValue('package main\n')
  })

  it('uploading the same file twice loads it twice (input value is reset)', async () => {
    const user = userEvent.setup()
    await openNewReview()
    const file = new File(['const a = 1\n'], 'a.ts')
    await user.upload(fileInput(), file)
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    await user.type(editor(), ' edited')

    await user.upload(fileInput(), file)

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2))
    expect(editor()).toHaveValue('const a = 1\n')
  })

  it('an uppercase extension is accepted and selects the language', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await openNewReview()
    await user.upload(fileInput(), new File(['class A {}\n'], 'A.JAVA'))
    await waitFor(() => expect(languageSelect()).toHaveValue('Java'))
    expect(title()).toHaveTextContent('A.JAVA')
  })

  it('D3 fixed: two rapid uploads end with the file chosen last, even when the first one reads slower', async () => {
    await openNewReview()
    let resolveFirst: (value: string) => void = () => {}
    const first = new File(['first'], 'first.py')
    Object.defineProperty(first, 'text', { value: () => new Promise<string>((resolve) => (resolveFirst = resolve)) })
    const second = new File(['second\n'], 'second.go')

    fireEvent.change(fileInput(), { target: { files: [first] } })
    fireEvent.change(fileInput(), { target: { files: [second] } })
    await waitFor(() => expect(editor()).toHaveValue('second\n'))

    await act(async () => {
      resolveFirst('first\n')
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(editor()).toHaveValue('second\n')
    expect(title()).toHaveTextContent('second.go')
    expect(languageSelect()).toHaveValue('Go')
  })
})
