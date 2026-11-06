import { createAsyncThunk } from '@reduxjs/toolkit'
import { AppError, type AppErrorJson } from '../models/app-error'
import type { Services } from '../services'
import type { ErrorCode } from '../utils/error-messages'
import type { AppDispatch, RootState } from './index'

// Thunks get the services as `extra` and reject with a plain AppErrorJson, so Redux state and
// actions stay serializable. They never call fetch or browser storage themselves.
export const createAppAsyncThunk = createAsyncThunk.withTypes<{
  state: RootState
  dispatch: AppDispatch
  extra: Services
  rejectValue: AppErrorJson
}>()

// Runs a service call; any failure becomes an AppError for `code` (the action that failed).
export async function attempt<T, R>(
  code: ErrorCode,
  rejectWithValue: (value: AppErrorJson) => R,
  run: () => Promise<T>
): Promise<T | R> {
  try {
    return await run()
  } catch (error) {
    return rejectWithValue(AppError.from(error, code).forAction(code).toJSON())
  }
}

export type AsyncStatus = 'idle' | 'loading' | 'succeeded' | 'failed'
