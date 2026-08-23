import type { TimelineEvent } from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { shortModel } from '../lib/task-pipeline.ts'
import {
  eventTitle,
  formatDuration,
  formatTokens,
  stageActivityLabel,
  stageDuration,
  stageTokens,
} from '../lib/task-thread.ts'
import { CommitRef } from './commit-ref.tsx'

interface RunLogProps {
  readonly node: PipelineNodeView
  readonly events: readonly TimelineEvent[]
  readonly repoUrl: string
  readonly onClose: () => void
  readonly onComment: () => void
}

/**
 * Everything the thread used to carry inline, behind the node that produced it
 * (REQ-914, REQ-915). A layer rather than a route: it is a detail of the surface
 * the owner is already on, and routing it would put a back button between them
 * and the thread they were reading.
 */
export function RunLog({ node, events, repoUrl, onClose, onComment }: RunLogProps) {
  const runIds = new Set(node.runs.map((run) => run.id))
  const lines = events.filter((event) => event.stageId && runIds.has(event.stageId))

  return (
    <section
      aria-label={`${node.label} run log`}
      className="scroll-thin min-h-0 flex-1 overflow-y-auto border border-border bg-surface"
    >
      <header className="sticky top-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-3">
        <h2 className="text-sm font-medium">{node.label}</h2>
        <p className="min-w-0 flex-1 font-mono text-[0.66rem] text-muted">run log</p>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[0.66rem] uppercase tracking-widest text-muted hover:text-text"
        >
          ✕ close
        </button>
      </header>

      <div className="space-y-4 p-4">
        {node.runs.length === 0 && (
          <p className="font-mono text-[0.72rem] text-muted">This node has not run yet.</p>
        )}

        {node.runs.map((run, index) => {
          const duration = stageDuration(run)
          const tokens = stageTokens(run)
          const cost = run.telemetry?.costUsd ?? null
          const model = run.telemetry?.model ?? node.binding?.model ?? null
          const runLines = lines.filter((event) => event.stageId === run.id)

          return (
            <article key={run.id}>
              <h3 className="flex flex-wrap items-baseline gap-x-2 font-mono text-[0.68rem] text-muted">
                {node.runs.length > 1 && <span className="text-text">run {index + 1}</span>}
                <span className={run.status === 'failed' ? 'text-danger' : 'text-text'}>
                  {run.status}
                </span>
                {duration !== null && <span>{formatDuration(duration)}</span>}
                {cost !== null && <span>${cost.toFixed(2)}</span>}
                {tokens !== null && <span>{formatTokens(tokens)} tok</span>}
                {model && <span>{shortModel(model)}</span>}
                {run.acceptedCommit && <CommitRef sha={run.acceptedCommit} repoUrl={repoUrl} />}
              </h3>

              <ol className="mt-2 space-y-0.5">
                {runLines.map((event) => (
                  <li
                    key={event.seq}
                    className="flex gap-3 font-mono text-[0.68rem] leading-5 text-muted"
                  >
                    <span className="shrink-0 text-muted/70">
                      {formatTimestamp(event.createdAt)}
                    </span>
                    <span className="min-w-0 break-words">
                      {event.type === 'stage.activity'
                        ? stageActivityLabel(event)
                        : eventTitle(event)}
                    </span>
                  </li>
                ))}
                {runLines.length === 0 && (
                  <li className="font-mono text-[0.68rem] text-muted">
                    No activity was reported for this run.
                  </li>
                )}
              </ol>
            </article>
          )
        })}

        <button
          type="button"
          onClick={onComment}
          className="font-mono text-[0.68rem] text-muted underline-offset-4 hover:text-phosphor hover:underline"
        >
          💬 Comment on this run
        </button>
      </div>
    </section>
  )
}
