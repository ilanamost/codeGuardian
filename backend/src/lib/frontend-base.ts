// The base path of the frontend (plan 043): the path of FRONTEND_URL, so an app served under a
// sub-path (a GitHub Pages project page such as https://user.github.io/repo) is redirected to inside
// that path. It is either empty (the app is at the origin root) or starts with one `/` and has no
// trailing slash, which is what lets `origin + base + path` never double or miss a slash.
// It comes from the configuration only, never from a request.

// A query or a fragment in FRONTEND_URL has no meaning for an address that other paths are added
// to, so it is refused at start-up (the caller names the setting, never the value).
export function hasQueryOrFragment(frontendUrl: string): boolean {
  return frontendUrl.includes('?') || frontendUrl.includes('#')
}

// `https://user.github.io/repo/` and `https://user.github.io/repo` give `/repo`; no path gives ''.
export function frontendBasePathOf(frontendUrl: string): string {
  return new URL(frontendUrl).pathname.replace(/\/+$/, '')
}
