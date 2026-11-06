import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { FILE_DRAFT_TEXT } from '../lib/review.constants'
import { useReducedMotion } from '../lib/useReducedMotion'
import type { FileDraftDto, ImportSessionDto } from '../models/import-session.model'
import { FileDraftItem, FileDraftMeta } from './FileDraftItem'
import { fileDraftTitleOf, isOpenableFileDraft } from '../lib/fileDraft'

type Props = {
  session: ImportSessionDto
  selectedKey: string | null
  onSelect: (file: FileDraftDto) => void
}

export const FILE_DRAFT_MENU_ID = 'file-draft-menu'

// Plan 038, Revision 1 (Open Question 4A): the imported files on phones (below `md`). One
// full-width row shows the open file, its language and status mark, and "N of M"; tapping it
// opens a vertical list under it (at most half the screen high, scrolling up and down) with every
// file as a full-width row: path, language, mark and, for a file that cannot be opened, the
// reason (disabled). Choosing a file closes the list. A custom list, not a native `select`,
// because a `select` cannot show marks, reasons or disabled rows with a reason.
// Keyboard: Enter or Space on the row opens and closes; ArrowDown/ArrowUp on the row open the list;
// in the list ArrowDown/ArrowUp/Home/End move between the files that can be opened; Escape, or a
// tap outside, closes the list and returns the focus to the row. Leaving the list with Tab closes it.
// The list is UI-only state, kept here.
export default function FileDraftPicker({ session, selectedKey, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Where the focus goes once the list is open: the selected file, the first or the last one.
  const focusTarget = useRef<'selected' | 'first' | 'last'>('selected')

  const index = session.fileList.findIndex((file) => file.key === selectedKey)
  const selected = index >= 0 ? session.fileList[index] : undefined

  function enabledButtonList(): HTMLButtonElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  }

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const buttonList = enabledButtonList()
    const current = listRef.current?.querySelector<HTMLButtonElement>('button[aria-current="true"]:not(:disabled)')
    const target = focusTarget.current === 'first' ? buttonList[0] : focusTarget.current === 'last' ? buttonList.at(-1) : (current ?? buttonList[0])
    target?.focus()
  }, [open])

  // A tap outside closes the list; the focus returns to the row unless the tap focused something else.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setTimeout(() => {
        const active = document.activeElement
        if (!active || active === document.body) triggerRef.current?.focus()
      }, 0)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function openWith(target: 'selected' | 'first' | 'last') {
    focusTarget.current = target
    setOpen(true)
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (open) {
        const buttonList = enabledButtonList()
        ;(event.key === 'ArrowDown' ? buttonList[0] : buttonList.at(-1))?.focus()
      } else openWith(event.key === 'ArrowDown' ? 'selected' : 'last')
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const buttonList = enabledButtonList()
    const at = buttonList.indexOf(document.activeElement as HTMLButtonElement)
    let next: HTMLButtonElement | undefined
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'ArrowDown') next = buttonList[at < 0 ? 0 : (at + 1) % buttonList.length]
    else if (event.key === 'ArrowUp') next = buttonList[at <= 0 ? buttonList.length - 1 : at - 1]
    else if (event.key === 'Home') next = buttonList[0]
    else if (event.key === 'End') next = buttonList.at(-1)
    else return
    event.preventDefault()
    next?.focus()
  }

  function choose(file: FileDraftDto) {
    onSelect(file)
    close(true)
  }

  return (
    <nav
      ref={rootRef}
      aria-label={FILE_DRAFT_TEXT.listLabel}
      className="relative h-full"
      onBlur={(event) => {
        // Tab out of the row and the list: close without moving the focus.
        if (open && !rootRef.current?.contains(event.relatedTarget as Node | null) && event.relatedTarget !== null) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={FILE_DRAFT_MENU_ID}
        title={selected ? fileDraftTitleOf(selected) : undefined}
        onClick={() => (open ? close(true) : openWith('selected'))}
        onKeyDown={onTriggerKeyDown}
        className="flex h-full w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-page-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span data-testid="file-draft-summary" className="flex min-w-0 flex-1 flex-col">
          <span title={selected?.path} className="truncate font-mono text-sm leading-5 font-medium text-text">
            {selected?.path ?? FILE_DRAFT_TEXT.noOpenFile}
          </span>
          {selected && <FileDraftMeta file={selected} />}
        </span>
        <span className="shrink-0 text-xs text-text-muted">{FILE_DRAFT_TEXT.position(index + 1, session.fileList.length)}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-text-muted ${open ? 'rotate-180' : ''} ${reducedMotion ? '' : 'transition-transform duration-150'}`}
        />
      </button>
      <ul
        ref={listRef}
        id={FILE_DRAFT_MENU_ID}
        aria-label={FILE_DRAFT_TEXT.menuLabel}
        hidden={!open}
        onKeyDown={onListKeyDown}
        className="absolute inset-x-0 top-full z-30 flex max-h-[50dvh] flex-col gap-1 overflow-y-auto overscroll-contain border-b border-border bg-card p-2 shadow-lg"
      >
        {session.fileList.map((file) => {
          const current = file.key === selectedKey
          return (
            <li key={file.key}>
              <button
                type="button"
                disabled={!isOpenableFileDraft(file)}
                aria-current={current ? 'true' : undefined}
                title={fileDraftTitleOf(file)}
                onClick={() => choose(file)}
                className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-md border px-2 py-2 text-left ${
                  current ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-page-bg'
                } focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-75`}
              >
                <FileDraftItem file={file} />
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
