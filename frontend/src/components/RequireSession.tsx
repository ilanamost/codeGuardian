import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ROUTE_PATH, type RedirectState } from '../lib/route.constants'
import { useAppSelector } from '../store/hooks'
import { selectSession } from '../store/session.slice'
import SessionCheck from './SessionCheck'

// The route guard (plan 028, Scope 11): a layout route around every app route. A signed-out visitor goes to /login with the asked-for
// path, search and hash in router state (not after an explicit sign-out), and nothing of the app
// renders until the session is known.
export default function RequireSession() {
  const { status, end } = useAppSelector(selectSession)
  const location = useLocation()

  if (status === 'signedIn') return <Outlet />
  if (status === 'unknown' || status === 'failed') return <SessionCheck />
  const state: RedirectState | undefined = end === 'signOut' ? undefined : { from: `${location.pathname}${location.search}${location.hash}` }
  return <Navigate to={ROUTE_PATH.login} replace state={state} />
}
