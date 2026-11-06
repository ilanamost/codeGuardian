import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from 'react-redux'
import { isUnsavedFileDraft, type FileDraftDto, type ImportSessionDto } from '../models/import-session.model'
import { useAppDispatch } from '../store/hooks'
import { importSessionCleared } from '../store/review.slice'
import type { RootState } from '../store'
import { ROUTE_PATH } from './route.constants'

// Plan 034: the pages that belong to an import session: /review/new (its file drafts) and the
// review Run review created for each of its files.
export function isImportSessionPath(session: ImportSessionDto, pathname: string): boolean {
  if (pathname === ROUTE_PATH.newReview) return true
  return session.fileList.some((file) => file.reviewId !== null && ROUTE_PATH.review(file.reviewId) === pathname)
}

// The file draft /review/new opens: the selected one while it has no review, else the first file
// without a review; null when every file has one (the page is then a blank new review).
export function openFileDraftOf(session: ImportSessionDto | null): FileDraftDto | null {
  if (!session) return null
  const selected = session.fileList.find((file) => file.key === session.selectedKey)
  if (selected && isUnsavedFileDraft(selected)) return selected
  return session.fileList.find(isUnsavedFileDraft) ?? null
}

// Drafts live in memory only: once the user is on a page outside the session (by a link, the
// browser's Back button or code), the session is forgotten. Mounted once, in the app shell.
export function useImportSessionScope() {
  const { pathname } = useLocation()
  const store = useStore<RootState>()
  const dispatch = useAppDispatch()
  useEffect(() => {
    const session = store.getState().review.importSession
    if (session && !isImportSessionPath(session, pathname)) dispatch(importSessionCleared())
  }, [pathname, store, dispatch])
}

// Where a held navigation was going: an in-app link (`to`), or a browser Back/Forward step
// through the history (`delta` entries, as for history.go).
export type LeaveTarget = { kind: 'link'; to: string } | { kind: 'history'; delta: number }

// The position React Router's browser history keeps in each entry's state (`idx`).
function historyIndex(state: unknown): number | undefined {
  const idx = typeof state === 'object' && state !== null ? (state as { idx?: unknown }).idx : undefined
  return typeof idx === 'number' ? idx : undefined
}

// QA 034 F-B1: React Router's browser history listens to `popstate` on the window from the
// moment the router mounts, and listeners on the window run in the order they were added (a
// capture flag does not put one first). So one listener is added here, when this module loads,
// before the router mounts, and it hands each event to the guard that is active, if any.
type PopStateHandler = (event: PopStateEvent) => void

let activePopStateHandler: PopStateHandler | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => activePopStateHandler?.(event))
}

// While `active` (unsaved file drafts are on screen) the user is asked before leaving:
// - a click on any in-app link is held (`target` is where it led);
// - QA 034 F-B1: a browser Back or Forward step is undone at once (the router never sees it) and
//   held the same way, so the page and its drafts stay until the user decides;
// - closing or reloading the tab asks the browser's own question (beforeunload).
// `leave` forgets the session and goes where the user was going; `stay` keeps everything.
// Nothing is written to browser storage.
export function useLeaveGuard(active: boolean) {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const location = useLocation()
  const [target, setTarget] = useState<LeaveTarget | null>(null)
  // The history position of the page shown, and the pop events the guard itself causes: the
  // step back that undoes a held Back/Forward (swallowed), and the confirmed one (let through).
  const indexRef = useRef<number | undefined>(undefined)
  const swallowRef = useRef(false)
  const passRef = useRef(false)

  useEffect(() => {
    indexRef.current = historyIndex(window.history.state)
  }, [location.key])

  useEffect(() => {
    if (!active) return
    swallowRef.current = false
    passRef.current = false
    // Capture phase on the document: it runs before React Router's own link handler.
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href)
      if (url.origin !== window.location.origin) return
      event.preventDefault()
      event.stopPropagation()
      setTarget({ kind: 'link', to: `${url.pathname}${url.search}${url.hash}` })
    }
    // Runs before the router's own popstate listener (see above), so stopping the event here
    // keeps the router (and the page) where it was.
    function handlePopState(event: PopStateEvent) {
      if (passRef.current) {
        passRef.current = false
        return
      }
      if (swallowRef.current) {
        swallowRef.current = false
        event.stopImmediatePropagation()
        return
      }
      const next = historyIndex(event.state)
      const current = indexRef.current
      if (next === undefined || current === undefined || next === current) return
      event.stopImmediatePropagation()
      const delta = next - current
      swallowRef.current = true
      window.history.go(-delta)
      setTarget({ kind: 'history', delta })
    }
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    document.addEventListener('click', handleClick, true)
    activePopStateHandler = handlePopState
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      if (activePopStateHandler === handlePopState) activePopStateHandler = null
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [active])

  const leave = useCallback(() => {
    const held = target
    setTarget(null)
    dispatch(importSessionCleared())
    if (!held) return
    if (held.kind === 'link') {
      navigate(held.to)
      return
    }
    // This step goes to the router as a normal Back/Forward.
    passRef.current = true
    window.history.go(held.delta)
  }, [dispatch, navigate, target])

  const stay = useCallback(() => setTarget(null), [])

  return { target, leave, stay }
}
