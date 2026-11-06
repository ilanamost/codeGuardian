import { screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASE_PATH, ROUTER_BASENAME, routerBasename } from '../../src/lib/basePath'
import { normalizeBasePath } from '../../vite.config'
import App from '../../src/App'
import { renderWithStoreSettled } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco" />
}))

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}</p>
}

describe('router basename from the base path (plan 042)', () => {
  it.each([
    ['/', '/'],
    ['/ai-code-reviewer/', '/ai-code-reviewer'],
    ['/a/b/', '/a/b'],
    ['/ai-code-reviewer', '/ai-code-reviewer']
  ])('%s gives the basename %s', (base, basename) => {
    expect(routerBasename(base)).toBe(basename)
  })

  it('defaults to the root when VITE_BASE_PATH is not set', () => {
    expect(BASE_PATH).toBe('/')
    expect(ROUTER_BASENAME).toBe('/')
  })
})

describe('Vite base path normalisation (plan 042)', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['ai-code-reviewer', '/ai-code-reviewer/'],
    ['/ai-code-reviewer', '/ai-code-reviewer/'],
    ['/ai-code-reviewer/', '/ai-code-reviewer/'],
    [' //x/y// ', '/x/y/']
  ])('%j becomes %s', (value, base) => {
    expect(normalizeBasePath(value)).toBe(base)
  })
})

describe('routes under a base path (plan 042)', () => {
  it('resolves a route below the basename', async () => {
    await renderWithStoreSettled(
      <MemoryRouter basename="/ai-code-reviewer" initialEntries={['/ai-code-reviewer/help']}>
        <App />
        <Where />
      </MemoryRouter>,
      { router: false }
    )

    expect(screen.getByTestId('where')).toHaveTextContent(/^\/help$/)
    expect(screen.getByRole('heading', { name: 'How to Create a New Review' })).toBeInTheDocument()
  })

  it('sends an unknown path under the base to the dashboard route, still under the base', async () => {
    await renderWithStoreSettled(
      <MemoryRouter basename="/ai-code-reviewer" initialEntries={['/ai-code-reviewer/nope']}>
        <App />
        <Where />
      </MemoryRouter>,
      { router: false }
    )

    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })
})

describe('missing VITE_API_URL (plan 042)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('still fails with the clear setup error', async () => {
    vi.stubEnv('VITE_API_URL', undefined)
    vi.resetModules()
    const { createApiService } = await import('../../src/services/api.service')
    const source = createApiService({ fetchFn: vi.fn() })

    await expect(source.request('GET', '/api/health')).rejects.toMatchObject({
      kind: 'network',
      message: 'The API URL is not configured (set VITE_API_URL)'
    })
  })
})
