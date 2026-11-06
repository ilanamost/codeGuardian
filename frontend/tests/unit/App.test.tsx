import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { renderWithStoreSettled } from '../utils/renderWithStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco" data-language={language}>
      {value}
    </div>
  )
}))

function renderApp() {
  return renderWithStoreSettled(<App />, { route: '/review/r1' })
}

describe('Review page (an existing review)', () => {
  it('renders the sidebar brand and nav items', async () => {
    await renderApp()

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(screen.getByText('CodeGuardian')).toBeInTheDocument()
    expect(within(nav).getAllByRole('link')).toHaveLength(4)
    expect(within(nav).queryAllByRole('button')).toHaveLength(0)
  })

  it('renders the sidebar for lg+ and the mobile nav below lg', async () => {
    await renderApp()

    expect(screen.getByRole('navigation', { name: 'Main' }).closest('aside')).toHaveClass('hidden', 'lg:flex')
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toHaveClass('lg:hidden')
  })

  it('renders the status bar fields', async () => {
    await renderApp()

    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('2 hours ago')).toBeInTheDocument()
    expect(screen.getByText('72 / 100')).toBeInTheDocument()
  })

  it('renders four tabs and switches between them', async () => {
    const user = userEvent.setup()
    await renderApp()

    expect(screen.getAllByRole('tab')).toHaveLength(4)
    await user.click(screen.getByRole('tab', { name: /Generated tests/ }))

    expect(screen.getByTestId('monaco')).toHaveTextContent("describe('getUser'")
  })

  it('shows severity counts and key issues', async () => {
    await renderApp()

    expect(screen.getByTestId('count-critical')).toHaveTextContent('1')
    expect(screen.getByTestId('count-medium')).toHaveTextContent('3')
    expect(screen.getByText('Line 2 - Unsanitized user input in fetch URL')).toBeInTheDocument()
  })

  it('updates the editor and top bar language on select', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Python')

    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'python')
    expect(screen.getAllByText('Python').length).toBeGreaterThan(1)
  })

  it('renders the action buttons', async () => {
    await renderApp()

    expect(screen.getByRole('button', { name: 'View all findings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download report/ })).toBeInTheDocument()
  })
})
