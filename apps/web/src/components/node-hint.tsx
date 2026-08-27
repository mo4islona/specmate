import type { ReactNode } from 'react'
import { nodeSpend, type PipelineNodeView, shortModel } from '../lib/task-pipeline.ts'
import { formatDuration, formatTokens, tokenSplit } from '../lib/task-thread.ts'
import { NODE_HELP } from './node-help.ts'
import { NODE_MARK, nodeName } from './tone.ts'

interface NodeHintProps {
  readonly node: PipelineNodeView
  readonly now: number
}

interface Fact {
  readonly key: string
  readonly value: ReactNode
}

/**
 * What the rail's one row has no width for: what the step is for, and what it
 * has eaten. A row holds a name and a single number, so everything else a
 * person asks of a pipeline — which model ran it, how many attempts it took,
 * what those attempts cost in tokens and in dollars — waits here until the
 * pointer rests on it.
 *
 * Only facts that exist are drawn. A node that has not run has nothing but its
 * purpose to offer, and a column of `—` where the numbers would go is a worse
 * answer than no column.
 */
export function NodeHint({ node, now }: NodeHintProps): ReactNode {
  const help = NODE_HELP[node.key] ?? null
  const spend = nodeSpend(node, now)
  const split = spend.tokens ? tokenSplit(spend.tokens) : []
  const model = spend.model ? shortModel(spend.model) : null
  const effort = node.binding?.reasoningEffort ?? null
  const ran = [
    spend.attempts > 1 ? `${spend.attempts} attempts` : null,
    spend.durationMs === null ? null : formatDuration(spend.durationMs),
  ].filter((part): part is string => part !== null)

  const facts: Fact[] = []
  if (model) facts.push({ key: 'model', value: effort ? `${model} · ${effort}` : model })
  if (ran.length > 0) facts.push({ key: 'ran', value: ran.join(' · ') })
  if (spend.tokenTotal !== null) {
    facts.push({
      key: 'tokens',
      value: (
        <>
          {formatTokens(spend.tokenTotal)}
          {/* Against a budget, a cache read and a fresh input token are not the
              same money — the total alone hides which kind was spent. */}
          {split.length > 1 && (
            <span className="mt-0.5 block text-muted-foreground">
              {split.map((part) => `${part.label} ${formatTokens(part.value)}`).join(' · ')}
            </span>
          )}
        </>
      ),
    })
  }
  if (spend.costUsd !== null) facts.push({ key: 'cost', value: `$${spend.costUsd.toFixed(2)}` })

  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[0.8rem] font-medium text-foreground">{node.label}</span>
        <span className={`shrink-0 font-mono text-[0.62rem] ${nodeName(node.state)}`}>
          {NODE_MARK[node.state].label}
        </span>
      </span>

      {/* A reason is a sentence — "the specification declares 0 scenario(s)…" —
          and beside the name it wrapped the name into two lines and then ran off
          the hint's own edge. It reads under the name, where a sentence goes. */}
      {node.reason && (
        <span
          className={`mt-1 block font-mono text-[0.62rem] leading-[1.5] ${nodeName(node.state)}`}
        >
          {node.reason}
        </span>
      )}

      {help && <span className="mt-2 block text-muted-foreground">{help}</span>}

      {facts.length > 0 && (
        <span className="mt-2.5 grid grid-cols-[3.2rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border pt-2.5 font-mono text-[0.65rem] leading-[1.55]">
          {facts.map((fact) => (
            <span key={fact.key} className="contents">
              <span className="text-muted-foreground">{fact.key}</span>
              <span className="min-w-0 break-words text-foreground">{fact.value}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
