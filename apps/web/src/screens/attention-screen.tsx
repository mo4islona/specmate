import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { StatusChip } from '../components/status-chip.tsx'
import { listAttention } from '../lib/api-client.ts'
import { formatAge } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'

function reasonLabel(kind: string): string {
  if (kind === 'gate') return 'Gate decision'
  if (kind === 'decision') return 'Open decision'
  if (kind === 'failed') return 'Execution failed'

  return 'No recent signal'
}

export function AttentionScreen() {
  const attention = useQuery({
    queryKey: queryKeys.attention,
    queryFn: ({ signal }) => listAttention(signal),
  })

  if (attention.isPending) {
    return <LoadingState title="Scanning the attention channel…" />
  }
  if (attention.isError) {
    return <ErrorState title="Attention inbox unavailable" detail={attention.error.message} />
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="micro-label text-phosphor">Attention inbox</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Human signal queue
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Gates, failures, and stalled work that need an owner decision now.
          </p>
        </div>
        <div className="font-mono text-sm text-muted">
          <span className="text-2xl text-text">{attention.data.items.length}</span> open
        </div>
      </header>

      {attention.data.items.length === 0 ? (
        <section className="panel grid min-h-72 place-items-center border-phosphor/20 p-8 text-center">
          <div>
            <p className="font-mono text-5xl text-phosphor">✓</p>
            <h2 className="mt-5 text-xl font-semibold">Nothing needs the owner</h2>
            <p className="mt-2 text-sm text-muted">All tracked work is moving or complete.</p>
          </div>
        </section>
      ) : (
        <ol className="grid gap-3 xl:grid-cols-2">
          {attention.data.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/tasks/${item.task.id}`}
                className="panel attention-pulse group block h-full border-l-2 border-l-amber p-5 transition-colors hover:border-phosphor/50 hover:bg-elevated"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="micro-label text-amber">{reasonLabel(item.reason.kind)}</p>
                    <h2 className="mt-2 truncate text-lg font-semibold group-hover:text-phosphor">
                      {item.task.title}
                    </h2>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {formatAge(item.since)} ago
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted">{item.reason.detail}</p>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <StatusChip status={item.task.status} />
                  <span className="font-mono text-xs text-cyan">Open task →</span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
