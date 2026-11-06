import { combineReducers, configureStore, type UnknownAction } from '@reduxjs/toolkit'
import { createServices, type Services } from '../services'
import { accountReducer } from './account.slice'
import { dashboardReducer } from './dashboard.slice'
import { githubReducer } from './github.slice'
import { createAppListener } from './listener'
import { reviewReducer } from './review.slice'
import { initialSessionState, isSessionReset, sessionReducer } from './session.slice'
import { settingsReducer } from './settings.slice'
import { createStaleGuard } from './staleGuard'
import { supportReducer } from './support.slice'

// State holds plain, serializable data only (DTOs and AppErrorJson); domain classes are built
// in selectors. Services are injected as the thunk `extra` argument so tests can pass fakes.
const appReducer = combineReducers({
  review: reviewReducer,
  dashboard: dashboardReducer,
  github: githubReducer,
  settings: settingsReducer,
  support: supportReducer,
  account: accountReducer,
  session: sessionReducer
})

export type RootState = ReturnType<typeof appReducer>

// Plan 028: after a sign-out or a session that ended, every slice but the session starts over
// (reviews, dashboard, account, settings, GitHub and support), so the next account never sees
// this one's data. The settings cache in browser storage is dropped by the services.
function rootReducer(state: Partial<RootState> | undefined, action: UnknownAction): RootState {
  if (state?.session && isSessionReset(action)) return appReducer({ session: state.session }, action)
  return appReducer(state, action)
}

// The device theme (`cr.theme`) wins over the cached account settings for the first render.
function initialSettings(services: Services) {
  const settings = services.settings.read()
  const theme = services.settings.readTheme()
  return theme ? { ...settings, theme } : settings
}

export interface AppStoreOption {
  services?: Services
  preloadedState?: Partial<RootState>
}

export function createAppStore({ services = createServices(), preloadedState }: AppStoreOption = {}) {
  const listener = createAppListener(services)
  return configureStore({
    reducer: rootReducer,
    // Settings are read synchronously so the saved theme applies before the first paint.
    preloadedState: { settings: initialSettings(services), session: initialSessionState(), ...preloadedState },
    // The stale guard runs first, so neither the reducers nor the listener see an answer of a
    // previous session (QA D1).
    middleware: (getDefault) => getDefault({ thunk: { extraArgument: services } }).prepend(createStaleGuard(), listener.middleware)
  })
}

export type AppStore = ReturnType<typeof createAppStore>
export type AppDispatch = AppStore['dispatch']
