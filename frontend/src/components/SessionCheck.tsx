import { LoaderCircle } from 'lucide-react'
import { SESSION_TEXT } from '../lib/session.constants'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { restoreSession, selectSessionStatus } from '../store/session.slice'
import { PAGE_ERROR_MESSAGE } from '../utils/error-messages'

// The full page shown while the session is unknown (never a flash of /login or of the app), or
// when the restore failed for another reason than a 401 (with Retry).
export default function SessionCheck() {
  const dispatch = useAppDispatch()
  const status = useAppSelector(selectSessionStatus)

  return (
    <div className="flex h-dvh items-center justify-center bg-page-bg p-4">
      {status === 'failed' ? (
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p role="alert" className="text-sm">
            {PAGE_ERROR_MESSAGE.sessionUnavailable}
          </p>
          <button
            type="button"
            onClick={() => dispatch(restoreSession())}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {SESSION_TEXT.retry}
          </button>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
          <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />
          {SESSION_TEXT.checking}
        </p>
      )}
    </div>
  )
}
