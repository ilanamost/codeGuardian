import { isAsyncThunkAction, type Middleware } from '@reduxjs/toolkit'

// QA D1 (plan 028, revision 1): no answer of a previous session reaches the store. Every thunk
// is tagged with the session generation it started under (`pending`); its `fulfilled` or
// `rejected` is dropped when a sign-out or a session that ended has bumped the generation since,
// so a response in flight at sign-out never lands in the next account's freshly reset state (and
// raises no toast). The thunk's own promise still settles for its caller.
type StateWithGeneration = { session: { generation: number } }

export function createStaleGuard(): Middleware<object, StateWithGeneration> {
  const generationOf = new Map<string, number>()
  return (api) => (next) => (action) => {
    if (!isAsyncThunkAction(action)) return next(action)
    const { requestId, requestStatus } = action.meta
    const current = api.getState().session.generation
    if (requestStatus === 'pending') {
      generationOf.set(requestId, current)
      return next(action)
    }
    const started = generationOf.get(requestId)
    generationOf.delete(requestId)
    // A thunk skipped by its condition has no pending: it is never stale.
    if (started !== undefined && started !== current) return action
    return next(action)
  }
}
