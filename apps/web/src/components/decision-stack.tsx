import { useState } from 'react'
import type { DecisionItem } from '../lib/api-client.ts'
import { nodeLabel } from '../lib/task-thread.ts'
import { DecisionCard, type DecisionCardProps } from './decision-card.tsx'

type CardHandlers = Pick<
  DecisionCardProps,
  'onAnswerOption' | 'onAnswerText' | 'onDismiss' | 'onDiscuss'
>

interface DecisionStackProps {
  readonly decisions: readonly DecisionItem[]
  readonly label: string
  /** Passed through: the expanded card's answer is typed in the console, not in the card. */
  readonly answerInConsole?: boolean
  readonly parked: boolean
  readonly busy: (decisionId: string) => boolean
  readonly error: (decisionId: string) => string | undefined
  readonly handlers: (decision: DecisionItem) => CardHandlers
}

/**
 * Several questions at once is the normal case at a kickoff gate, and three
 * full cards is more screen than any of them deserves. One is open — the one
 * the owner is answering — and the rest wait as their own first line.
 */
export function DecisionStack({
  decisions,
  label,
  answerInConsole = false,
  parked,
  busy,
  error,
  handlers,
}: DecisionStackProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const expandedId = openId ?? decisions[0]?.id

  if (decisions.length === 0) return null

  return (
    <ol className="space-y-2" aria-label={label}>
      {decisions.map((decision) => {
        if (decision.id === expandedId) {
          return (
            <DecisionCard
              key={decision.id}
              decision={decision}
              parkedOnThis={decision.blocking && parked}
              answerInConsole={answerInConsole}
              busy={busy(decision.id)}
              error={error(decision.id)}
              {...handlers(decision)}
            />
          )
        }

        return (
          <li key={decision.id}>
            <button
              type="button"
              onClick={() => setOpenId(decision.id)}
              className="flex w-full items-baseline gap-3 border border-l-2 border-amber/25 border-l-amber/60 px-4 py-2.5 text-left transition-colors hover:border-amber/45"
            >
              <span className="micro-label shrink-0 text-amber/80">
                {nodeLabel(decision.nodeKey)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted">
                {firstLine(decision.promptMd)}
              </span>
              <span className="shrink-0 font-mono text-[0.62rem] text-muted">open</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** The question, not the markdown around it — this row has one line to say what is being asked. */
function firstLine(promptMd: string): string {
  const line = promptMd
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0)

  return (line ?? '').replaceAll('**', '').replaceAll('`', '')
}
