import { createSlice } from '@reduxjs/toolkit'
import type { AppErrorJson } from '../models/app-error'
import type { SupportRequestDto } from '../models/dto'
import { ERROR_CODE } from '../utils/error-messages'
import { attempt, createAppAsyncThunk, type AsyncStatus } from './thunk'
import type { RootState } from './index'

export interface SupportState {
  status: AsyncStatus
  ticket: string | null
  error: AppErrorJson | null
}

export const initialSupportState: SupportState = { status: 'idle', ticket: null, error: null }

export const submitSupportRequest = createAppAsyncThunk(
  'support/submit',
  (request: SupportRequestDto, { extra, rejectWithValue }) =>
    attempt(ERROR_CODE.supportSubmit, rejectWithValue, () => extra.support.submit(request))
)

const supportSlice = createSlice({
  name: 'support',
  initialState: initialSupportState,
  reducers: {
    // The ticket message disappears as soon as the form is edited again, or the form is left.
    supportReset: () => initialSupportState
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitSupportRequest.pending, (state) => {
        state.status = 'loading'
        state.error = null
        state.ticket = null
      })
      .addCase(submitSupportRequest.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.ticket = action.payload.ticket
      })
      .addCase(submitSupportRequest.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? null
      })
  }
})

export const { supportReset } = supportSlice.actions
export const supportReducer = supportSlice.reducer

export const selectSupport = (state: RootState) => state.support
