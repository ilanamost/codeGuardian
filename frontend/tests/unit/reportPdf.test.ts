import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { fillReportPdf, reportColor, reportFileName } from '../../src/lib/reportPdf'
import { sampleReview } from '../utils/sampleData'
import type { ReviewDto } from '../../src/types'

const charWidth = 2.6

// Greedy word wrap with a fixed character width, like jsPDF's splitTextToSize.
function wrapWords(text: string, width: number): string[] {
  const lineList: string[] = []
  let line = ''
  text.split(' ').forEach((word) => {
    const next = line ? `${line} ${word}` : word
    if (next.length * charWidth > width && line) {
      lineList.push(line)
      line = word
    } else {
      line = next
    }
  })
  lineList.push(line)
  return lineList
}

type Call = { name: string; args: unknown[] }

// Records every drawing call; text and measuring calls return usable values.
function fakeDoc() {
  const callList: Call[] = []
  const doc = new Proxy({} as Record<string, unknown>, {
    get: (_target, name: string) => {
      if (name === 'splitTextToSize') return (text: string, width: number) => wrapWords(text, width)
      if (name === 'getTextWidth') return (text: string) => text.length * charWidth
      return (...args: unknown[]) => {
        callList.push({ name, args })
      }
    }
  }) as unknown as jsPDF
  const textList = () => callList.filter((call) => call.name === 'text').map((call) => String(call.args[0]))
  const fillList = () => callList.filter((call) => call.name === 'setFillColor').map((call) => call.args.join(','))
  return { doc, callList, textList, fillList }
}

function rgbOf(hex: string) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(',')
}

describe('reportPdf', () => {
  it('names the file after the review id', () => {
    expect(reportFileName('r7')).toBe('review-r7.pdf')
  })

  it('includes the title, the language and the severity counts', () => {
    const { doc, textList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'Python')

    expect(textList()).toEqual(
      expect.arrayContaining([sampleReview.title, 'Language: Python', 'critical: 1', 'medium: 3', 'Quality score: 72'])
    )
  })

  it('includes every finding message and every suggestion title', () => {
    const { doc, textList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'TypeScript')

    const all = textList().join('\n')
    sampleReview.finding.forEach((item) => expect(all).toContain(item.message))
    sampleReview.suggestion.forEach((item) => expect(all).toContain(item.title))
  })

  it('prints each finding detail once without a duplicated line prefix', () => {
    const { doc, textList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'TypeScript')

    expect(textList()).toContain(sampleReview.finding[0].detail)
    expect(textList().some((line) => /Line \d+: Line \d+/.test(line))).toBe(false)
  })

  it('draws a coloured header band with the app name and review name as real text', () => {
    const { doc, callList, textList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'TypeScript')

    const band = callList.find((call) => call.name === 'rect' && call.args[0] === 0 && call.args[1] === 0)
    expect(band?.args[2]).toBe(210)
    expect(textList()).toEqual(expect.arrayContaining(['CODEGUARDIAN', sampleReview.title]))
  })

  it('wraps an 80 character review name in the header band and grows the band', () => {
    const name = 'Very long review name '.repeat(4).slice(0, 80).trim()
    const { doc, callList, textList } = fakeDoc()

    fillReportPdf(doc, { ...sampleReview, title: name }, 'TypeScript')

    const band = callList.find((call) => call.name === 'rect' && call.args[0] === 0 && call.args[1] === 0)
    expect(band?.args[3]).toBeGreaterThan(36)
    expect(textList().join('').replace(/ /g, '')).toContain(name.replace(/ /g, ''))
  })

  it('shows a status chip in the status colour', () => {
    const { doc, textList, fillList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'TypeScript')

    expect(textList()).toContain('Status: completed')
    expect(fillList()).toContain(rgbOf(reportColor.successSoft))
  })

  it('colours severity badges and count tiles with the severity colours', () => {
    const { doc, textList, fillList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'TypeScript')

    expect(textList()).toEqual(expect.arrayContaining(['CRITICAL', 'HIGH', 'LOW']))
    expect(fillList()).toEqual(
      expect.arrayContaining([rgbOf(reportColor.critical), rgbOf(reportColor.high), rgbOf(reportColor.low)])
    )
  })

  it('draws section headings and vector icons from primitives', () => {
    const { doc, callList, textList } = fakeDoc()

    fillReportPdf(doc, sampleReview, 'TypeScript')

    expect(textList()).toEqual(
      expect.arrayContaining(['Findings Summary', 'Key Issues (3)', 'Suggested Refactors (3)'])
    )
    const drawn = new Set(callList.map((call) => call.name))
    ;['lines', 'triangle', 'circle', 'line'].forEach((name) => expect(drawn.has(name)).toBe(true))
    expect(drawn.has('addImage')).toBe(false)
  })

  it('moves a section heading to the next page together with its first item', () => {
    const { doc, callList, textList } = fakeDoc()
    const manyFindings: ReviewDto = {
      ...sampleReview,
      finding: Array.from({ length: 12 }, (_, index) => ({ ...sampleReview.finding[0], id: `f${index}`, message: `Issue ${index}` }))
    }

    fillReportPdf(doc, manyFindings, 'TypeScript')

    expect(callList.some((call) => call.name === 'addPage')).toBe(true)
    expect(textList()).toContain('Issue 11')
    expect(textList().filter((line) => line === 'Key Issues (12)')).toHaveLength(1)
  })

  it('keeps the report colours equal to the theme tokens', () => {
    const variables = readFileSync(resolve(__dirname, '../../src/styles/setup/variables.css'), 'utf8')
    const light = variables.slice(0, variables.indexOf(":root[data-theme='dark']"))
    const tokenByColor: Record<string, string> = {
      primarySoft: 'color-primary-soft',
      band: 'color-primary-dark',
      primary: 'color-primary-dark',
      text: 'color-text',
      border: 'color-border',
      muted: 'report-muted',
      white: 'color-surface'
    }
    ;['critical', 'high', 'medium', 'low', 'success', 'queued', 'neutral'].forEach((name) => {
      tokenByColor[name] = `report-${name}`
      tokenByColor[`${name}Soft`] = `report-${name}-soft`
    })
    // danger and warning reuse the critical and medium report tints
    tokenByColor.danger = 'report-critical'
    tokenByColor.dangerSoft = 'report-critical-soft'
    tokenByColor.warning = 'report-medium'
    tokenByColor.warningSoft = 'report-medium-soft'
    Object.entries(tokenByColor).forEach(([name, token]) => {
      expect(light).toMatch(new RegExp(`--${token}:\\s*${reportColor[name as keyof typeof reportColor]}`, 'i'))
    })
  })
})
