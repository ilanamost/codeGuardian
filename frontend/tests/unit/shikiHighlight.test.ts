import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EDITOR_THEME_ID } from '../../src/lib/editorHighlight'

// QA round 4, R4-1: once Shiki is on a Monaco instance, it stays the tokenizer of the five
// languages; a Monarch tokenizer that finishes loading later cannot replace it.
const shiki = vi.hoisted(() => ({ toMonaco: vi.fn() }))
vi.mock('@shikijs/monaco', () => ({ shikiToMonaco: shiki.toMonaco }))

function fakeMonaco() {
  const registered: Record<string, unknown> = {}
  const factory: Record<string, { create: () => unknown }> = {}
  const theme = { current: '' }
  const languages = {
    setTokensProvider: vi.fn((id: string, provider: unknown) => {
      registered[id] = provider
      return { dispose: () => {} }
    }),
    setMonarchTokensProvider: vi.fn((id: string, language: unknown) => {
      registered[id] = { monarch: language }
      return { dispose: () => {} }
    }),
    registerTokensProviderFactory: vi.fn((id: string, item: { create: () => unknown }) => {
      factory[id] = item
      return { dispose: () => {} }
    })
  }
  const editor = {
    setTheme: vi.fn((name: string) => {
      theme.current = name
    })
  }
  return { monaco: { languages, editor }, registered, factory, theme }
}

const highlighter = { getLoadedThemes: () => [EDITOR_THEME_ID] }

beforeEach(() => {
  vi.clearAllMocks()
  // Like @shikijs/monaco: one tokens provider per loaded language that Monaco knows.
  shiki.toMonaco.mockImplementation((_highlighter: unknown, monaco: ReturnType<typeof fakeMonaco>['monaco']) => {
    for (const id of ['typescript', 'javascript', 'python', 'go', 'java']) monaco.languages.setTokensProvider(id, { shiki: id })
  })
})

async function apply() {
  const fake = fakeMonaco()
  const { applyHighlight } = await import('../../src/lib/shikiHighlight')
  applyHighlight(fake.monaco as never, highlighter as never)
  return fake
}

describe('applyHighlight', () => {
  it('registers Shiki\'s provider of each language directly and as its factory', async () => {
    const fake = await apply()
    expect(fake.registered.python).toEqual({ shiki: 'python' })
    // The factory replaces (and so cancels) a pending Monarch factory of the language.
    expect(fake.factory.python.create()).toEqual({ shiki: 'python' })
    expect(Object.keys(fake.factory).sort()).toEqual(['go', 'java', 'javascript', 'python', 'typescript'])
  })

  it('ignores later tokenizer registrations for the five languages', async () => {
    const fake = await apply()
    fake.monaco.languages.setMonarchTokensProvider('python', { tokenizer: {} })
    fake.monaco.languages.setTokensProvider('go', { other: true })
    fake.monaco.languages.registerTokensProviderFactory('java', { create: () => ({ monarch: true }) })
    expect(fake.registered.python).toEqual({ shiki: 'python' })
    expect(fake.registered.go).toEqual({ shiki: 'go' })
    expect(fake.factory.java.create()).toEqual({ shiki: 'java' })
  })

  it('still lets other languages register their tokenizer', async () => {
    const fake = await apply()
    fake.monaco.languages.setMonarchTokensProvider('rust', { tokenizer: {} })
    fake.monaco.languages.setTokensProvider('sql', { sql: true })
    expect(fake.registered.rust).toEqual({ monarch: { tokenizer: {} } })
    expect(fake.registered.sql).toEqual({ sql: true })
  })

  it('maps any other theme to the Shiki theme, and applies once per instance', async () => {
    const fake = await apply()
    fake.monaco.editor.setTheme('vs-dark')
    expect(fake.theme.current).toBe(EDITOR_THEME_ID)

    const { applyHighlight } = await import('../../src/lib/shikiHighlight')
    applyHighlight(fake.monaco as never, highlighter as never)
    expect(shiki.toMonaco).toHaveBeenCalledTimes(1)
  })
})
