import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, isThemeId, THEMES, themeLabel } from './themes.ts'

// Read rather than imported: vitest stubs a CSS import out to an empty string,
// `?raw` included. The suite's root is apps/web.
const css = readFileSync(join(process.cwd(), 'src/theme/theme.css'), 'utf8')

/**
 * Every role a component can name. A theme that leaves one out inherits it from
 * whichever palette the fallback layer holds — which is how a light theme ends
 * up with a dark theme's borders and nobody notices until a screenshot.
 */
const TOKENS = [
  '--color-ground',
  '--color-surface',
  '--color-elevated',
  '--color-border',
  '--color-border-bright',
  '--color-text',
  '--color-muted',
  '--color-accent',
  '--color-attention',
  '--color-danger',
  '--color-info',
  '--color-success',
  '--color-syntax-comment',
  '--color-syntax-string',
  '--color-syntax-keyword',
  '--color-syntax-number',
  '--color-syntax-name',
  '--color-on-accent',
  '--color-on-attention',
  '--color-hover-tint',
  '--shadow-popover',
  '--font-mono',
  '--font-sans',
]

function declarations(id: string): string | null {
  return css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

function palette(id: string): Record<string, string> {
  const block = declarations(id) ?? ''

  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((match) => [match[1], match[2]]),
  )
}

function luminance(hex: string): number {
  const channel = (value: number) => {
    const scaled = value / 255

    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const at = (offset: number) => channel(Number.parseInt(hex.slice(offset, offset + 2), 16))

  return 0.2126 * at(1) + 0.7152 * at(3) + 0.0722 * at(5)
}

function contrast(left: string, right: string): number {
  const a = luminance(left)
  const b = luminance(right)

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const SURFACES = ['--color-ground', '--color-surface', '--color-elevated']
const ROLES = [
  '--color-muted',
  '--color-accent',
  '--color-attention',
  '--color-danger',
  '--color-info',
  '--color-success',
  // Code is read for minutes at a time, so its five hues hold the same floor
  // every other colour here does — on the diff's ground, which is a few per
  // cent off `--color-ground` and is measured as it.
  '--color-syntax-comment',
  '--color-syntax-string',
  '--color-syntax-keyword',
  '--color-syntax-number',
  '--color-syntax-name',
]

describe('theme palettes', () => {
  it.each(THEMES)('$label declares every token and its colour scheme', (theme) => {
    const block = declarations(theme.id)

    expect(block).not.toBeNull()
    for (const token of TOKENS) {
      expect.soft(block).toContain(`${token}:`)
    }
    expect(block).toContain(`color-scheme: ${theme.dark ? 'dark' : 'light'}`)
  })

  /**
   * The floor a hand-edit has to hold. The full sweep — every wash, every pill,
   * every pane the app really renders — is measured in a browser, because only
   * a browser can composite `color-mix`; this covers the pairs that a wrong hex
   * breaks first, and it fails in CI rather than in a screenshot.
   */
  it.each(THEMES)('$label keeps its text and role colours legible', (theme) => {
    const colors = palette(theme.id)
    const ratio = (left: string, right: string) => {
      const from = colors[left]
      const to = colors[right]
      if (!from || !to) throw new Error(`${theme.id} declares no ${from ? right : left}`)

      return contrast(from, to)
    }

    for (const surface of SURFACES) {
      expect.soft(ratio('--color-text', surface)).toBeGreaterThanOrEqual(7)

      for (const role of ROLES) {
        expect.soft(ratio(role, surface)).toBeGreaterThanOrEqual(4.5)
      }
    }

    // The label on a filled control, against the fill it labels.
    expect.soft(ratio('--color-on-accent', '--color-accent')).toBeGreaterThanOrEqual(4.5)
    expect.soft(ratio('--color-on-accent', '--color-danger')).toBeGreaterThanOrEqual(4.5)
    expect(ratio('--color-on-attention', '--color-attention')).toBeGreaterThanOrEqual(4.5)
  })

  it('offers nothing the stylesheet cannot paint, and paints nothing it does not offer', () => {
    const declared = [...css.matchAll(/\[data-theme="([^"]+)"\]/g)].map((match) => match[1])

    expect(new Set(declared)).toEqual(new Set(THEMES.map((theme) => theme.id)))
  })

  it('defaults to a theme that exists', () => {
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true)
    expect(themeLabel(DEFAULT_THEME_ID)).toBe('One Dark Pro')
  })

  it('refuses an id that is not one of the themes', () => {
    expect(isThemeId('swamp')).toBe(false)
    expect(isThemeId(null)).toBe(false)
  })
})
