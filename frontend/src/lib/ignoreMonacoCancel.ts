// The Monaco editor cancels its own pending work when an editor is disposed (navigation, or
// React StrictMode mounting twice in dev) and leaves that rejection unhandled, so the console
// shows "Uncaught (in promise) Canceled". It is harmless. Only that exact rejection is ignored;
// every other unhandled rejection still reaches the console.
export const MONACO_CANCELED = 'Canceled'

export function isMonacoCancel(reason: unknown): boolean {
  return reason instanceof Error && reason.name === MONACO_CANCELED && reason.message === MONACO_CANCELED
}

export function ignoreMonacoCancel(target: Window = window): void {
  target.addEventListener('unhandledrejection', (event) => {
    if (isMonacoCancel(event.reason)) event.preventDefault()
  })
}
