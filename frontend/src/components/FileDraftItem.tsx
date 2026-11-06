import { CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { detailOf } from '../lib/fileDraft'
import { FILE_DRAFT_TEXT } from '../lib/review.constants'
import { fileDraftMarkOf, type FileDraftDto, type FileDraftMark } from '../models/import-session.model'

// Plan 034 / 038: one imported file as shown in the file list (md and up) and in the phone
// dropdown: its path, language, status mark and, for a file that cannot be opened, the reason.

const markMeta: Record<FileDraftMark, { Icon: LucideIcon; className: string }> = {
  draft: { Icon: CircleDashed, className: 'text-text-muted' },
  analyzing: { Icon: LoaderCircle, className: 'animate-spin text-primary' },
  reviewed: { Icon: CircleCheck, className: 'text-success' },
  reviewFailed: { Icon: CircleX, className: 'text-error-text' },
  importFailed: { Icon: TriangleAlert, className: 'text-error-text' },
  skipped: { Icon: CircleMinus, className: 'text-text-muted' }
}

/** The language and the status mark of a file, on one line. */
export function FileDraftMeta({ file }: { file: FileDraftDto }) {
  const mark = fileDraftMarkOf(file)
  const { Icon, className } = markMeta[mark]
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
      {file.language && <span>{file.language}</span>}
      {file.language && <span aria-hidden="true">·</span>}
      <Icon size={12} aria-hidden="true" className={`shrink-0 ${className}`} />
      <span data-testid="file-draft-mark">{FILE_DRAFT_TEXT.mark[mark]}</span>
    </span>
  )
}

/** The content of one file row: path, language and mark, and the reason when it cannot be opened. */
export function FileDraftItem({ file }: { file: FileDraftDto }) {
  const detail = detailOf(file)
  return (
    <>
      <span className="font-mono text-sm font-medium break-all whitespace-normal">{file.path}</span>
      <FileDraftMeta file={file} />
      {detail && <span className="text-xs whitespace-normal text-error-text">{detail}</span>}
    </>
  )
}
