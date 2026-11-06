import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useImportSessionScope } from '../lib/importSession'
import { useAppDispatch } from '../store/hooks'
import { fetchSettings } from '../store/settings.slice'
import GlobalLoader from './GlobalLoader'
import MobileNav from './MobileNav'
import Sidebar from './Sidebar'

// The app around every page: the sidebar, the page and the mobile nav. It renders only inside
// the route guard, so the account's settings load once signed in (and again after the next
// sign-in), never for a signed-out visitor.
export default function AppShell() {
  const dispatch = useAppDispatch()
  // Plan 034: an import session ends once the user is on a page outside it.
  useImportSessionScope()

  useEffect(() => {
    dispatch(fetchSettings())
  }, [dispatch])

  // `relative` (plan 029): an absolutely positioned element inside a page (for example the
  // Dashboard's sr-only text) otherwise takes the document as its containing block, escapes this
  // clip and makes the document scroll beside <main> on a short viewport (two scrollbars).
  return (
    <div className="relative flex h-dvh overflow-hidden bg-page-bg">
      {/* Plan 037: the global loader, over the top edge, while an API request is in flight. */}
      <GlobalLoader />
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-(--mobile-nav-height) lg:pb-0">
        <Outlet />
      </div>
      <MobileNav />
    </div>
  )
}
