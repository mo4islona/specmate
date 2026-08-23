import { useState } from 'react'
import { formatClock } from '../lib/format.ts'
import type { FeedAuthor, FeedEntry } from '../lib/task-thread.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

const AUTHOR_TONE: Record<FeedAuthor, string> = {
  owner: 'text-phosphor',
  guide: 'text-cyan',
  task: 'text-muted',
}

interface ThreadViewProps {
  readonly entries: readonly FeedEntry[]
  /** Opens the run log of the node a line came from. */
  readonly onOpenNode: (nodeKey: string) => void
}

/**
 * The conversation, and only the conversation (REQ-919). Five to fifteen lines
 * over a whole task, which is why there is no windowing here and no empty
 * state: a task ten seconds old has one line, and one line is the right amount
 * of screen for what is known about it.
 */
export function ThreadView({ entries, onOpenNode }: ThreadViewProps) {
  return (
    <ol aria-label="Task thread" className="divide-y divide-border/60">
      {entries.map((entry) => (
        <FeedLine key={entry.id} entry={entry} onOpenNode={onOpenNode} />
      ))}
    </ol>
  )
}

function FeedLine({
  entry,
  onOpenNode,
}: {
  entry: FeedEntry
  onOpenNode: (nodeKey: string) => void
}) {
  // A resolved question is two lines until asked otherwise: history must not
  // shout over the thing that still needs an answer.
  const clamps = entry.decisionId !== null
  const [expanded, setExpanded] = useState(false)
  const clamped = clamps && !expanded

  return (
    <li className="py-2.5" data-feed-kind={entry.author}>
      <div className="flex items-baseline gap-2">
        <time className="shrink-0 font-mono text-[0.62rem] text-muted" dateTime={String(entry.at)}>
          {formatClock(entry.at)}
        </time>
        <span className={`micro-label ${AUTHOR_TONE[entry.author]}`}>{entry.label}</span>
        <span className="font-mono text-[0.62rem] text-muted">{entry.verb}</span>

        {entry.nodeKey && (
          <button
            type="button"
            onClick={() => entry.nodeKey && onOpenNode(entry.nodeKey)}
            className="ml-auto shrink-0 font-mono text-[0.62rem] text-muted underline-offset-4 hover:text-phosphor hover:underline"
          >
            run log →
          </button>
        )}
      </div>

      {entry.body && (
        <div
          className={`artifact-document mt-1 text-sm ${clamped ? 'line-clamp-2 text-muted' : ''}`}
        >
          <ArtifactMarkdown content={entry.body} />
        </div>
      )}

      {clamps && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 font-mono text-[0.62rem] text-muted underline-offset-4 hover:text-phosphor hover:underline"
        >
          {expanded ? 'clamp it back' : 'read the whole thing →'}
        </button>
      )}
    </li>
  )
}
