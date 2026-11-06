import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { FILE_DRAFT_TEXT } from '../lib/review.constants'
import { useBreakpoint } from '../lib/useBreakpoint'
import { useReducedMotion } from '../lib/useReducedMotion'
import type { FileDraftDto, ImportSessionDto } from '../models/import-session.model'
import FileDraftPicker from './FileDraftPicker'
import { FileDraftItem } from './FileDraftItem'
import { fileDraftTitleOf, isOpenableFileDraft } from '../lib/fileDraft'

type Props = {
  session: ImportSessionDto
  // The file shown on the page (its draft on /review/new, or its review).
  selectedKey: string | null
  onSelect: (file: FileDraftDto) => void
  // Plan 038: whether the list is open (md and up), and the toggle that closes or opens it.
  open: boolean
  onToggle: () => void
}

export const FILE_DRAFT_LIST_ID = 'file-draft-list'

// Plan 034: the files of an import session, each with its language and a status mark (draft,
// analyzing, reviewed, review failed; not imported or skipped files are listed but cannot be
// opened), as a vertical list beside the page from `md` up.
// Plan 038: a toggle closes and opens the list. Closed, it is a slim rail with the toggle, the
// file count and the open file's name, so the editor gets the freed space. The list stays mounted
// (`hidden`: out of view, the Tab order and the accessibility tree), so nothing is lost or
// refetched. The width change is animated unless reduced motion. The toggle sits at the panel's
// left edge, clear of the top-center toasts (QA 038 F1).
// Plan 038, Revision 1: below `md` the panel is one row, a dropdown of the files (FileDraftPicker),
// and there is no toggle (the row is as small as a closed bar). jsdom has no matchMedia: unit tests
// get the `md` and up layout unless they mock it.
export default function FileDraftList({ session, selectedKey, onSelect, open, onToggle }: Props) {
  const isTabletUp = useBreakpoint('md', true)
  const reducedMotion = useReducedMotion()

  if (!isTabletUp) {
    return (
      <div data-testid="file-draft-panel" className="h-11 shrink-0 border-b border-border bg-card">
        <FileDraftPicker session={session} selectedKey={selectedKey} onSelect={onSelect} />
      </div>
    )
  }

  const selectedPath = session.fileList.find((file) => file.key === selectedKey)?.path
  const ToggleIcon = open ? PanelLeftClose : PanelLeftOpen
  const toggleLabel = open ? FILE_DRAFT_TEXT.hideList : FILE_DRAFT_TEXT.showList
  return (
    <div
      data-testid="file-draft-panel"
      data-open={open ? 'true' : 'false'}
      className={`flex min-w-0 shrink-0 flex-col items-stretch overflow-hidden border-r border-border bg-card ${open ? 'w-60 lg:w-64' : 'w-10'} ${
        reducedMotion ? '' : 'transition-[width] duration-200 ease-out'
      }`}
    >
      <div className={`flex items-center gap-1 p-1 ${open ? 'shrink-0 pt-3 pr-3' : 'min-h-0 min-w-0 flex-1 flex-col gap-2 py-2'}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={FILE_DRAFT_LIST_ID}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={onToggle}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-page-bg hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <ToggleIcon size={16} aria-hidden="true" />
        </button>
        {open && (
          <p title={session.name} className="min-w-0 flex-1 truncate text-xs font-semibold text-text-muted">
            {FILE_DRAFT_TEXT.title(session.name)}
          </p>
        )}
        {!open && (
          <p
            data-testid="file-draft-summary"
            className="flex min-h-0 min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs text-text-muted [writing-mode:vertical-rl]"
          >
            <span className="shrink-0 font-semibold">{FILE_DRAFT_TEXT.fileCount(session.fileList.length)}</span>
            <span aria-hidden="true">·</span>
            <span title={selectedPath} className="min-h-0 min-w-0 truncate font-mono text-text">
              {selectedPath ?? FILE_DRAFT_TEXT.noOpenFile}
            </span>
          </p>
        )}
      </div>
      <nav id={FILE_DRAFT_LIST_ID} aria-label={FILE_DRAFT_TEXT.listLabel} hidden={!open} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto p-2">
          {session.fileList.map((file) => {
            const selected = file.key === selectedKey
            return (
              <li key={file.key}>
                <button
                  type="button"
                  disabled={!isOpenableFileDraft(file)}
                  aria-current={selected ? 'true' : undefined}
                  title={fileDraftTitleOf(file)}
                  onClick={() => onSelect(file)}
                  className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left ${
                    selected ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-page-bg'
                  } focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-75`}
                >
                  <FileDraftItem file={file} />
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
