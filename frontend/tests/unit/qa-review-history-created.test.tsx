// QA adversarial pass for plan 024: the History row shows the created date and a re-run never
// moves it, the row's position, or another row's date.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ReviewRow from '../../src/components/ReviewRow'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { createReviewService } from '../../src/services/review.service'
import { createStorageService } from '../../src/services/storage.service'
import type { ReviewSummary } from '../../src/types'
import { recentReviewList } from '../utils/sampleData'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function clockedService(start = '2026-10-20T10:00:00.000Z') {
  const clock = { now: new Date(start).getTime() }
  const service = createReviewService(
    createFixtureDataSource({ storage: createStorageService(), supportDelayMs: 0, now: () => new Date(clock.now) })
  )
  return { clock, service }
}

describe('QA plan 024: mock source keeps timeAgo on creation', () => {
  it('rapid repeated runs at different times never move the created age or the order', async () => {
    const { clock, service } = clockedService()
    const a = await service.create({ title: 'A', language: 'Go', content: 'package a' })
    clock.now += HOUR
    const b = await service.create({ title: 'B', language: 'Go', content: 'package b' })
    clock.now += 2 * DAY
    const orderBefore = (await service.list()).map((item) => item.id)

    for (let index = 0; index < 5; index++) {
      clock.now += 1000
      await service.run(a.id, { language: 'Go', code: `package a // run ${index}` })
      await service.get(a.id)
    }

    const list = await service.list()
    expect(list.map((item) => item.id)).toEqual(orderBefore)
    expect(list.find((item) => item.id === a.id)?.timeAgo).toBe('2 days ago')
    expect(list.find((item) => item.id === b.id)?.timeAgo).toBe('2 days ago')
    expect((await service.get(a.id))?.review.analyzedAgo).toBe('just now')
  })

  it('a review that was never run ages with the clock from its creation', async () => {
    const { clock, service } = clockedService()
    const a = await service.create({ title: 'Idle', language: 'Go', content: 'package idle' })
    expect((await service.list()).find((item) => item.id === a.id)?.timeAgo).toBe('just now')
    clock.now += 3 * DAY
    expect((await service.list()).find((item) => item.id === a.id)?.timeAgo).toBe('3 days ago')
  })

  it('a re-run with a new name keeps the created age and shows the new name', async () => {
    const { clock, service } = clockedService()
    const a = await service.create({ title: 'Old name', language: 'Go', content: 'package a' })
    clock.now += 3 * DAY
    await service.run(a.id, { name: 'New name', language: 'Go', code: 'package a // renamed' })

    const row = (await service.list()).find((item) => item.id === a.id)
    expect(row?.title).toBe('New name')
    expect(row?.timeAgo).toBe('3 days ago')
  })

  it('a re-run then delete removes the row and leaves the others untouched', async () => {
    const { clock, service } = clockedService()
    const a = await service.create({ title: 'Doomed', language: 'Go', content: 'package a' })
    const b = await service.create({ title: 'Kept', language: 'Go', content: 'package b' })
    clock.now += DAY
    await service.run(a.id, { language: 'Go', code: 'package a // again' })
    await service.delete(a.id)

    const list = await service.list()
    expect(list.some((item) => item.id === a.id)).toBe(false)
    expect(list.find((item) => item.id === b.id)?.timeAgo).toBe('1 day ago')
  })

  it('a seeded review run several times keeps its seeded created text and position', async () => {
    const { clock, service } = clockedService()
    const seed = [...recentReviewList].reverse().find((item) => item.status === 'completed')
    if (!seed) throw new Error('no completed seed review')
    expect(seed.id).not.toBe(recentReviewList[0].id)
    const orderBefore = (await service.list()).map((item) => item.id)
    for (let index = 0; index < 3; index++) {
      clock.now += DAY
      const started = await service.run(seed.id, { language: seed.language, code: `// run ${index}` })
      expect(started.review.status).toBe('pending')
      expect((await service.get(seed.id))?.review.analyzedAgo).toBe('just now')
    }
    const list = await service.list()
    expect(list.map((item) => item.id)).toEqual(orderBefore)
    expect(list.find((item) => item.id === seed.id)?.timeAgo).toBe(seed.timeAgo)
  })
})

describe('QA plan 024: ReviewRow label', () => {
  const base: ReviewSummary = { ...recentReviewList[0] }
  const renderRow = (review: ReviewSummary) =>
    render(
      <MemoryRouter>
        <ul>
          <ReviewRow review={review} />
        </ul>
      </MemoryRouter>
    )

  it('says Created exactly once, in both full and compact rows', () => {
    const { container, rerender } = renderRow(base)
    expect(container.textContent?.match(/Created/g)?.length).toBe(1)
    rerender(
      <MemoryRouter>
        <ul>
          <ReviewRow review={base} compact />
        </ul>
      </MemoryRouter>
    )
    expect(screen.getByText(`${base.language} - Created ${base.timeAgo}`)).toBeInTheDocument()
  })

  it('renders a very long title and an unusual age without losing the label', () => {
    const long = 'x'.repeat(500)
    renderRow({ ...base, title: long, timeAgo: '<b>999 years ago</b>' })
    expect(screen.getByText(long)).toBeInTheDocument()
    // React escapes the text, so markup in the age is shown as text, not HTML.
    expect(screen.getByText(`${base.language} - Created <b>999 years ago</b>`)).toBeInTheDocument()
  })

  it('does not say Analyzed on the row', () => {
    const { container } = renderRow(base)
    expect(container.textContent).not.toMatch(/Analyzed/i)
  })
})
