import type { ModelBinding } from '@specmate/core'
import type { ReactNode } from 'react'
import { useNow } from '../hooks/use-now.ts'
import { shortCommit } from '../lib/repo-link.ts'
import {
  isBaselineBinding,
  type NodeState,
  type PipelineNodeView,
  shortModel,
} from '../lib/task-pipeline.ts'
import { formatDuration, stageDuration } from '../lib/task-thread.ts'

/** What the node the task stands on is doing, and the one verb it offers. */
export interface RailSub {
  readonly nodeKey: string
  readonly detail: string | null
  readonly tone?: 'muted' | 'danger'
  readonly action?: ReactNode
}

interface PipelineRailProps {
  readonly nodes: readonly PipelineNodeView[]
  readonly baseline: ModelBinding | null
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly sub?: RailSub | null
}

const DOT_CLASSES: Record<NodeState, string> = {
  done: 'bg-border-bright',
  running: 'bg-phosphor dot-live',
  awaiting: 'bg-amber dot-live',
  stopped: 'bg-danger',
  pending: 'border border-border-bright bg-ground',
}

const NAME_CLASSES: Record<NodeState, string> = {
  done: 'text-text',
  running: 'font-medium text-phosphor',
  awaiting: 'font-medium text-amber',
  stopped: 'font-medium text-danger',
  pending: 'text-muted',
}

export function PipelineRail({
  nodes,
  baseline,
  selectedKey,
  onSelect,
  sub = null,
}: PipelineRailProps) {
  const now = useNow()
  // Everything up to the last node that has something to say is drawn; the
  // unstarted tail is one line naming how many there are. Ten empty circles
  // were taking a column to report that nothing had happened in them.
  const lastTold = nodes.reduce(
    (last, node, index) => (node.state === 'pending' ? last : index),
    -1,
  )
  const told = nodes.slice(0, lastTold + 1)
  const folded = nodes.slice(lastTold + 1)

  return (
    <section aria-label="Pinned pipeline">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="micro-label text-muted">Pipeline</h2>
        {baseline && (
          <p
            className="font-mono text-[0.59rem] text-muted"
            title="Model bound to every role that is not overridden"
          >
            {shortModel(baseline.model)} · {baseline.reasoningEffort}
          </p>
        )}
      </div>

      <ol className="mt-3">
        {told.map((node) => {
          const selected = selectedKey === node.key
          const overridden = !isBaselineBinding(node.binding, baseline)

          return (
            <li key={node.key}>
              <button
                type="button"
                onClick={() => onSelect(node.key)}
                aria-pressed={selected}
                className={`grid w-full grid-cols-[0.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1 text-left text-[0.79rem] transition-colors ${
                  selected ? 'bg-phosphor/[0.07] px-2 -mx-2' : ''
                }`}
              >
                <span
                  className={`mt-[0.3rem] h-[0.45rem] w-[0.45rem] rounded-full ${DOT_CLASSES[node.state]}`}
                  aria-hidden="true"
                />

                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className={`truncate ${NAME_CLASSES[node.state]}`}>{node.label}</span>
                  {overridden && node.binding && (
                    <span className="shrink-0 border border-amber/40 px-1 font-mono text-[0.56rem] text-amber">
                      {shortModel(node.binding.model)} · {node.binding.reasoningEffort}
                    </span>
                  )}
                </span>

                <NodeFact node={node} now={now} />
              </button>

              {sub?.nodeKey === node.key && (
                <div className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 pb-1.5">
                  <span aria-hidden="true" />
                  <div className="min-w-0">
                    {sub.detail && (
                      <p
                        className={`mt-0.5 break-words font-mono text-[0.62rem] leading-5 ${
                          sub.tone === 'danger' ? 'text-danger' : 'text-muted'
                        }`}
                        role="status"
                      >
                        {sub.detail}
                      </p>
                    )}
                    {sub.action}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {folded.length > 0 && (
        <p className="mt-1 grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 border-t border-border pt-1.5 text-[0.75rem] leading-5 text-muted">
          <span className="font-mono" aria-hidden="true">
            →
          </span>
          <span>{foldedLabel(folded)}</span>
        </p>
      )}
    </section>
  )
}

/** The unstarted tail, named as far as it is worth naming and counted after that. */
function foldedLabel(folded: readonly PipelineNodeView[]): string {
  const named = folded
    .slice(0, 3)
    .map((node) => node.label)
    .join(', ')

  return folded.length > 3 ? `${named}, +${folded.length - 3} more` : named
}

/**
 * A finished node trades its status word for the facts the owner asks of it; a
 * stopped node states the reason in the same slot, because a node that quietly
 * reverts to looking unstarted is the mush this pass removes.
 */
function NodeFact({ node, now }: { node: PipelineNodeView; now: number }) {
  const classes = `shrink-0 text-right font-mono text-[0.61rem] ${
    node.state === 'stopped' ? 'text-danger' : 'text-muted'
  }`

  if (node.state === 'stopped') {
    return <span className={classes}>{node.stoppedReason ?? 'stopped'}</span>
  }
  if (node.state === 'awaiting') {
    return <span className={classes}>waiting on you</span>
  }
  if (node.state === 'running') {
    const started = node.latest?.startedAt ? new Date(node.latest.startedAt).getTime() : null

    return (
      <span className={classes}>
        {started === null ? 'running' : formatDuration(now - started)}
        {node.runs.length > 1 && ` · attempt ${node.runs.length}`}
      </span>
    )
  }
  if (node.state !== 'done') {
    return <span className={classes} />
  }

  const duration = node.latest ? stageDuration(node.latest) : null
  const commit = node.latest?.acceptedCommit
  const cost = node.latest?.telemetry?.costUsd ?? null

  if (!duration && !commit) {
    return <span className={classes}>{node.kind === 'gate' ? 'passed' : ''}</span>
  }

  // The hash reads here and is *linked* in the run log: an anchor inside the
  // row's button would be both invalid markup and a second click target.
  return (
    <span className={classes} title={commit ?? undefined}>
      {duration !== null && formatDuration(duration)}
      {commit
        ? `${duration !== null ? ' · ' : ''}${shortCommit(commit)}`
        : cost !== null && ` · $${cost.toFixed(2)}`}
    </span>
  )
}
