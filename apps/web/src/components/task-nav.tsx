import { Link } from 'wouter'
import { cx } from '../ui/index.ts'

export type TaskSurface = 'thread' | 'files' | 'docs'

interface TaskNavProps {
  readonly taskId: string
  readonly active: TaskSurface
  readonly fileCount: number | null
  readonly docCount: number | null
}

interface SurfaceEntry {
  readonly id: TaskSurface
  readonly label: string
  readonly href: string
  readonly count: number | null
}

/**
 * A row under the header, not a column beside the content. The column cost a
 * second left edge next to the app's own task list, which is two navigations
 * for one screen.
 *
 * Every tab here opens something. A fourth one reading `Guide soon` sat between
 * the owner and the three that work, naming a surface nobody could describe —
 * knowing where a thing will land is worth drawing when the thing is being
 * built, and clutter the rest of the time.
 */
export function TaskNav({ taskId, active, fileCount, docCount }: TaskNavProps) {
  const entries: SurfaceEntry[] = [
    { id: 'thread', label: 'Thread', href: `/tasks/${taskId}`, count: null },
    { id: 'files', label: 'Files', href: `/tasks/${taskId}/files`, count: fileCount },
    { id: 'docs', label: 'Docs', href: `/tasks/${taskId}/docs`, count: docCount },
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
  // A pill rather than an underline: the rule under the tabs was one more line
  // on a screen this pass is spending on space instead.
  return (
    <Link
      href={entry.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex items-baseline gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 font-mono text-[0.72rem] transition-colors',
        active
          ? 'bg-text/[0.09] font-semibold text-text'
          : 'text-muted hover:bg-text/[0.06] hover:text-text',
      )}
    >
      <span>{entry.label}</span>
      {entry.count !== null && <span className="text-[0.66rem] text-muted">{entry.count}</span>}
    </Link>
  )
}
