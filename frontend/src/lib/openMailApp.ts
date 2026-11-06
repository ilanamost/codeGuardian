import { MAILTO_SCHEME } from './supportMailto'

// Plan 032: the only code that hands a link to the user's mail app. Called from a submit (a user
// action), so the browser does not block it. Anything but a `mailto:` link is ignored.
export function openMailApp(link: string) {
  if (!link.startsWith(MAILTO_SCHEME)) return
  window.location.assign(link)
}
