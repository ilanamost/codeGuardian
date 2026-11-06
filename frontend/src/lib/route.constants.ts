// In-app routes that code navigates to (links in the nav list keep their own `to`).
export const NEW_REVIEW_ID = 'new'

export const ROUTE_PATH = {
  newReview: `/review/${NEW_REVIEW_ID}`,
  review: (id: string) => `/review/${encodeURIComponent(id)}`,
  history: '/history',
  home: '/',
  settings: '/settings',
  // A Settings section (`?section=`), such as the sidebar profile's link to Account (plan 034).
  settingsSection: (section: string) => `/settings?${SETTINGS_SECTION_PARAM}=${encodeURIComponent(section)}`,
  // Plan 028: the sign-in pages, for signed-out visitors.
  login: '/login',
  register: '/register'
} as const

// The `?section=` query parameter of the Settings page (plan 028), so a refresh keeps the tab.
export const SETTINGS_SECTION_PARAM = 'section'

// Where the app goes after sign-in (plan 028, Scope 11): only an internal path is accepted (it
// starts with exactly one `/`, has no backslash and is not the login or register page);
// anything else (`//evil.example`, `https://evil.example`, `/login`) resolves to `/`. This
// prevents an open redirect.
export function safeRedirectTarget(target: unknown): string {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return ROUTE_PATH.home
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(target)) return ROUTE_PATH.home
  const path = target.split(/[?#]/)[0]
  if (path === ROUTE_PATH.login || path === ROUTE_PATH.register || path.startsWith(`${ROUTE_PATH.login}/`) || path.startsWith(`${ROUTE_PATH.register}/`)) {
    return ROUTE_PATH.home
  }
  return target
}

// The router state the guard keeps the asked-for location in (path, search and hash).
export interface RedirectState {
  from: string
}

export function redirectTargetOf(state: unknown): string {
  const from = typeof state === 'object' && state !== null ? (state as Partial<RedirectState>).from : undefined
  return safeRedirectTarget(from)
}
