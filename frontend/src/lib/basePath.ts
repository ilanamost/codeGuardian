// Plan 042: the sub-path the app is served from (VITE_BASE_PATH, wired to Vite `base` in vite.config.ts),
// e.g. '/ai-code-reviewer/' on a GitHub Pages project page. '/' when unset.
// __APP_BASE_PATH__ is injected by vite.config.ts (the same value as Vite `base`).
export const BASE_PATH: string = __APP_BASE_PATH__

// The React Router basename is the base path without its trailing slash; '/' stays '/'.
export const routerBasename = (base: string): string => (base.length > 1 ? base.replace(/\/+$/, '') : '/')

export const ROUTER_BASENAME = routerBasename(BASE_PATH)
