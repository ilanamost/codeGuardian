import { useEffect } from 'react'
import { accountFailureReported, fetchAccount, selectAccountState } from '../store/account.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'

// The single user's profile from GET /api/account, loaded once per session by whichever
// component needs it first (the thunk skips a second load). A `silent` caller (the Sidebar) loads
// it in the background: its failure shows no toast unless a page that shows the account asks too.
export function useAccount({ silent = false }: { silent?: boolean } = {}) {
  const dispatch = useAppDispatch()
  const { account, status } = useAppSelector(selectAccountState)

  useEffect(() => {
    if (!silent) dispatch(accountFailureReported())
    dispatch(fetchAccount({ silent }))
  }, [dispatch, silent])

  return { account, status }
}
