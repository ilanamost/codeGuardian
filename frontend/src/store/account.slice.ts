import { createSlice } from '@reduxjs/toolkit'
import { AppError, type AppErrorJson } from '../models/app-error'
import type { AccountDto, AccountUpdateDto, PasswordChangeDto } from '../models/dto'
import { ERROR_CODE } from '../utils/error-messages'
import { register, restoreSession, signIn } from './session.slice'
import { attempt, createAppAsyncThunk, type AsyncStatus } from './thunk'
import type { RootState } from './index'

// The signed-in account's profile (Account panel, the sidebar, Contact Support email), the
// password change and the profile photo. The account comes with the session
// (restore, sign-in or registration), so no extra GET /api/account is sent on load.
export interface AccountState {
  account: AccountDto | null
  status: AsyncStatus
  error: AppErrorJson | null
  passwordStatus: AsyncStatus
  // The last failed password change; its `issueList` names the field to mark (422).
  passwordError: AppErrorJson | null
  avatarStatus: AsyncStatus
  // Plan 040: linking or unlinking GitHub sign-in.
  githubStatus: AsyncStatus
  // Plan 034: the user name and email change (PUT /api/account); its last failure, whose status
  // and `issueList` the Account panel shows under the form.
  updateStatus: AsyncStatus
  updateError: AppErrorJson | null
  // Whether a failed load is reported (a toast): false for a background load only (the Sidebar),
  // true as soon as a page that shows the account asks for it.
  reportFailure: boolean
}

export const initialAccountState: AccountState = {
  account: null,
  status: 'idle',
  error: null,
  passwordStatus: 'idle',
  passwordError: null,
  avatarStatus: 'idle',
  githubStatus: 'idle',
  updateStatus: 'idle',
  updateError: null,
  reportFailure: false
}

export interface FetchAccountOption {
  // A background load whose failure shows no toast.
  silent?: boolean
}

// Loaded once per session: skipped while a load runs or after it succeeded (or after the
// session brought it).
export const fetchAccount = createAppAsyncThunk(
  'account/fetch',
  (_: FetchAccountOption | void, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.accountLoad, rejectWithValue, () => extra.account.get()),
  { condition: (_, { getState }) => !['loading', 'succeeded'].includes(getState().account.status) }
)

export const changePassword = createAppAsyncThunk('account/changePassword', (input: PasswordChangeDto, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.passwordChange, rejectWithValue, () => extra.account.changePassword(input))
)

// Plan 034: the answer is the updated account, so the panel and the sidebar change at once.
export const updateAccount = createAppAsyncThunk(
  'account/update',
  (input: AccountUpdateDto, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.accountUpdate, rejectWithValue, () => extra.account.update(input)),
  { condition: (_, { getState }) => getState().account.updateStatus !== 'loading' }
)

// Plan 040: the GitHub authorize URL to navigate to (the component does it); nothing is kept.
export const linkGithub = createAppAsyncThunk(
  'account/linkGithub',
  (_: void, { extra, rejectWithValue }) => attempt(ERROR_CODE.githubSignInLink, rejectWithValue, () => extra.account.linkGithub()),
  { condition: (_, { getState }) => getState().account.githubStatus !== 'loading' }
)

// Plan 040: the answer is the account without the link.
export const unlinkGithub = createAppAsyncThunk(
  'account/unlinkGithub',
  (_: void, { extra, rejectWithValue }) => attempt(ERROR_CODE.githubSignInUnlink, rejectWithValue, () => extra.account.unlinkGithub()),
  { condition: (_, { getState }) => getState().account.githubStatus !== 'loading' }
)

// The photo was checked before (lib/avatarFile.ts): `contentType` is its sniffed type.
export const uploadAvatar = createAppAsyncThunk(
  'account/uploadAvatar',
  (input: { file: Blob; contentType: string }, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.avatarUpload, rejectWithValue, () => extra.account.uploadAvatar(input.file, input.contentType)),
  { condition: (_, { getState }) => getState().account.avatarStatus !== 'loading' }
)

export const removeAvatar = createAppAsyncThunk(
  'account/removeAvatar',
  (_: void, { extra, rejectWithValue }) => attempt(ERROR_CODE.avatarRemove, rejectWithValue, () => extra.account.removeAvatar()),
  { condition: (_, { getState }) => getState().account.avatarStatus !== 'loading' }
)

// The photo's bytes through the API, as an
// object URL that the caller (lib/useAvatarSrc.ts) revokes. Nothing is kept in state. A failure
// shows the initials with no toast, as a broken image did before (store/listener.ts).
export const fetchAvatarSrc = createAppAsyncThunk('account/fetchAvatarSrc', (avatarUrl: string, { extra, rejectWithValue, signal }) =>
  attempt(ERROR_CODE.accountLoad, rejectWithValue, async () => {
    const photo = await extra.account.getAvatar(avatarUrl, signal)
    // A cancelled load makes no object URL, so none is left behind.
    if (signal.aborted) throw new AppError({ code: ERROR_CODE.abort, kind: 'abort', message: 'photo load cancelled' })
    return URL.createObjectURL(photo)
  })
)

// A photo refused before upload (wrong type, empty, over 2 MB) as the error it is reported with.
export function avatarRefusal(reason: 'empty' | 'size' | 'type'): AppErrorJson {
  const cause = { empty: ERROR_CODE.fileEmpty, size: ERROR_CODE.fileSize, type: ERROR_CODE.fileType }[reason]
  return new AppError({ code: ERROR_CODE.avatarUpload, kind: 'validation', causeCode: cause, message: `photo refused: ${reason}` }).toJSON()
}

function loaded(state: AccountState, account: AccountDto) {
  state.account = account
  state.status = 'succeeded'
  state.error = null
  state.reportFailure = false
}

const accountSlice = createSlice({
  name: 'account',
  initialState: initialAccountState,
  reducers: {
    // A page that shows the account wants a failed load reported, even one already running.
    accountFailureReported: (state) => {
      state.reportFailure = true
    },
    // The account form was closed or edited: its server error no longer applies.
    updateErrorCleared: (state) => {
      state.updateError = null
      if (state.updateStatus === 'failed') state.updateStatus = 'idle'
    },
    // The password form was closed or edited: its server error no longer applies.
    passwordErrorCleared: (state) => {
      state.passwordError = null
      if (state.passwordStatus === 'failed') state.passwordStatus = 'idle'
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAccount.pending, (state, action) => {
        state.status = 'loading'
        state.error = null
        state.reportFailure = state.reportFailure || !action.meta.arg?.silent
      })
      .addCase(fetchAccount.fulfilled, (state, action) => {
        loaded(state, action.payload)
      })
      .addCase(fetchAccount.rejected, (state, action) => {
        if (action.meta.condition) return
        state.status = 'failed'
        state.error = action.payload ?? null
        state.reportFailure = false
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        if (action.payload) loaded(state, action.payload.account)
      })
      .addCase(signIn.fulfilled, (state, action) => {
        loaded(state, action.payload)
      })
      .addCase(register.fulfilled, (state, action) => {
        loaded(state, action.payload)
      })
      .addCase(changePassword.pending, (state) => {
        state.passwordStatus = 'loading'
        state.passwordError = null
      })
      .addCase(changePassword.fulfilled, (state) => {
        state.passwordStatus = 'succeeded'
      })
      .addCase(changePassword.rejected, (state, action) => {
        state.passwordStatus = 'failed'
        state.passwordError = action.payload ?? null
      })
      .addCase(updateAccount.pending, (state) => {
        state.updateStatus = 'loading'
        state.updateError = null
      })
      .addCase(updateAccount.fulfilled, (state, action) => {
        state.updateStatus = 'succeeded'
        state.account = action.payload
      })
      .addCase(updateAccount.rejected, (state, action) => {
        if (action.meta.condition) return
        state.updateStatus = 'failed'
        state.updateError = action.payload ?? null
      })
      .addCase(linkGithub.pending, (state) => {
        state.githubStatus = 'loading'
      })
      .addCase(linkGithub.fulfilled, (state) => {
        state.githubStatus = 'succeeded'
      })
      .addCase(linkGithub.rejected, (state, action) => {
        if (action.meta.condition) return
        state.githubStatus = 'failed'
      })
      .addCase(unlinkGithub.pending, (state) => {
        state.githubStatus = 'loading'
      })
      .addCase(unlinkGithub.fulfilled, (state, action) => {
        state.githubStatus = 'succeeded'
        state.account = action.payload
      })
      .addCase(unlinkGithub.rejected, (state, action) => {
        if (action.meta.condition) return
        state.githubStatus = 'failed'
      })
      .addCase(uploadAvatar.pending, (state) => {
        state.avatarStatus = 'loading'
      })
      .addCase(uploadAvatar.fulfilled, (state, action) => {
        state.avatarStatus = 'succeeded'
        state.account = action.payload
      })
      .addCase(uploadAvatar.rejected, (state, action) => {
        if (action.meta.condition) return
        state.avatarStatus = 'failed'
      })
      .addCase(removeAvatar.pending, (state) => {
        state.avatarStatus = 'loading'
      })
      .addCase(removeAvatar.fulfilled, (state, action) => {
        state.avatarStatus = 'succeeded'
        state.account = action.payload
      })
      .addCase(removeAvatar.rejected, (state, action) => {
        if (action.meta.condition) return
        state.avatarStatus = 'failed'
      })
  }
})

export const { accountFailureReported, passwordErrorCleared, updateErrorCleared } = accountSlice.actions
export const accountReducer = accountSlice.reducer

export const selectAccountState = (state: RootState) => state.account
export const selectAccount = (state: RootState) => state.account.account
