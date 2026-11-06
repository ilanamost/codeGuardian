import type { Finding, Severity } from '../types'
import { FINDING_GLYPH_CLASS } from './review.constants'

// The Monaco marker level of a finding (plan 021 Open Question 4): critical and high are errors,
// medium a warning, low (and info) information.
export type MarkerLevel = 'error' | 'warning' | 'info'

export const MARKER_LEVEL_BY_SEVERITY: Record<Severity, MarkerLevel> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'info'
}

// A plain marker: Monaco's IMarkerData without the Monaco enum, so it is testable without Monaco.
// CodeEditor maps `level` to monaco.MarkerSeverity.
export type FindingMarker = {
  findingId: string
  level: MarkerLevel
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  glyphClassName: string
}

// One marker per finding over the whole line `line_start` (1-based) of the code, given as its
// list of lines. A finding past the last line (or before the first) is skipped.
export function findingToMarker(findingList: Finding[], lineList: string[]): FindingMarker[] {
  return findingList
    .filter((item) => Number.isInteger(item.line_start) && item.line_start >= 1 && item.line_start <= lineList.length)
    .map((item) => ({
      findingId: item.id,
      level: MARKER_LEVEL_BY_SEVERITY[item.severity],
      message: item.detail ? `${item.message}\n${item.detail}` : item.message,
      startLineNumber: item.line_start,
      startColumn: 1,
      endLineNumber: item.line_start,
      endColumn: lineList[item.line_start - 1].length + 1,
      glyphClassName: FINDING_GLYPH_CLASS[item.severity]
    }))
}
