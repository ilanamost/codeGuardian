// Monaco scrolls its code itself (a virtual scroll): its clipping boxes are `overflow: hidden` and
// must never scroll natively. On a phone, typing at the end of a long line made the browser scroll
// the clipping box (`.editor-scrollable`, scrollLeft about 1160 px) to keep the hidden input in
// view. That moved the whole view, its horizontal scrollbar included, out of the editor: the bar
// disappeared and the short lines looked empty (plan 029 revision 3). This puts such a box back
// at 0 whenever it scrolls. Returns the cleanup.
const CLIP_SELECTOR = '.overflow-guard, .editor-scrollable'

export function pinEditorScroll(root: HTMLElement): () => void {
  const clipList = Array.from(root.querySelectorAll<HTMLElement>(CLIP_SELECTOR))
  const reset = (event: Event) => {
    const clip = event.currentTarget as HTMLElement
    if (clip.scrollLeft !== 0) clip.scrollLeft = 0
    if (clip.scrollTop !== 0) clip.scrollTop = 0
  }
  for (const clip of clipList) clip.addEventListener('scroll', reset)
  return () => {
    for (const clip of clipList) clip.removeEventListener('scroll', reset)
  }
}
