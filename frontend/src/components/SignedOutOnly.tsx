import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { redirectTargetOf } from '../lib/route.constants'
import { useAppSelector } from '../store/hooks'
import { selectSessionStatus } from '../store/session.slice'
import SessionCheck from './SessionCheck'

// The login and register pages. A signed-in visitor goes to the target the guard
// kept (checked by safeRedirectTarget: only an internal path), or to `/`; so after a sign-in or a
// registration the app lands where the user asked to go.
export default function SignedOutOnly({ children }: { children: ReactNode }) {
  const status = useAppSelector(selectSessionStatus)
  const location = useLocation()

  if (status === 'unknown' || status === 'failed') return <SessionCheck />
  if (status === 'signedIn') return <Navigate to={redirectTargetOf(location.state)} replace />
  return children
}
