import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import MobileNav from '../../src/components/MobileNav'

function renderNav(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileNav />
    </MemoryRouter>
  )
}

describe('MobileNav', () => {
  it('renders six icon links with aria-labels and no text labels', () => {
    renderNav('/')

    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(nav).toHaveClass('lg:hidden')
    for (const name of ['Dashboard', 'New Review', 'Review History', 'GitHub Integration', 'Settings', 'Help']) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('aria-label', name)
      expect(link).not.toHaveTextContent(name)
    }
    expect(screen.getAllByRole('link')).toHaveLength(6)
  })

  it('marks the current route as active', () => {
    renderNav('/history')

    expect(screen.getByRole('link', { name: 'Review History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })
})
