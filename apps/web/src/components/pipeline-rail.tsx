import type { ReactNode } from 'react'
import { useNow } from '../hooks/use-now.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { formatDuration, stageDuration } from '../lib/task-thread.ts'
import { AGENT_LABELS, AgentAvatar, cn, HoverHint, Icon, MicroLabel } from '../ui/index.ts'
import { NodeHint } from './node-hint.tsx'
import { NODE_MARK, nodeAhead, nodeLit, nodeMarkClass, nodeName, signalText } from './tone.ts'

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
 * What each row does carry, in the column that used to hold a tick or a cross,
 * is a face: which CLI is on this step, or the person a gate waits on. The tick
 * was the state said a third time — the name is already coloured by it and the
 * fact at the end of the row spells it — and *who* was nowhere on the screen.
 *
 * How far the run got is what the light is for: a step that landed wears its
 * vendor's colour, everything ahead of it is grey, and that is the shape of the
 * rail read from across the room. Whether one particular step finished is a
 * different question and belongs in a different column — see `NodeFact`.
 *
 * Nodes that have not run stay on the list rather than folding into a count. A
 * pipeline the owner cannot see the end of is not a pipeline, and "+4 more" is
 * a worse answer to "what happens next" than four dim rows. They are not
 * *reachable*, though: a node with no runs has no step to read, and offering to
 * open one is offering an empty room.
 *
 * A node the graph skipped is the exception, and it is the one place this rail
 * departs from AC-422: it is off the list entirely. The reason a skip carries is
 * a sentence — "the specification declares 2 scenario(s), under the 4 this node
 * is worth" — and a sentence in a column this narrow wrapped to two lines and
 * pushed the rest of the walk down the page to explain a step that never ran.
 * The node is still on the graph and still in `buildPipelineNodes`; the step's
 * own header is where its skip is read.
 */
export function PipelineRail({ nodes, selectedKey, onSelect }: PipelineRailProps) {
  const walk = nodes.filter((node) => node.state !== 'skipped')
  const now = useNow(walk.some((node) => node.state === 'running'))

  return (
    <section aria-label="Pinned pipeline">
      <MicroLabel as="h2">Pipeline</MicroLabel>

      <ol className="mt-3">
        {walk.map((node) => {
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
                  <span className={cn(box, 'cursor-default')}>{row}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(node.key)}
                    aria-pressed={selectedKey === node.key}
                    // Selection is where the owner is, not how the node is
                    // going: a green wash under a failed node claimed a state
                    // the mark beside it contradicts.
                    className={cn(
                      box,
                      selectedKey === node.key
                        ? 'bg-foreground/[0.09]'
                        : 'hover:bg-foreground/[0.05]',
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
  // The face draws who; the word is what a screen reader gets instead, and it
  // has to carry both — the state is nowhere in this cell any more.
  const said = `${AGENT_LABELS[node.agent]} · ${mark.label}`

  return (
    <span className={cn('block text-[0.79rem]', nodeAhead(node.state))}>
      <span className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
        {/* Centred on the row rather than sat on its baseline. The row aligns by
            baseline because a name and a duration have to share one, but a box
            holding an SVG has no text baseline for the browser to use — it falls
            back to the bottom edge, which hangs the mark above the word it
            belongs to. `self-center` opts this one cell out of that. */}
        <span
          className={cn('flex items-center justify-center self-center', nodeMarkClass(node.state))}
          title={said}
        >
          <AgentAvatar name={node.agent} lit={nodeLit(node.state)} />
          <span className="sr-only">{said}</span>
        </span>

        <span className={cn('min-w-0 truncate', nodeName(node.state))}>{node.label}</span>

        <NodeFact node={node} now={now} />
      </span>
    </span>
  )
}

/**
 * What the step cost, and — where it cost nothing anyone is billed for — that it
 * is behind the run at all.
 *
 * A duration already says a step finished, so most rows need no mark. A gate has
 * no duration to state: nobody is charged for the minutes an owner took to
 * answer one, and a run of gates with an empty right-hand column read as steps
 * still to come. Those get the tick instead, in the same slot and the same grey
 * as the numbers above and below it — the outcome belongs in the column of
 * outcomes, not badged onto a face, and a green one down a finished pipeline was
 * a row of lights nobody was meant to act on.
 *
 * A stop is the one outcome that has to be found rather than read, so it keeps
 * its mark whether or not it also has a reason to state.
 */
function NodeFact({ node, now }: { node: PipelineNodeView; now: number }) {
  const classes = cn(
    'flex shrink-0 items-center justify-end gap-1.5 font-mono text-[0.61rem]',
    node.state === 'stopped' ? signalText('stopped') : 'text-muted-foreground',
  )

  if (node.state === 'stopped') {
    // `failed 3 times` and `cleanup failed` are news; a bare `stopped` is the mark again.
    const reason = node.reason === 'stopped' ? null : node.reason

    return (
      <span className={classes}>
        {reason}
        <Icon name="close" size="2xs" />
      </span>
    )
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

  return (
    <span className={classes}>
      {duration === null ? <Icon name="check" size="2xs" /> : formatDuration(duration)}
    </span>
  )
}
