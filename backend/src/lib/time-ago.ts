import { TIME, TIME_AGO_TEXT } from '../utils/constants.js'

const unitList: [string, number][] = [
  [TIME_AGO_TEXT.day, TIME.secondsPerDay],
  [TIME_AGO_TEXT.hour, TIME.secondsPerHour],
  [TIME_AGO_TEXT.minute, TIME.secondsPerMinute]
]

// "just now", "5 minutes ago", "1 hour ago", "3 days ago", matching the seeded wording.
export function formatTimeAgo(from: number, now: number): string {
  const second = Math.max(0, Math.floor((now - from) / TIME.msPerSecond))
  if (second < TIME.secondsPerMinute) return TIME_AGO_TEXT.justNow
  for (const [unit, size] of unitList) {
    const count = Math.floor(second / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? '' : TIME_AGO_TEXT.pluralSuffix} ${TIME_AGO_TEXT.agoSuffix}`
  }
  return TIME_AGO_TEXT.justNow
}
