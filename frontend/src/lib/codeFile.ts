import { toLf } from '../services/util.service'
import { ERROR_CODE, type ErrorCode } from '../utils/error-messages'
import { LANGUAGE_BY_EXTENSION, LANGUAGE_META, REVIEW_LIMIT, UPLOAD_MAX_BYTE } from './review.constants'

// The language of a file name, from its last extension (case-insensitive), or null when the
// extension is missing or not in LANGUAGE_META. `a.test.ts` is TypeScript.
export function languageFromFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  return LANGUAGE_BY_EXTENSION[base.slice(dot).toLowerCase()] ?? null
}

// Monaco's language id for a language of the selector; any other value is passed in lower case.
export function monacoLanguageId(language: string): string {
  return LANGUAGE_META[language]?.monacoId ?? language.toLowerCase()
}

export type CodeFile = { fileName: string; content: string; language: string }

export type CodeFileResult = { ok: true; file: CodeFile } | { ok: false; code: ErrorCode }

type FileLike = Pick<File, 'name' | 'size' | 'text'>

// Reads an uploaded or dropped code file in the browser. It is rejected when its extension is
// not supported, when it is surely too large (checked on the byte size, before reading), when it
// has more than REVIEW_LIMIT.contentMax characters (counted with LF line breaks, as the Review
// page counts them) or when it has no code.
export async function readCodeFile(file: FileLike): Promise<CodeFileResult> {
  const language = languageFromFileName(file.name)
  if (!language) return { ok: false, code: ERROR_CODE.fileType }
  if (file.size > UPLOAD_MAX_BYTE) return { ok: false, code: ERROR_CODE.fileSize }
  const content = await file.text()
  if (!content.trim()) return { ok: false, code: ERROR_CODE.fileEmpty }
  if (toLf(content).length > REVIEW_LIMIT.contentMax) return { ok: false, code: ERROR_CODE.fileSize }
  return { ok: true, file: { fileName: file.name, content, language } }
}
