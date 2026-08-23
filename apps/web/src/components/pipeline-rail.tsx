import type { ModelBinding } from '@specmate/core'
import {
  isBaselineBinding,
  type NodeState,
  type PipelineNodeView,
  shortModel,
} from '../lib/task-pipeline.ts'
import { formatDuration, stageDuration } from '../lib/task-thread.ts'
import { CommitRef } from './commit-ref.tsx'

interface PipelineRailProps {
  readonly nodes: readonly PipelineNodeView[]
  readonly baseline: ModelBinding | null
  readonly repoUrl: string
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
}

const DOT_CLASSES: Record<NodeState, string> = {
  done: 'bg-phosphor/40',
  running: 'bg-phosphor dot-live',
  awaiting: 'bg-amber dot-live',
  stopped: 'bg-danger',
  pending: 'border border-border-bright bg-ground',
}

const STATE_TEXT: Record<NodeState, string> = {
  done: 'text-muted',
  running: 'text-phosphor',
  awaiting: 'text-amber',
  stopped: 'text-danger',
  pending: 'text-muted',
}

/**
 * A finished node trades its status word for the one number the owner asks of
 * it; a stopped node states the reason in the same slot, because a node that
 * quietly reverts to looking unstarted is the mush this pass removes.
 */
function trailingLabel(node: PipelineNodeView): string {
  if (node.state === 'stopped') return node.stoppedReason ?? 'stopped'
  if (node.state === 'running') return 'running'
  if (node.state === 'awaiting') return 'waiting on you'

  if (node.state === 'done' && node.latest) {
    const duration = stageDuration(node.latest)

    return duration === null ? '' : formatDuration(duration)
  }

  return ''
}

export function PipelineRail({
  nodes,
  baseline,
  repoUrl,
  selectedKey,
  onSelect,
}: PipelineRailProps) {
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
            className="font-mono text-[0.62rem] text-muted"
            title="Model bound to every role that is not overridden"
          >
            {shortModel(baseline.model)} · {baseline.reasoningEffort}
          </p>
        )}
      </div>

      <ol className="mt-3">
        {told.map((node, index) => {
          const selected = selectedKey === node.key
          const trailing = trailingLabel(node)

          return (
            <li key={node.key} className="relative pl-5">
              {index < told.length - 1 && (
                <span
                  className="absolute left-[5px] top-3 h-full w-px bg-border"
                  aria-hidden="true"
                />
              )}
              <span
                className={`absolute left-0.5 top-[0.55rem] h-2 w-2 rounded-full ${DOT_CLASSES[node.state]}`}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => onSelect(node.key)}
                aria-pressed={selected}
                className={`flex w-full items-baseline gap-2 py-1 text-left transition-colors ${
                  selected ? 'text-text' : 'text-muted hover:text-text'
                }`}
              >
                <span
                  className={`min-w-0 flex-1 truncate text-[0.82rem] ${
                    node.current ? 'font-medium text-text' : ''
                  }`}
                >
                  {node.label}
                </span>
                {node.runs.length > 1 && (
                  <span className="shrink-0 font-mono text-[0.6rem] text-amber">
                    ×{node.runs.length}
                  </span>
                )}
                {trailing && (
                  <span className={`shrink-0 font-mono text-[0.62rem] ${STATE_TEXT[node.state]}`}>
                    {trailing}
                  </span>
                )}
              </button>

              {selected && <NodeFacts node={node} baseline={baseline} repoUrl={repoUrl} />}
            </li>
          )
        })}
      </ol>

      {folded.length > 0 && (
        <p className="mt-1 pl-5 font-mono text-[0.66rem] leading-5 text-muted">
          →{' '}
          {folded
            .slice(0, 3)
            .map((node) => node.label)
            .join(', ')}
          {folded.length > 3 && `, +${folded.length - 3} more`}
        </p>
      )}
    </section>
  )
}

/** The one fact the rail keeps inline: which role, and the binding where it departs from the baseline. */
function NodeFacts({
  node,
  baseline,
  repoUrl,
}: {
  node: PipelineNodeView
  baseline: ModelBinding | null
  repoUrl: string
}) {
  const overridden = !isBaselineBinding(node.binding, baseline)
  const commit = node.latest?.acceptedCommit

  return (
    <div className="mb-2 space-y-1 pb-1 text-[0.7rem] leading-5">
      {node.role && (
        <p className="font-mono text-muted">
          {node.role}
          {overridden && node.binding && (
            <span className="ml-1.5 border border-amber/40 px-1 py-0.5 text-[0.6rem] text-amber">
              {shortModel(node.binding.model)} · {node.binding.reasoningEffort}
            </span>
          )}
        </p>
      )}
      {commit && (
        <p className="font-mono text-muted">
          <CommitRef sha={commit} repoUrl={repoUrl} />
        </p>
      )}
    </div>
  )
}
