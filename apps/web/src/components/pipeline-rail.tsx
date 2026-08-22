import type { ModelBinding } from '@specmate/core'
import {
  isBaselineBinding,
  type NodeState,
  type PipelineNodeView,
  shortModel,
} from '../lib/task-pipeline.ts'
import { formatDuration, formatTokens, stageDuration, stageTokens } from '../lib/task-thread.ts'
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
  failed: 'bg-danger',
  stopped: 'bg-amber/50',
  pending: 'border border-border-bright bg-ground',
}

const STATE_LABELS: Record<NodeState, string> = {
  done: '',
  running: 'running',
  awaiting: 'you',
  failed: 'failed',
  stopped: 'stopped',
  pending: '',
}

const STATE_TEXT: Record<NodeState, string> = {
  done: 'text-muted',
  running: 'text-phosphor',
  awaiting: 'text-amber',
  failed: 'text-danger',
  stopped: 'text-amber',
  pending: 'text-muted',
}

/** Done stages trade their status word for the one number the owner asks of them: how long it took. */
function trailingLabel(node: PipelineNodeView): string {
  if (node.state === 'done' && node.latest) {
    const duration = stageDuration(node.latest)

    return duration === null ? '' : formatDuration(duration)
  }

  return STATE_LABELS[node.state]
}

export function PipelineRail({
  nodes,
  baseline,
  repoUrl,
  selectedKey,
  onSelect,
}: PipelineRailProps) {
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
        {nodes.map((node, index) => {
          const selected = selectedKey === node.key
          const trailing = trailingLabel(node)

          return (
            <li key={node.key} className="relative pl-5">
              {index < nodes.length - 1 && (
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

              {selected && <NodeDetail node={node} baseline={baseline} repoUrl={repoUrl} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function NodeDetail({
  node,
  baseline,
  repoUrl,
}: {
  node: PipelineNodeView
  baseline: ModelBinding | null
  repoUrl: string
}) {
  const overridden = !isBaselineBinding(node.binding, baseline)
  const numbered = node.runs.length > 1

  return (
    <div className="mb-2 ml-0 space-y-1.5 pb-1 text-[0.7rem] leading-5">
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

      {node.runs.map((run, index) => {
        const duration = stageDuration(run)
        const tokens = stageTokens(run)
        const cost = run.telemetry?.costUsd ?? null

        return (
          <p key={run.id} className="flex flex-wrap items-baseline gap-x-2 font-mono text-muted">
            {numbered && <span className="text-text">run {index + 1}</span>}
            <span>{run.status}</span>
            {duration !== null && <span>{formatDuration(duration)}</span>}
            {tokens !== null && <span>{formatTokens(tokens)} tok</span>}
            {cost !== null && <span>${cost.toFixed(2)}</span>}
            {run.acceptedCommit && <CommitRef sha={run.acceptedCommit} repoUrl={repoUrl} />}
          </p>
        )
      })}

      {node.runs.length === 0 && node.kind === 'stage' && (
        <p className="font-mono text-muted">not started</p>
      )}
    </div>
  )
}
