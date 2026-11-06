import { afterEach, describe, expect, it } from 'vitest'
import { API_PATH } from '../../src/lib/api.constants'
import { canRunReview, hasUnanalyzedChange } from '../../src/lib/reviewRun'
import { REVIEW_LIMIT } from '../../src/lib/review.constants'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { createStorageService } from '../../src/services/storage.service'

// QA round 5 (AI-39, plan 021 Revision 1): adversarial checks of Run review on an existing review.
const fixedNow = () => new Date('2026-10-20T10:00:00.000Z')

function jsonSource() {
  return createFixtureDataSource({ storage: createStorageService(), supportDelayMs: 0, now: fixedNow })
}

afterEach(() => {
  window.localStorage.clear()
})

const analyzed = { analyzedContent: 'const a = 1\nconst b = 2\n', analyzedLanguage: 'TypeScript' }
const base = { ...analyzed, code: analyzed.analyzedContent, language: 'TypeScript', status: 'completed' as const, busy: false }

describe('QA: canRunReview edge cases', () => {
  it('treats CR LF, trailing newlines and edge whitespace as unchanged', () => {
    expect(canRunReview({ ...base, code: 'const a = 1\r\nconst b = 2\r\n' })).toBe(false)
    expect(canRunReview({ ...base, code: '\n\nconst a = 1\nconst b = 2\n\n\n  ' })).toBe(false)
  })

  it('counts whitespace inside the code, trailing spaces on an inner line and a lone CR as a change', () => {
    expect(canRunReview({ ...base, code: 'const a = 1 \nconst b = 2\n' })).toBe(true)
    expect(canRunReview({ ...base, code: 'const a  = 1\nconst b = 2\n' })).toBe(true)
    // toLf folds only CR LF; a lone CR is sent as is, so it is a real change.
    expect(canRunReview({ ...base, code: 'const a = 1\rconst b = 2\n' })).toBe(true)
  })

  it('a language change alone enables Run, and changing it back disables it', () => {
    expect(canRunReview({ ...base, language: 'JavaScript' })).toBe(true)
    expect(canRunReview({ ...base, language: 'TypeScript' })).toBe(false)
  })

  it('is disabled for every unfinished status even with a change, and allowed for failed and cancelled', () => {
    for (const status of ['pending', 'queued', 'in_progress'] as const) {
      expect(canRunReview({ ...base, code: 'x', status })).toBe(false)
    }
    for (const status of ['failed', 'cancelled', 'completed'] as const) {
      expect(canRunReview({ ...base, code: 'x', status })).toBe(true)
    }
  })

  it('is disabled for whitespace-only code and for code one character over the limit after CR LF folding', () => {
    expect(canRunReview({ ...base, code: ' \r\n\t ' })).toBe(false)
    expect(canRunReview({ ...base, code: 'a'.repeat(REVIEW_LIMIT.contentMax + 1) })).toBe(false)
    // contentMax LF characters written as CR LF are still within the limit.
    expect(canRunReview({ ...base, code: 'a\r\n'.repeat(REVIEW_LIMIT.contentMax / 2) })).toBe(true)
  })

  it('is disabled while busy', () => {
    expect(canRunReview({ ...base, code: 'x', busy: true })).toBe(false)
  })

  it('hasUnanalyzedChange is false for an analyzed review whose content is empty and an editor that is blank', () => {
    expect(hasUnanalyzedChange({ code: '  ', language: 'Go', analyzedContent: '', analyzedLanguage: 'Go' })).toBe(false)
  })
})

// Not tested here: whitespace-only code, language or name and unknown fields. The contract (SaveReview
// minLength 1, no additionalProperties: false) allows them, the JSON source accepts them, and the backend
// is stricter (nonBlank, strictObject). The UI never sends blank code (canRunReview).
describe('QA: fake backend Run review parity with the backend', () => {
  it('D6 fixed: History shows the run of a seeded review: its language and status follow the run, as on the backend', async () => {
    const source = jsonSource()
    await source.request('POST', API_PATH.reviewRun('r1'), { language: 'Go', code: 'package main\n' })
    const list = (await source.request('GET', API_PATH.review)) as { id: string; language: string; status: string }[]
    const row = list.find((item) => item.id === 'r1')
    expect(row?.language).toBe('Go')
    expect(row?.status).toBe('completed')
  })

  it('GET after a run reports the run code as analyzedContent and keeps the id', async () => {
    const source = jsonSource()
    const started = (await source.request('POST', API_PATH.reviewRun('r1'), { language: 'Python', code: 'x = 1\n' })) as { id: string; status: string }
    expect(started).toMatchObject({ id: 'r1', status: 'pending' })
    const detail = (await source.request('GET', API_PATH.reviewById('r1'))) as Record<string, unknown>
    expect(detail).toMatchObject({ status: 'completed', analyzedContent: 'x = 1\n', analyzedLanguage: 'Python', content: 'x = 1\n', language: 'Python' })
  })
})
