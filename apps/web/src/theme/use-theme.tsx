import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'
import { applyTheme, readStoredTheme, storeTheme, type ThemeId } from './themes.ts'

interface ThemeContextValue {
  readonly themeId: ThemeId
  readonly setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const stored = readStoredTheme()
    // Written here rather than from an effect: effects run children-first, so a
    // child that reads the palette off the document — the telemetry canvas —
    // would sample the theme the page was wearing a moment ago.
    applyTheme(stored)

    return stored
  })

  const setTheme = useCallback((id: ThemeId) => {
    applyTheme(id)
    storeTheme(id)
    setThemeId(id)
  }, [])

  return <ThemeContext value={{ themeId, setTheme }}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme outside ThemeProvider')

  return value
}
