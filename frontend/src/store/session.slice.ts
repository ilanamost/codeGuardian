import { createAction, createSlice } from '@reduxjs/toolkit'
import { HTTP_STATUS } from '../lib/api.constants'
import { AppError, type AppErrorJson } from '../models/app-error'
import type { RegistrationDto, SessionDto, SignInDto } from '../models/dto'
import { ERROR_CODE } from '../utils/error-messages'
import { attempt, createAppAsyncThunk, type AsyncStatus } from './thunk'
import type { RootState } from './index'

// The server-side session (plan 028). The app is usable only when signed in: the status starts
// `unknown` until GET /api/session answers once on load.
// - unknown: not checked yet (the guard shows "Checking your session...");
// - signedIn / signedOut: the answer of the restore, a sign-in, a registration or a sign-out;
// - failed: the restore failed for another reason than a 401 (the guard offers Retry).
export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut' | 'failed'

// Why the user is signed out: they signed out (no target is kept), or the session ended
// mid-use (a 401; the guard keeps the current path as the target).
export type SessionEnd = 'signOut' | 'ended' | null

export interface SessionState {
  status: SessionStatus
  // When the session ends without further requests (from the restore), or null.
  expiresAt: string | null
  end: SessionEnd
  restoreStatus: AsyncStatus
  signInStatus: AsyncStatus
  signInError: AppErrorJson | null
  registerStatus: AsyncStatus
  registerError: AppErrorJson | null
  signOutStatus: AsyncStatus
  // Plan 040: whether GitHub sign-in is configured (GET /api/health); null until known.
  githubSignIn: boolean | null
  // Bumped by every reset (sign-out, session ended; QA D1). A thunk started under an older value
  // belongs to the previous session: its answer is dropped (store/staleGuard.ts).
  generation: number
}

export function initialSessionState(): SessionState {
  return {
    status: 'unknown',
    expiresAt: null,
    end: null,
    restoreStatus: 'idle',
    signInStatus: 'idle',
    signInError: null,
    registerStatus: 'idle',
    registerError: null,
    signOutStatus: 'idle',
    githubSignIn: null,
    generation: 0
  }
}

// Any request answered 401 after sign-in (except the restore, sign-in and registration
// themselves): the listener dispatches this once; the root reducer resets the app state.
export const sessionEnded = createAction('session/ended')

const canCheck = (state: RootState) =>
  ['unknown', 'failed'].includes(state.session.status) && state.session.restoreStatus !== 'loading'

// GET /api/session once on load (skipped while it runs and once it answered). A 401 is not an error here: it means signed out, so it resolves with null.
export const restoreSession = createAppAsyncThunk(
  'session/restore',
  async (_: void, { extra, rejectWithValue }) => {
    try {
      const session: SessionDto | null = await extra.session.restore()
      return session
    } catch (error) {
      const appError = AppError.from(error, ERROR_CODE.sessionRestore)
      if (appError.status === HTTP_STATUS.unauthorized) return null
      return rejectWithValue(appError.forAction(ERROR_CODE.sessionRestore).toJSON())
    }
  },
  { condition: (_, { getState }) => canCheck(getState()) }
)

// Plan 040: reads the health flag once. A failure is silent and means "not available" (the button
// stays hidden), so this thunk never rejects.
export const fetchGithubSignIn = createAppAsyncThunk(
  'session/fetchGithubSignIn',
  async (_: void, { extra }): Promise<boolean> => {
    try {
      return await extra.session.githubSignIn()
    } catch {
      return false
    }
  },
  { condition: (_, { getState }) => getState().session.githubSignIn === null }
)

export const signIn = createAppAsyncThunk(
  'session/signIn',
  (input: SignInDto, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.signIn, rejectWithValue, () => extra.session.signIn(input)),
  { condition: (_, { getState }) => getState().session.signInStatus !== 'loading' }
)

export const register = createAppAsyncThunk(
  'session/register',
  (input: RegistrationDto, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.register, rejectWithValue, () => extra.account.register(input)),
  { condition: (_, { getState }) => getState().session.registerStatus !== 'loading' }
)

// DELETE /api/session, then the settings cache (`cr.settings`) is dropped; on success the root
// reducer resets the app state. On failure the user stays signed in.
export const signOut = createAppAsyncThunk(
  'session/signOut',
  (_: void, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.signOut, rejectWithValue, async () => {
      await extra.session.signOut()
      extra.settings.clearCache()
      // A GET of this session still in flight never answers the next one (QA D1).
      extra.session.abortAll()
    }),
  { condition: (_, { getState }) => getState().session.signOutStatus !== 'loading' }
)

function signedIn(state: SessionState) {
  state.status = 'signedIn'
  state.end = null
}

const sessionSlice = createSlice({
  name: 'session',
  initialState: initialSessionState(),
  reducers: {
    // The login or register form was edited: its server error no longer applies.
    signInErrorCleared: (state) => {
      state.signInError = null
      if (state.signInStatus === 'failed') state.signInStatus = 'idle'
    },
    registerErrorCleared: (state) => {
      state.registerError = null
      if (state.registerStatus === 'failed') state.registerStatus = 'idle'
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(restoreSession.pending, (state) => {
        state.restoreStatus = 'loading'
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.restoreStatus = 'succeeded'
        // A sign-in that finished first wins over an older restore answer.
        if (state.status === 'signedIn') return
        if (action.payload) {
          signedIn(state)
          state.expiresAt = action.payload.expiresAt
        } else {
          state.status = 'signedOut'
        }
      })
      .addCase(restoreSession.rejected, (state, action) => {
        if (action.meta.condition) return
        state.restoreStatus = 'failed'
        if (state.status !== 'signedIn') state.status = 'failed'
      })
      .addCase(fetchGithubSignIn.fulfilled, (state, action) => {
        state.githubSignIn = action.payload
      })
      .addCase(signIn.pending, (state) => {
        state.signInStatus = 'loading'
        state.signInError = null
      })
      .addCase(signIn.fulfilled, (state) => {
        state.signInStatus = 'succeeded'
        signedIn(state)
      })
      .addCase(signIn.rejected, (state, action) => {
        if (action.meta.condition) return
        state.signInStatus = 'failed'
        state.signInError = action.payload ?? null
      })
      .addCase(register.pending, (state) => {
        state.registerStatus = 'loading'
        state.registerError = null
      })
      .addCase(register.fulfilled, (state) => {
        state.registerStatus = 'succeeded'
        signedIn(state)
      })
      .addCase(register.rejected, (state, action) => {
        if (action.meta.condition) return
        state.registerStatus = 'failed'
        state.registerError = action.payload ?? null
      })
      .addCase(signOut.pending, (state) => {
        state.signOutStatus = 'loading'
      })
      .addCase(signOut.fulfilled, (state) => ({ ...initialSessionState(), status: 'signedOut', end: 'signOut', generation: state.generation + 1 }))
      .addCase(signOut.rejected, (state, action) => {
        if (action.meta.condition) return
        state.signOutStatus = 'failed'
      })
      .addCase(sessionEnded, (state) => ({ ...initialSessionState(), status: 'signedOut', end: 'ended', generation: state.generation + 1 }))
  }
})

export const { signInErrorCleared, registerErrorCleared } = sessionSlice.actions
export const sessionReducer = sessionSlice.reducer

// The actions after which every other slice starts over (the root reducer, store/index.ts).
export function isSessionReset(action: unknown): boolean {
  return signOut.fulfilled.match(action) || sessionEnded.match(action)
}

export const selectSession = (state: RootState) => state.session
export const selectGithubSignIn = (state: RootState) => state.session.githubSignIn
export const selectSessionStatus = (state: RootState) => state.session.status
