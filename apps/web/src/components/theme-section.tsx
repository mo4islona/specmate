import { THEMES, type ThemeId } from '../theme/themes.ts'
import { useTheme } from '../theme/use-theme.tsx'

/**
 * A swatch is drawn in the theme it offers: the tile carries `data-theme`, so
 * every token inside it resolves to that palette while the page around it stays
 * in the current one. A row of nine named buttons would have made the owner
 * click through nine repaints to find out what "Ayu Mirage" is.
 */
function ThemeSwatch({ id }: { id: ThemeId }) {
  return (
    <span
      data-theme={id}
      className="block rounded-lg border border-border bg-ground p-3 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-info"
    >
      <span className="flex items-center gap-1.5">
        <span className="block h-2 w-2 rounded-full bg-accent" />
        <span className="block h-2 w-2 rounded-full bg-attention" />
        <span className="block h-2 w-2 rounded-full bg-danger" />
        <span className="ml-auto block h-2 w-2 rounded-full bg-success" />
      </span>

      <span className="mt-3 block rounded-md border border-border bg-surface p-2.5">
        <span className="block h-1.5 w-2/3 rounded-full bg-text/70" />
        <span className="mt-2 block h-1.5 w-2/5 rounded-full bg-muted/70" />
      </span>
    </span>
  )
}

export function ThemeSection() {
  const { themeId, setTheme } = useTheme()

  return (
    <section className="panel space-y-5">
      <div>
        <p className="micro-label text-info">This browser only</p>
        <h2 className="mt-2 text-lg font-semibold">Theme</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Colours and typefaces, never layout. Both come from the chart library's own presets, so
          the telemetry canvas moves with the page. The choice is remembered in this browser and
          travels with nothing else.
        </p>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Theme</legend>

        {THEMES.map((theme) => {
          const chosen = theme.id === themeId

          return (
            <label
              key={theme.id}
              className={`cursor-pointer rounded-xl border p-1.5 transition-colors ${
                chosen ? 'border-accent' : 'border-border hover:border-border-bright'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={theme.id}
                checked={chosen}
                className="peer sr-only"
                onChange={() => setTheme(theme.id)}
              />

              <ThemeSwatch id={theme.id} />

              <span className="flex items-baseline justify-between gap-2 px-1.5 pt-2 pb-0.5">
                <span
                  className={`font-mono text-[0.75rem] ${chosen ? 'text-accent' : 'text-text'}`}
                >
                  {theme.label}
                </span>
                <span className="font-mono text-[0.62rem] text-muted">
                  {theme.dark ? 'dark' : 'light'}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>
    </section>
  )
}
