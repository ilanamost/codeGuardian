import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../../src/styles/setup/variables.css'), 'utf8')
const themeCss = readFileSync(resolve(__dirname, '../../src/styles/setup/theme.css'), 'utf8')

const requiredToken = [
  'color-primary', 'color-primary-hover', 'color-primary-soft',
  'color-sidebar-bg', 'color-sidebar-text', 'color-sidebar-active',
  'color-page-bg', 'color-surface', 'color-card', 'color-border', 'color-text', 'color-text-muted',
  'color-code-bg', 'color-code-text',
  'color-critical', 'color-high', 'color-medium', 'color-low',
  'color-critical-soft', 'color-high-soft', 'color-medium-soft', 'color-low-soft',
  'color-success', 'color-danger', 'color-warning',
  'color-success-soft', 'color-danger-soft', 'color-warning-soft',
  'color-queued', 'color-queued-soft', 'color-neutral', 'color-neutral-soft',
  'color-chart-1', 'color-chart-2', 'color-chart-3', 'color-chart-4', 'color-chart-5',
  'font-sans', 'font-mono', 'radius-sm', 'radius-md', 'radius-lg',
  'shadow-card', 'sidebar-width', 'space-4', 'text-base',
  'color-sign-in-bg', 'color-sign-in-card', 'color-input-border', 'color-error-text',
  'editor-scrollbar-thumb', 'editor-scrollbar-thumb-hover', 'editor-scrollbar-track'
]

// The dark theme block of variables.css.
const darkCss = css.slice(css.indexOf(":root[data-theme='dark']"))

describe('theme variables', () => {
  it.each(requiredToken)('defines --%s', (token: string) => {
    expect(css).toMatch(new RegExp("--" + token + "[ ]*:"))
  })

  it.each([['xs', 480], ['md', 768], ['lg', 1024], ['xl', 1280]])('defines breakpoint %s as %ipx', (name, px) => {
    expect(themeCss).toContain('--breakpoint-' + name + ': ' + px + 'px')
  })

  it('defines the mobile nav height', () => {
    expect(css).toMatch(/--mobile-nav-height\s*:/)
  })

  // Plan 029: a darker light tint behind the sign-in card; the dark theme keeps its page colour.
  it('gives the sign-in page a darker light tint and keeps the dark page colour in the dark theme', () => {
    expect(css).toMatch(/--color-sign-in-bg:\s*#dfe5f1/)
    expect(darkCss).toMatch(/--color-sign-in-bg:\s*#0c1426/)
    expect(darkCss).toMatch(/--color-page-bg:\s*#0c1426/)
  })

  it.each(['color-sign-in-bg', 'color-sign-in-card', 'color-input-border', 'color-error-text'])('exposes --%s as a Tailwind colour', (token) => {
    expect(themeCss).toContain(`--${token}: var(--${token})`)
  })

  // Plan 029 revision 2: form control boundaries at 3:1 (WCAG 1.4.11) and error text at 4.5:1
  // (WCAG AA) on every background they sit on, in both themes.
  describe.each(['light', 'dark'])('%s theme contrast', (theme) => {
    const lightCss = css.slice(0, css.indexOf(":root[data-theme='dark']"))
    const hexOf = (token: string): string => {
      const pick = (block: string) => block.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6}|var\\(--([a-z-]+)\\))`))
      const found = (theme === 'dark' ? pick(darkCss) : null) ?? pick(lightCss)
      if (!found) throw new Error(`no value for --${token}`)
      return found[2] ? hexOf(found[2]) : found[1]
    }
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((index) => {
        const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (first: string, second: string) => {
      const [light, dark] = [luminance(hexOf(first)), luminance(hexOf(second))].sort((a, b) => b - a)
      return (light + 0.05) / (dark + 0.05)
    }

    it.each(['color-page-bg', 'color-surface', 'color-card', 'color-sign-in-bg', 'color-sign-in-card', 'color-code-bg'])(
      'input border is at least 3:1 on --%s',
      (background) => {
        expect(contrast('color-input-border', background)).toBeGreaterThanOrEqual(3)
      }
    )

    it.each(['color-surface', 'color-card', 'color-sign-in-card', 'color-danger-soft'])('error text is at least 4.5:1 on --%s', (background) => {
      expect(contrast('color-error-text', background)).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('puts Inter first in the sans font stack', () => {
    expect(css).toMatch(/--font-sans:\s*Inter,/)
  })
})
