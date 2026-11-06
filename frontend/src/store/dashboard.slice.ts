import { createSelector, createSlice } from '@reduxjs/toolkit'
import type { AppErrorJson } from '../models/app-error'
import { Dashboard } from '../models/dashboard.model'
import type { DashboardDto } from '../models/dto'
import { ERROR_CODE } from '../utils/error-messages'
import { attempt, createAppAsyncThunk, type AsyncStatus } from './thunk'
import type { RootState } from './index'

// Stats and chart data. The activity range select stays component state (UI-only, resets when
// the page is left, as before).
export interface DashboardState {
  data: DashboardDto | null
  status: AsyncStatus
  error: AppErrorJson | null
}

export const initialDashboardState: DashboardState = { data: null, status: 'idle', error: null }

export const fetchDashboard = createAppAsyncThunk('dashboard/fetch', (_: void, { extra, rejectWithValue }) =>
  attempt(ERROR_CODE.dashboardLoad, rejectWithValue, () => extra.dashboard.get())
)

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState: initialDashboardState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboard.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchDashboard.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.data = action.payload
      })
      .addCase(fetchDashboard.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? null
      })
  }
})

export const dashboardReducer = dashboardSlice.reducer

export const selectDashboardStatus = (state: RootState) => state.dashboard.status

const emptyDashboard = Dashboard.empty()

// An empty Dashboard until the data arrives, so the page keeps its layout.
export const selectDashboard = createSelector([(state: RootState) => state.dashboard.data], (data) =>
  data ? new Dashboard(data) : emptyDashboard
)
