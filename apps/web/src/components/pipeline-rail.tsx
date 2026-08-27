import type { ReactNode } from 'react'
import { useNow } from '../hooks/use-now.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { formatDuration, stageDuration } from '../lib/task-thread.ts'
import { cx, HoverHint, MicroLabel } from '../ui/index.ts'
import { NodeHint } from './node-hint.tsx'
import { NODE_MARK, nodeMarkClass, nodeName, signalText } from './tone.ts'

interface PipelineRailProps {
  readonly nodes: readonly PipelineNodeView[]
  /** The step the thread is reading. */
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
}

/**
 * The whole walk, one row per node, in the order it runs. Nothing else: a row
 * that carried the model and the spend as well had no width left for the node's
 * own name — `Planning` rendered as `Pl…` beside a model badge nobody was
 * looking for. Those facts are in the row's hint, one pointer-rest away.
 *
 * Nodes that have not run stay on the list rather than folding into a count. A
 * pipeline the owner cannot see the end of is not a pipeline, and "+4 more" is
 * a worse answer to "what happens next" than four dim rows. They are not
 * *reachable*, though: a node with no runs has no step to read, and offering to
 * open one is offering an empty room.
 */
export function PipelineRail({ nodes, selectedKey, onSelect }: PipelineRailProps) {
  const now = useNow(nodes.some((node) => node.state === 'running'))

  return (
    <section aria-label="Pinned pipeline">
      <MicroLabel as="h2">Pipeline</MicroLabel>

      <ol className="mt-3">
        {nodes.map((node) => {
          const row = <NodeRow node={node} now={now} />
          // The geometry is the same whether or not a row is selected — the
          // padding is always there and only the background changes. A row that
          // grows its own box on selection shoves the column sideways, which is
          // the shuffle a click used to set off.
          const box =
            '-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left transition-colors'

          return (
            <li key={node.key}>
              <HoverHint hint={<NodeHint node={node} now={now} />}>
                {node.state === 'pending' ? (
                  <span className={cx(box, 'cursor-default')}>{row}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(node.key)}
                    aria-pressed={selectedKey === node.key}
                    // Selection is where the owner is, not how the node is
                    // going: a green wash under a failed node claimed a state
                    // the ✕ beside it contradicts.
                    className={cx(
                      box,
                      selectedKey === node.key ? 'bg-foreground/[0.09]' : 'hover:bg-foreground/[0.05]',
                    )}
                  >
                    {row}
                  </button>
                )}
              </HoverHint>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function NodeRow({ node, now }: { node: PipelineNodeView; now: number }): ReactNode {
  const mark = NODE_MARK[node.state]
  // A skipped node keeps its place so the decision to skip it is visible rather
  // than inferred from an absence — but its reason is a sentence, not a number.
  // In the fact column it took the width the name needed and `Spec review`
  // rendered as nothing at all, so it wraps under the name, where a sentence goes.
  const skipReason = node.state === 'skipped' ? node.reason : null

  return (
    <span className="block text-[0.79rem]">
      <span className="grid grid-cols-[0.85rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
        <span
          className={cx(
            'text-center font-mono text-[0.7rem] leading-none',
            nodeMarkClass(node.state),
          )}
          title={mark.label}
        >
          {mark.glyph}
          <span className="sr-only">{mark.label}</span>
        </span>

        <span className={cx('min-w-0 truncate', nodeName(node.state))}>{node.label}</span>

        <NodeFact node={node} now={now} />
      </span>

      {skipReason !== null && (
        <span className="mt-0.5 block pl-[1.35rem] text-[0.67rem] leading-[1.45] text-muted-foreground">
          {skipReason}
        </span>
      )}
    </span>
  )
}

/**
 * What the node cost, not what it is — the mark beside its name has already
 * said that. A node whose only fact would be its own state says nothing.
 */
function NodeFact({ node, now }: { node: PipelineNodeView; now: number }) {
  const classes = cx(
    'shrink-0 text-right font-mono text-[0.61rem]',
    node.state === 'stopped' ? signalText('stopped') : 'text-muted-foreground',
  )

  if (node.state === 'stopped') {
    // `failed 3 times` and `cleanup failed` are news; a bare `stopped` is the ✕ again.
    const reason = node.reason === 'stopped' ? null : node.reason

    return <span className={classes}>{reason}</span>
  }

  if (node.state === 'running') {
    const started = node.latest?.startedAt ? new Date(node.latest.startedAt).getTime() : null

    return (
      <span className={classes}>
        {started === null ? null : formatDuration(now - started)}
        {node.runs.length > 1 && ` · attempt ${node.runs.length}`}
      </span>
    )
  }
  if (node.state !== 'done') {
    return <span className={classes} />
  }

  const duration = node.latest ? stageDuration(node.latest) : null

  return <span className={classes}>{duration === null ? null : formatDuration(duration)}</span>
}
