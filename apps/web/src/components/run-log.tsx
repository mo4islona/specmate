import type { TimelineEvent } from '../lib/api-client.ts'
import { formatRunClock } from '../lib/format.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { shortModel } from '../lib/task-pipeline.ts'
import {
  eventTitle,
  formatDuration,
  formatTokens,
  payloadValue,
  stageActivityParts,
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

const OUTCOME_EVENTS: ReadonlySet<string> = new Set([
  'stage.dispatched',
  'stage.completed',
  'stage.interrupted',
  'stage.restart_confirmed',
])

const TROUBLE_EVENTS: ReadonlySet<string> = new Set([
  'stage.failed',
  'stage.cleanup_failed',
  'stage.stopping',
])

/** Which column carries the colour: the run's own boundaries, its questions, its trouble. */
function lineTone(event: TimelineEvent): string {
  if (TROUBLE_EVENTS.has(event.type)) return 'text-danger'
  if (event.type === 'decision.raised') return 'text-amber'
  if (OUTCOME_EVENTS.has(event.type)) return 'text-phosphor'

  return 'text-muted'
}

function lineParts(event: TimelineEvent): { kind: string; target: string } {
  if (event.type === 'stage.activity') return stageActivityParts(event)

  const target =
    payloadValue(event, 'commit') ??
    payloadValue(event, 'title') ??
    payloadValue(event, 'reason') ??
    payloadValue(event, 'detail') ??
    ''

  return { kind: eventTitle(event), target }
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
  const latest = node.runs.at(-1) ?? null
  const duration = latest ? stageDuration(latest) : null
  const tokens = latest ? stageTokens(latest) : null
  const cost = latest?.telemetry?.costUsd ?? null
  const model = latest?.telemetry?.model ?? node.binding?.model ?? null
  const facts = [
    duration === null ? null : formatDuration(duration),
    cost === null ? null : `$${cost.toFixed(2)}`,
    tokens === null ? null : `${formatTokens(tokens)} tokens`,
    model ? shortModel(model) : null,
    node.role,
  ].filter((fact): fact is string => fact !== null)

  // `mt-auto` rather than `flex-1`: sized to its content and pushed down to the
  // console, like a short thread. A log of four lines should not stretch to fill
  // the viewport.
  return (
    <section
      aria-label={`${node.label} run log`}
      className="scroll-thin mt-auto min-h-0 overflow-y-auto border border-border bg-surface"
    >
      <header className="sticky top-0 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border bg-surface px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="micro-label text-text">{node.label} · run log</h2>
          <p className="mt-1 font-mono text-[0.62rem] text-muted">
            {facts.map((fact, index) => (
              <span key={fact}>
                {index > 0 && ' · '}
                {fact}
              </span>
            ))}
            {latest?.acceptedCommit && (
              <>
                {facts.length > 0 && ' · '}
                <CommitRef sha={latest.acceptedCommit} repoUrl={repoUrl} className="text-cyan" />
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="button-ghost min-h-7 text-[0.62rem]"
          aria-label="Close the run log"
        >
          ✕ close
        </button>
      </header>

      <div className="px-3.5 py-2">
        {node.runs.length === 0 && (
          <p className="py-2 font-mono text-[0.7rem] text-muted">This node has not run yet.</p>
        )}

        {node.runs.map((run, index) => {
          const runLines = lines.filter((event) => event.stageId === run.id)

          return (
            <article key={run.id}>
              {node.runs.length > 1 && (
                <h3 className="mt-3 border-t border-border pt-2 font-mono text-[0.62rem] text-muted first:mt-0 first:border-t-0 first:pt-0">
                  <span className="text-text">run {index + 1}</span>
                  <span className={`ml-2 ${run.status === 'failed' ? 'text-danger' : ''}`}>
                    {run.status}
                  </span>
                </h3>
              )}

              <ol>
                {runLines.map((event) => {
                  const { kind, target } = lineParts(event)

                  return (
                    <li
                      key={event.seq}
                      className="grid grid-cols-[4.2rem_minmax(0,1fr)] items-baseline gap-x-3 py-[0.09rem] font-mono text-[0.68rem] leading-5 sm:grid-cols-[4.2rem_8rem_minmax(0,1fr)]"
                    >
                      <span className="text-muted/70">{formatRunClock(event.createdAt)}</span>
                      <span className={lineTone(event)}>{kind}</span>
                      <span className="col-start-2 min-w-0 break-words text-text sm:col-start-3">
                        {target}
                      </span>
                    </li>
                  )
                })}
                {runLines.length === 0 && (
                  <li className="py-1 font-mono text-[0.68rem] text-muted">
                    No activity was reported for this run.
                  </li>
                )}
              </ol>
            </article>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-2 py-1.5">
        <button type="button" onClick={onComment} className="button-ghost min-h-7 text-[0.62rem]">
          💬 Comment on this run
        </button>
        <span className="flex-1" />
        <p className="font-mono text-[0.62rem] text-muted">pinned here, not picked from a list</p>
      </div>
    </section>
  )
}
