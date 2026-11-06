import { deletedReviewsKey, savedReviewsKey } from './fixtureDataSource'
import type { SavedReview } from '../../src/types'

// Direct access to the browser storage records that review.service keeps, for test setup and
// assertions (tests may touch storage; the app code goes through storage.service only).
function readMap(): Record<string, SavedReview> {
  try {
    return JSON.parse(window.localStorage.getItem(savedReviewsKey) ?? '{}')
  } catch {
    return {}
  }
}

export function readSavedReview(id: string): SavedReview | undefined {
  return readMap()[id]
}

export function seedSavedReview(id: string, value: { name?: string; language: string; code: string }) {
  window.localStorage.setItem(savedReviewsKey, JSON.stringify({ ...readMap(), [id]: { ...value, savedAt: new Date().toISOString() } }))
}

export function readDeletedIdList(): string[] {
  return JSON.parse(window.localStorage.getItem(deletedReviewsKey) ?? '[]')
}
