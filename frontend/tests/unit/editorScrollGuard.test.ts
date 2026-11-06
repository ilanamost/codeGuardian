import { describe, expect, it } from 'vitest'
import { pinEditorScroll } from '../../src/lib/editorScrollGuard'

// Plan 029 revision 3: the browser must never scroll Monaco's clipping boxes natively.
function editorDom() {
  const root = document.createElement('div')
  root.innerHTML = '<div class="overflow-guard"><div class="editor-scrollable"><div class="other"></div></div></div>'
  const get = (selector: string) => root.querySelector(selector) as HTMLElement
  return { root, guard: get('.overflow-guard'), scrollable: get('.editor-scrollable'), other: get('.other') }
}

function scroll(element: HTMLElement, left: number, top: number) {
  element.scrollLeft = left
  element.scrollTop = top
  element.dispatchEvent(new Event('scroll'))
}

describe('pinEditorScroll', () => {
  it('puts a natively scrolled clipping box back at 0', () => {
    const dom = editorDom()
    pinEditorScroll(dom.root)
    scroll(dom.scrollable, 1163, 20)
    scroll(dom.guard, 40, 0)
    expect([dom.scrollable.scrollLeft, dom.scrollable.scrollTop, dom.guard.scrollLeft]).toEqual([0, 0, 0])
  })

  it('leaves other elements alone', () => {
    const dom = editorDom()
    pinEditorScroll(dom.root)
    scroll(dom.other, 30, 0)
    expect(dom.other.scrollLeft).toBe(30)
  })

  it('stops after the cleanup', () => {
    const dom = editorDom()
    const unpin = pinEditorScroll(dom.root)
    unpin()
    scroll(dom.scrollable, 50, 0)
    expect(dom.scrollable.scrollLeft).toBe(50)
  })
})
