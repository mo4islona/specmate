import { Link } from 'wouter'

export type TaskSurface = 'thread' | 'files' | 'docs'

interface TaskNavProps {
  readonly taskId: string
  readonly active: TaskSurface
  readonly fileCount: number | null
  readonly docCount: number | null
}

interface SurfaceEntry {
  readonly id: TaskSurface | 'guide'
  readonly label: string
  readonly href: string | null
  readonly count: number | null
  /** Drawn but not built: knowing where a thing will land is most of what stops it landing badly. */
  readonly soon?: boolean
}

/**
 * A column, not a header row. Three tabs fit a row; the fourth — the guide,
 * which needs somewhere to live — is what makes the row grow into the four-row
 * header this pass deletes. A column grows downward for free.
 */
export function TaskNav({ taskId, active, fileCount, docCount }: TaskNavProps) {
  const entries: SurfaceEntry[] = [
    { id: 'thread', label: 'Thread', href: `/tasks/${taskId}`, count: null },
    { id: 'files', label: 'Files', href: `/tasks/${taskId}/files`, count: fileCount },
    { id: 'docs', label: 'Docs', href: `/tasks/${taskId}/docs`, count: docCount },
    { id: 'guide', label: 'Guide', href: null, count: null, soon: true },
  ]

  return (
    <nav aria-label="Task surfaces" className="lg:w-24">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {entries.map((entry) => (
          <li key={entry.id} className="shrink-0 lg:shrink">
            <SurfaceLink entry={entry} active={entry.id === active} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function SurfaceLink({ entry, active }: { entry: SurfaceEntry; active: boolean }) {
  const label = (
    <>
      <span>{entry.label}</span>
      {entry.count !== null && (
        <span className="font-mono text-[0.62rem] text-muted">{entry.count}</span>
      )}
      {entry.soon && <span className="font-mono text-[0.58rem] text-muted/70">soon</span>}
    </>
  )
  const shared =
    'flex items-baseline gap-1.5 whitespace-nowrap px-2 py-1.5 font-mono text-[0.68rem] uppercase tracking-widest transition-colors lg:justify-between'

  if (!entry.href) {
    return (
      <span aria-disabled="true" className={`${shared} text-muted/60`} title="Not built yet">
        {label}
      </span>
    )
  }

  return (
    <Link
      href={entry.href}
      aria-current={active ? 'page' : undefined}
      className={`${shared} ${
        active
          ? 'border-l-2 border-l-phosphor bg-phosphor/8 text-text lg:border-l-2'
          : 'border-l-2 border-l-transparent text-muted hover:text-text'
      }`}
    >
      {label}
    </Link>
  )
}
