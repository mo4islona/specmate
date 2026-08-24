import { useNow } from '../hooks/use-now.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { nodeSpend } from '../lib/task-pipeline.ts'
import { formatDuration } from '../lib/task-thread.ts'
import { Button, cx, Dot, HoverHint } from '../ui/index.ts'
import { CommitRef } from './commit-ref.tsx'
import { InfoIcon } from './icons.tsx'
import { NodeHint } from './node-hint.tsx'
import { NODE_DOT, NODE_NAME } from './node-tone.ts'

interface StepHeaderProps {
  readonly node: PipelineNodeView
  readonly repoUrl: string
  /**
   * True while this is the step the task itself stands on — the one the page
   * header's sentence is already about.
   */
  readonly current: boolean
  /** What the step is doing that its facts do not say — a stop being cleaned up. */
  readonly notice?: { readonly text: string; readonly tone: 'muted' | 'danger' } | null
}

/** The state in the slot the duration would take, in the node's own words. */
function stateFact(node: PipelineNodeView, duration: number | null): string {
  if (node.state === 'running') {
    return duration === null ? 'running' : `running ${formatDuration(duration)}`
  }
  if (node.state === 'awaiting') return 'waiting on you'
  if (node.state === 'stopped') return node.reason ?? 'stopped'
  if (node.state === 'skipped') return `skipped · ${node.reason ?? 'skipped'}`
  if (node.state === 'pending') return 'has not run yet'

  return duration === null ? (node.kind === 'gate' ? 'passed' : 'done') : formatDuration(duration)
}

/**
 * Which step the thread below is reading, and what it cost — the two numbers a
 * person actually checks, on the right where a number belongs, with the name
 * holding the left edge.
 *
 * Everything else the step knows — the model, the effort, the token split, the
 * attempts — is behind the mark at the end of the row. Set inline, those seven
 * facts made a run of grey `·`-separated text that had to be read word by word
 * to find the one being looked for, and it said the same things the rail's own
 * hint says. One hint, two places to ask for it.
 *
 * The step's *state* is left out whenever the page header two rows above is
 * already a sentence about this same step. A step the owner went back to is
 * another matter: the header is about the task, this is about the step.
 */
export function StepHeader({ node, repoUrl, current, notice = null }: StepHeaderProps) {
  const now = useNow()
  const spend = nodeSpend(node, now)
  const facts = [
    current ? null : stateFact(node, spend.durationMs),
    current && spend.durationMs !== null ? formatDuration(spend.durationMs) : null,
    spend.costUsd === null ? null : `$${spend.costUsd.toFixed(2)}`,
  ].filter((fact): fact is string => fact !== null)

  // A bar rather than a rule: the line under it was the thread's ceiling, and a
  // surface says the same thing without drawing anything.
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-elevated/55 py-2 pl-4 pr-2">
      <h2 className="flex min-w-0 items-center gap-2">
        <Dot className={NODE_DOT[node.state]} />
        <span className={cx('truncate text-[0.95rem]', NODE_NAME[node.state])}>{node.label}</span>
      </h2>

      {notice && (
        <p
          className={cx(
            'min-w-0 font-mono text-[0.66rem]',
            notice.tone === 'danger' ? 'text-danger' : 'text-muted',
          )}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <p className="ml-auto flex min-w-0 items-center gap-x-2 font-mono text-[0.66rem] text-muted">
        {facts.map((fact, index) => (
          <span key={fact}>
            {index > 0 && <span className="pr-2 text-border-bright">·</span>}
            {fact}
          </span>
        ))}
        {node.latest?.acceptedCommit && (
          <CommitRef sha={node.latest.acceptedCommit} repoUrl={repoUrl} className="text-info" />
        )}
      </p>

      <HoverHint hint={<NodeHint node={node} now={now} />} delayMs={120}>
        <Button
          variant="ghost"
          className="min-h-0 px-1.5 py-1.5"
          aria-label={`What ${node.label} ran on, and what it spent`}
        >
          <InfoIcon className="h-3.5 w-3.5" />
        </Button>
      </HoverHint>
    </header>
  )
}
