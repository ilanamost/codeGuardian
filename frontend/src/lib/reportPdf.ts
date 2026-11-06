import type { jsPDF } from 'jspdf'
import type { ReviewDto, ReviewStatus, Severity } from '../types'

const marginX = 16
const topY = 20
const bottomY = 280
const pageWidth = 210
const textWidth = pageWidth - marginX * 2
const baseBandHeight = 36
const appName = 'CodeGuardian'

// jsPDF cannot read CSS variables, so these mirror the muted --report-* tokens (and the primary-dark band) in
// styles/setup/variables.css.
// tests/unit/reportPdf.test.ts checks that they stay equal to the tokens.
export const reportColor = {
  band: '#1d429e',
  primary: '#1d429e',
  primarySoft: '#e8efff',
  text: '#111b33',
  muted: '#5d6882',
  border: '#e3e8f0',
  cardBg: '#ffffff',
  critical: '#a8403e',
  criticalSoft: '#f6e6e5',
  high: '#a65420',
  highSoft: '#f7ebe0',
  medium: '#80651a',
  mediumSoft: '#f5eed8',
  low: '#3a5c9e',
  lowSoft: '#e6ecf6',
  success: '#2b7149',
  successSoft: '#e3efe8',
  danger: '#a8403e',
  dangerSoft: '#f6e6e5',
  warning: '#80651a',
  warningSoft: '#f5eed8',
  queued: '#65549e',
  queuedSoft: '#ece9f5',
  neutral: '#56617c',
  neutralSoft: '#eceff5',
  white: '#ffffff'
}

type ColorName = keyof typeof reportColor

const severityColor: Record<Severity, { solid: ColorName; soft: ColorName; label: string }> = {
  critical: { solid: 'critical', soft: 'criticalSoft', label: 'CRITICAL' },
  high: { solid: 'high', soft: 'highSoft', label: 'HIGH' },
  medium: { solid: 'medium', soft: 'mediumSoft', label: 'MEDIUM' },
  low: { solid: 'low', soft: 'lowSoft', label: 'LOW' },
  info: { solid: 'neutral', soft: 'neutralSoft', label: 'INFO' }
}

const statusColor: Record<ReviewStatus, { solid: ColorName; soft: ColorName }> = {
  pending: { solid: 'neutral', soft: 'neutralSoft' },
  queued: { solid: 'queued', soft: 'queuedSoft' },
  in_progress: { solid: 'primary', soft: 'primarySoft' },
  completed: { solid: 'success', soft: 'successSoft' },
  failed: { solid: 'danger', soft: 'dangerSoft' },
  cancelled: { solid: 'warning', soft: 'warningSoft' }
}

export function reportFileName(id: string): string {
  return `review-${id}.pdf`
}

function rgb(name: ColorName): [number, number, number] {
  const hex = reportColor[name]
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

// Pure builder: takes an already created document so it can run (and be tested) without a download.
// All text is drawn with doc.text so it stays selectable; icons are vector primitives.
export function fillReportPdf(doc: jsPDF, review: ReviewDto, language: string): jsPDF {
  let y = topY

  const fill = (name: ColorName) => doc.setFillColor(...rgb(name))
  const stroke = (name: ColorName) => doc.setDrawColor(...rgb(name))
  const ink = (name: ColorName) => doc.setTextColor(...rgb(name))
  const font = (size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
  }
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text, width)

  const ensureSpace = (height: number) => {
    if (y + height > bottomY) {
      doc.addPage()
      y = topY
    }
  }

  // Icons: x, y is the top-left corner of a size x size box.
  const shieldIcon = (x: number, top: number, size: number, color: ColorName) => {
    fill(color)
    doc.lines(
      [
        [size, 0],
        [0, size * 0.55],
        [-size / 2, size * 0.45],
        [-size / 2, -size * 0.45]
      ],
      x,
      top,
      [1, 1],
      'F',
      true
    )
  }

  const checkIcon = (x: number, top: number, size: number, color: ColorName) => {
    stroke(color)
    doc.setLineWidth(0.7)
    doc.line(x, top + size * 0.55, x + size * 0.35, top + size * 0.9)
    doc.line(x + size * 0.35, top + size * 0.9, x + size, top + size * 0.1)
  }

  const crossIcon = (x: number, top: number, size: number, color: ColorName) => {
    stroke(color)
    doc.setLineWidth(0.7)
    doc.line(x + size * 0.1, top + size * 0.1, x + size * 0.9, top + size * 0.9)
    doc.line(x + size * 0.9, top + size * 0.1, x + size * 0.1, top + size * 0.9)
  }

  const clockIcon = (x: number, top: number, size: number, color: ColorName) => {
    stroke(color)
    doc.setLineWidth(0.5)
    doc.circle(x + size / 2, top + size / 2, size / 2, 'S')
    doc.line(x + size / 2, top + size / 2, x + size / 2, top + size * 0.2)
    doc.line(x + size / 2, top + size / 2, x + size * 0.75, top + size / 2)
  }

  const statusIcon = (status: ReviewStatus, x: number, top: number, size: number, color: ColorName) => {
    if (status === 'completed') checkIcon(x, top, size, color)
    else if (status === 'failed' || status === 'cancelled') crossIcon(x, top, size, color)
    else clockIcon(x, top, size, color)
  }

  const warningIcon = (x: number, top: number, size: number, color: ColorName) => {
    fill(color)
    doc.triangle(x + size / 2, top, x + size, top + size, x, top + size, 'F')
    fill('white')
    doc.rect(x + size / 2 - 0.3, top + size * 0.35, 0.6, size * 0.35, 'F')
    doc.circle(x + size / 2, top + size * 0.85, 0.35, 'F')
  }

  const wrenchIcon = (x: number, top: number, size: number, color: ColorName) => {
    stroke(color)
    doc.setLineWidth(1)
    doc.line(x + size * 0.15, top + size * 0.85, x + size * 0.65, top + size * 0.35)
    fill(color)
    doc.circle(x + size * 0.72, top + size * 0.28, size * 0.28, 'F')
    fill('white')
    doc.circle(x + size * 0.8, top + size * 0.2, size * 0.1, 'F')
  }

  const listIcon = (x: number, top: number, size: number, color: ColorName) => {
    fill(color)
    ;[0.1, 0.45, 0.8].forEach((offset) => {
      doc.circle(x + size * 0.1, top + size * offset, size * 0.08, 'F')
      doc.rect(x + size * 0.3, top + size * offset - size * 0.05, size * 0.7, size * 0.1, 'F')
    })
  }

  const chip = (x: number, top: number, label: string, solid: ColorName, soft: ColorName, icon?: (ix: number, iy: number) => void) => {
    font(9, 'bold')
    const iconSpace = icon ? 6 : 0
    const width = doc.getTextWidth(label) + 8 + iconSpace
    fill(soft)
    doc.roundedRect(x, top, width, 7, 3.5, 3.5, 'F')
    icon?.(x + 3, top + 1.8)
    ink(solid)
    doc.text(label, x + 4 + iconSpace, top + 4.9)
    return width
  }

  // Header band: app name, review name (wrapped, so the band grows to fit), shield icon.
  const titleWidth = textWidth - 13
  font(18, 'bold')
  let titleLineList = wrap(review.title, titleWidth)
  if (titleLineList.length > 2 || titleLineList.some((line) => doc.getTextWidth(line) > titleWidth)) {
    // A long unbroken name: hard-split it into two lines of equal length.
    const half = Math.ceil(review.title.length / 2)
    titleLineList = [review.title.slice(0, half), review.title.slice(half)]
    font(13, 'bold')
  }
  const extraBand = (titleLineList.length - 1) * 8
  const bandHeight = baseBandHeight + extraBand
  fill('band')
  doc.rect(0, 0, pageWidth, bandHeight, 'F')
  shieldIcon(marginX, 8, 9, 'white')
  checkIcon(marginX + 2.2, 10.2, 4.6, 'band')
  ink('white')
  titleLineList.forEach((line, index) => doc.text(line, marginX + 13, 21 + index * 8))
  font(9, 'bold')
  doc.text(appName.toUpperCase(), marginX + 13, 11)
  font(9)
  doc.text('Code review report', marginX + 13, 28 + extraBand)
  y = bandHeight + 8

  // Status chip and metadata.
  const colors = statusColor[review.status]
  const chipWidth = chip(marginX, y, `Status: ${review.status}`, colors.solid, colors.soft, (ix, iy) =>
    statusIcon(review.status, ix, iy, 3.4, colors.solid)
  )
  font(10)
  ink('muted')
  doc.text(`Language: ${language}`, marginX + chipWidth + 6, y + 5)
  y += 15
  font(10)
  ink('text')
  doc.text(`Analyzed: ${review.analyzedAgo}`, marginX, y)
  font(10, 'bold')
  doc.text(`Quality score: ${review.qualityScore}`, marginX + 70, y)
  y += 4

  const heading = (text: string, icon: (x: number, top: number) => void, firstItemHeight: number) => {
    // Keeps the heading together with the first item that follows it.
    ensureSpace(14 + firstItemHeight)
    y += 6
    icon(marginX, y - 4.5)
    font(13, 'bold')
    ink('primary')
    doc.text(text, marginX + 7, y)
    stroke('border')
    doc.setLineWidth(0.3)
    doc.line(marginX, y + 2, pageWidth - marginX, y + 2)
    y += 7
  }

  // Count tiles.
  heading('Findings Summary', (x, top) => listIcon(x, top, 4.5, 'band'), 16)
  const tileGap = 4
  const tileWidth = (textWidth - tileGap * 3) / 4
  review.findingCount.forEach(({ severity, count }, index) => {
    const tone = severityColor[severity]
    const tileX = marginX + index * (tileWidth + tileGap)
    fill(tone.soft)
    doc.roundedRect(tileX, y, tileWidth, 14, 2, 2, 'F')
    fill(tone.solid)
    doc.circle(tileX + 5, y + 7, 1.6, 'F')
    font(11, 'bold')
    ink('text')
    doc.text(`${severity}: ${count}`, tileX + 9, y + 8.4)
  })
  y += 18

  // Key issues: one card per finding with a severity badge.
  const findingWidth = textWidth - 10
  const findingHeight = (message: string, detail: string, badgeWidth: number) => {
    font(10, 'bold')
    const messageLines = wrap(message, findingWidth - badgeWidth - 6)
    font(9)
    return { messageLines, detailLines: wrap(detail, findingWidth), height: 5 + Math.max(messageLines.length * 5, 6) }
  }

  heading(`Key Issues (${review.finding.length})`, (x, top) => warningIcon(x, top, 4.5, 'band'), 24)
  review.finding.forEach((item) => {
    const tone = severityColor[item.severity]
    font(7, 'bold')
    const badgeWidth = doc.getTextWidth(tone.label) + 5
    const { messageLines, detailLines, height } = findingHeight(item.message, item.detail, badgeWidth)
    const cardHeight = height + detailLines.length * 4.2 + 3
    ensureSpace(cardHeight + 3)
    fill('cardBg')
    stroke('border')
    doc.setLineWidth(0.2)
    doc.roundedRect(marginX, y, textWidth, cardHeight, 2, 2, 'FD')
    fill(tone.solid)
    doc.rect(marginX, y + 1, 1.4, cardHeight - 2, 'F')
    fill(tone.solid)
    doc.roundedRect(marginX + 5, y + 3, badgeWidth, 5, 1.5, 1.5, 'F')
    font(7, 'bold')
    ink('white')
    doc.text(tone.label, marginX + 7.5, y + 6.6)
    font(10, 'bold')
    ink('text')
    messageLines.forEach((line, index) => doc.text(line, marginX + 5 + badgeWidth + 3, y + 6.8 + index * 5))
    font(9)
    ink('muted')
    detailLines.forEach((line, index) => doc.text(line, marginX + 5, y + height + 1.5 + index * 4.2))
    y += cardHeight + 3
  })

  // Suggested refactors.
  heading(`Suggested Refactors (${review.suggestion.length})`, (x, top) => wrenchIcon(x, top, 4.5, 'band'), 22)
  review.suggestion.forEach((item) => {
    font(10, 'bold')
    const titleLines = wrap(item.title, textWidth - 16)
    font(9)
    const detailLines = wrap(item.detail, textWidth - 16)
    const cardHeight = 4 + titleLines.length * 5 + 1.5 + detailLines.length * 4.2 + 2
    ensureSpace(cardHeight + 3)
    fill('cardBg')
    stroke('border')
    doc.setLineWidth(0.2)
    doc.roundedRect(marginX, y, textWidth, cardHeight, 2, 2, 'FD')
    wrenchIcon(marginX + 4, y + 3.5, 5, 'band')
    font(10, 'bold')
    ink('text')
    titleLines.forEach((line, index) => doc.text(line, marginX + 13, y + 6.6 + index * 5))
    font(9)
    ink('muted')
    detailLines.forEach((line, index) => doc.text(line, marginX + 13, y + 4 + titleLines.length * 5 + 2.5 + index * 4.2))
    y += cardHeight + 3
  })

  return doc
}

export async function buildReportPdf(review: ReviewDto, language: string): Promise<jsPDF> {
  // Loaded on first use so the library stays out of the initial bundle.
  const { jsPDF: JsPdf } = await import('jspdf')
  return fillReportPdf(new JsPdf({ unit: 'mm', format: 'a4' }), review, language)
}

export async function downloadReportPdf(id: string, review: ReviewDto, language: string): Promise<void> {
  const doc = await buildReportPdf(review, language)
  doc.save(reportFileName(id))
}
