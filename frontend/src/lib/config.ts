// Scrollbar thickness in px. Keep equal to --scrollbar-size in styles/setup/variables.css;
// Monaco draws its own scrollbars, so it reads this value instead of the CSS rule.
export const scrollbarSize = 4

// The code editor's horizontal scrollbar (plan 021): wide enough to drag with a finger below
// the `md` breakpoint (touch), a little thinner from `md` up. Word wrap is off, so long lines
// scroll with it. The vertical editor scrollbar keeps `scrollbarSize`.
export const editorHorizontalScrollbarSize = { base: 16, md: 12 } as const

// The backend base URL, from the Vite variable VITE_API_URL, read as it is with no fallback.
// Plan 035: the frontend always talks to the backend over HTTP (services/api.service.ts).
export const API_URL = import.meta.env.VITE_API_URL
