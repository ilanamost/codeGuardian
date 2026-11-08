import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import CodeEditor from '../../src/components/CodeEditor'
import { editorScrollbarSize, scrollbarSize } from '../../src/lib/config'
import { sampleReview } from '../utils/sampleData'
import { renderWithStore, renderWithStoreSettled } from '../utils/renderWithStore'

const editorOptionList = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, options }: { value: string; options: Record<string, unknown> }) => {
    editorOptionList.push(options)
    return <div data-testid="monaco">{value}</div>
  }
}))

function renderApp() {
  return renderWithStoreSettled(<App />, { route: '/review/r1' })
}

async function openSuggestionTab() {
  const user = userEvent.setup()
  await renderApp()
  await user.click(screen.getByRole('tab', { name: /Suggested refactors/ }))
}

describe('Suggested refactors tab', () => {
  it('shows the section heading and the tab count', async () => {
    await openSuggestionTab()

    expect(screen.getByRole('heading', { name: 'Suggested Refactors' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: `Suggested refactors (${sampleReview.suggestion.length})` })).toBeInTheDocument()
  })

  it('renders one card per suggestion with title and description', async () => {
    await openSuggestionTab()

    const panel = screen.getByRole('tabpanel')
    const cardList = within(panel).getAllByRole('listitem')
    expect(cardList).toHaveLength(sampleReview.suggestion.length)
    sampleReview.suggestion.forEach((item, index) => {
      expect(within(cardList[index]).getByText(item.title)).toBeInTheDocument()
      expect(within(cardList[index]).getByText(item.detail)).toBeInTheDocument()
      expect(within(cardList[index]).getByTestId('suggestion-badge')).toBeInTheDocument()
    })
  })

  it('uses the same card style as the Findings tab, not a bullet list', async () => {
    await openSuggestionTab()

    const [card] = within(screen.getByRole('tabpanel')).getAllByRole('listitem')
    expect(card).toHaveClass('bg-card', 'rounded-md')
    expect(card.closest('ul')).not.toHaveClass('list-disc')
  })
})

describe('Tab scrolling', () => {
  it('makes the tab panel the scroll container', async () => {
    await renderApp()

    expect(screen.getByRole('tabpanel')).toHaveClass('lg:overflow-auto', 'lg:min-h-0', 'lg:flex-1')
  })

  it('keeps the tab strip outside the scroll container', async () => {
    await renderApp()

    expect(screen.getByRole('tablist')).not.toHaveClass('overflow-auto')
    expect(screen.getByRole('tabpanel')).not.toContainElement(screen.getByRole('tablist'))
  })

  it('scrolls the generated tests file list inside the sidebar', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('tab', { name: /Generated tests/ }))

    expect(screen.getByRole('list', { name: 'Tests generated for' })).toHaveClass('overflow-auto')
  })

  it('fixes the app shell to the viewport so main content scrolls inside it', async () => {
    const { container } = await renderApp()

    expect(container.firstElementChild).toHaveClass('h-dvh', 'overflow-hidden')
  })
})

describe('Scrollbar style', () => {
  const base = readFileSync(resolve(__dirname, '../../src/styles/basics/base.css'), 'utf8')
  const variables = readFileSync(resolve(__dirname, '../../src/styles/setup/variables.css'), 'utf8')

  it.each(['scrollbar-size', 'scrollbar-thumb', 'scrollbar-thumb-hover', 'scrollbar-track'])(
    'defines --%s in variables.css',
    (token) => {
      expect(variables).toMatch(new RegExp(`--${token}\\s*:`))
    }
  )

  it('defines one global scrollbar rule built from the tokens', async () => {
    expect(base).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/)
    expect(base).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--scrollbar-size\)/)
    expect(base).toMatch(/::-webkit-scrollbar-thumb/)
  })

  it('sets the standard scrollbar properties only inside the Firefox fallback', async () => {
    // Chromium 121+ ignores ::-webkit-scrollbar sizing when either property is set.
    const outsideFallback = base.replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/, '')
    expect(outsideFallback).not.toMatch(/scrollbar-width\s*:/)
    expect(outsideFallback).not.toMatch(/scrollbar-color\s*:/)
  })

  it('does not hard-code colors in the scrollbar rule', async () => {
    const rule = base.slice(base.indexOf('The one scrollbar style'))
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('keeps the Monaco scrollbar constant equal to --scrollbar-size', async () => {
    expect(variables).toMatch(new RegExp(`--scrollbar-size:\\s*${scrollbarSize}px`))
  })

  // Plans 021 and 050: both editor scrollbars are wide (16px below md; jsdom has no matchMedia, so
  // it renders as below md), the global thin size stays for the page's own scrollbars.
  it('passes the one wide editor scrollbar size to the Monaco options for both bars', async () => {
    renderWithStore(<CodeEditor value="const a = 1" language="TypeScript" />)

    expect(editorOptionList.at(-1)).toMatchObject({
      wordWrap: 'off',
      scrollbar: { verticalScrollbarSize: editorScrollbarSize.base, horizontalScrollbarSize: editorScrollbarSize.base }
    })
  })

  it('has no component-level scrollbar styling', async () => {
    const componentSource = ['TestConfigPanel', 'ReviewTabs', 'SuggestionList'].map((name) =>
      readFileSync(resolve(__dirname, `../../src/components/${name}.tsx`), 'utf8')
    )
    componentSource.forEach((source) => expect(source).not.toMatch(/scrollbar/i))
  })
})
