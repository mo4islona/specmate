import { useQuery } from '@tanstack/react-query'
import { StatusChip } from '../components/status-chip.tsx'
import { signalDot } from '../components/tone.ts'
import { listAttention } from '../lib/api-client.ts'
import { formatAge } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
import {
  Dot,
  ErrorState,
  Icon,
  LoadingState,
  MicroLabel,
  Note,
  PageHeader,
  Panel,
  PanelLink,
} from '../ui/index.ts'

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
    return <LoadingState title="Scanning the attention channel…" shape="cards" />
  }
  if (attention.isError) {
    return <ErrorState title="Attention inbox unavailable" detail={attention.error.message} />
  }

  return (
    <div className="space-y-8">
      <PageHeader
        className="pb-2"
        eyebrow="Attention inbox"
        title="Human signal queue"
        description="Gates, failures, and stalled work that need an owner decision now."
        aside={
          <p className="font-mono text-sm text-muted">
            <span className="text-2xl text-text">{attention.data.items.length}</span> open
          </p>
        }
      />

      {attention.data.items.length === 0 ? (
        <Panel className="grid min-h-72 place-items-center text-center">
          <div>
            <Icon name="check" size="xl" className="mx-auto text-muted" />
            <h2 className="mt-5 text-xl font-semibold">Nothing needs the owner</h2>
            <Note className="mt-2">All tracked work is moving or complete.</Note>
          </div>
        </Panel>
      ) : (
        <ol className="grid gap-3 xl:grid-cols-2">
          {attention.data.items.map((item) => (
            <li key={item.id}>
              <PanelLink
                href={`/tasks/${item.task.id}`}
                className="group block h-full transition-colors hover:border-border-bright hover:bg-elevated"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {/* Every card here is asking, so the mark is not what tells
                        them apart — it is what says the queue is live rather
                        than a list of things that happened. */}
                    <div className="flex items-center gap-2">
                      <Dot className={signalDot('asking')} live halo />
                      <MicroLabel>{reasonLabel(item.reason.kind)}</MicroLabel>
                    </div>
                    <h2 className="mt-2 truncate text-lg font-semibold">{item.task.title}</h2>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {formatAge(item.since)} ago
                  </span>
                </div>

                <Note className="mt-4">{item.reason.detail}</Note>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <StatusChip status={item.task.status} />
                  <span className="font-mono text-xs text-muted">Open task →</span>
                </div>
              </PanelLink>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
