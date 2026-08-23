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
 * A row under the header, not a column beside the content. The column cost a
 * second left edge next to the app's own task list, which is two navigations
 * for one screen; four tabs fit a row with room to spare.
 */
export function TaskNav({ taskId, active, fileCount, docCount }: TaskNavProps) {
  const entries: SurfaceEntry[] = [
    { id: 'thread', label: 'Thread', href: `/tasks/${taskId}`, count: null },
    { id: 'files', label: 'Files', href: `/tasks/${taskId}/files`, count: fileCount },
    { id: 'docs', label: 'Docs', href: `/tasks/${taskId}/docs`, count: docCount },
    { id: 'guide', label: 'Guide', href: null, count: null, soon: true },
  ]

  return (
    <nav aria-label="Task surfaces" className="min-w-0">
      <ul className="scroll-thin flex items-stretch gap-x-1 overflow-x-auto">
        {entries.map((entry) => (
          <li key={entry.id} className="shrink-0">
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
        <span className="font-mono text-[0.6rem] text-muted/70">{entry.count}</span>
      )}
      {entry.soon && <span className="font-mono text-[0.56rem] text-muted/70">soon</span>}
    </>
  )
  const shared =
    'flex items-baseline gap-1.5 whitespace-nowrap border-b-2 px-2 py-1.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.13em] transition-colors'

  if (!entry.href) {
    return (
      <span
        aria-disabled="true"
        className={`${shared} border-b-transparent text-muted/60`}
        title="Not built yet"
      >
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
          ? 'border-b-phosphor text-phosphor'
          : 'border-b-transparent text-muted hover:text-text'
      }`}
    >
      {label}
    </Link>
  )
}
