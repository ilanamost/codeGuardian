import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import FindingsByCategory from '../../src/components/FindingsByCategory'
import { categoryCountList } from '../utils/sampleData'

// Recharts measures its container with ResizeObserver, which jsdom lacks.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

describe('FindingsByCategory', () => {
  it('left-aligns every category label from the same x position', () => {
    const { container } = render(<FindingsByCategory countList={categoryCountList} />)
    const labelList = [...container.querySelectorAll('text')].filter((node) =>
      categoryCountList.some((item) => item.label === node.textContent)
    )

    expect(labelList).toHaveLength(categoryCountList.length)
    for (const label of labelList) {
      expect(label).toHaveAttribute('text-anchor', 'start')
      expect(Number(label.getAttribute('x'))).toBeGreaterThanOrEqual(0)
    }
    expect(new Set(labelList.map((label) => label.getAttribute('x'))).size).toBe(1)
  })
})
