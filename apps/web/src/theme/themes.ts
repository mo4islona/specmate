/**
 * The themes the owner can pick from, and the only place the app names one.
 * The colours themselves live in `theme.css`, keyed by these ids — nothing here
 * knows what a theme looks like, and nothing outside `theme.css` knows a hex.
 */
export interface ThemeDefinition {
  readonly id: string
  readonly label: string
  /** Whether the palette is dark, so a preview can say which half it belongs to. */
  readonly dark: boolean
}

/** Seeded from the `@wick-charts/react` presets; see `theme.css`. */
export const THEMES = [
  { id: 'one-dark-pro', label: 'One Dark Pro', dark: true },
  { id: 'night-owl', label: 'Night Owl', dark: true },
  { id: 'dracula', label: 'Dracula', dark: true },
  { id: 'catppuccin', label: 'Catppuccin', dark: true },
  { id: 'gruvbox', label: 'Gruvbox', dark: true },
  { id: 'ayu-mirage', label: 'Ayu Mirage', dark: true },
  { id: 'matrix', label: 'Matrix', dark: true },
  { id: 'github-light', label: 'GitHub Light', dark: false },
  { id: 'solarized-light', label: 'Solarized Light', dark: false },
] as const satisfies readonly ThemeDefinition[]

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME_ID: ThemeId = 'one-dark-pro'

/**
 * Read by the boot script in `index.html` before the bundle loads, so the first
 * paint is already in the owner's theme. Changing it renames that key too.
 */
export const THEME_STORAGE_KEY = 'specmate.theme'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function themeLabel(id: ThemeId): string {
  return THEMES.find((theme) => theme.id === id)?.label ?? id
}

/** The attribute every palette in `theme.css` is keyed by. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id
}

/**
 * A preference of one person on one machine — it belongs in the browser, not in
 * the server's settings, and a browser that refuses storage still gets a theme.
 */
export function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)

    return isThemeId(stored) ? stored : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

export function storeTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // Storage denied: the theme still applies, it just will not survive a reload.
  }
}
