import { useState } from 'react'
import { formatClock, formatTimestamp } from '../lib/format.ts'
import type { FeedAuthor, FeedEntry } from '../lib/task-thread.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

const AUTHOR_TONE: Record<Exclude<FeedAuthor, 'owner'>, string> = {
  guide: 'text-cyan',
  task: 'text-muted',
}

/**
 * What a bubble from you would only repeat. Every other verb — answered,
 * approved, redirected, raised the budget — changes what the entry means and
 * keeps its line.
 */
const IMPLIED_OWNER_VERB = 'commented'

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
 *
 * Read as a chat. What you said is a balloon on your side — the one rounded,
 * filled thing in an interface of hairlines and square corners, because it is
 * the one place a person speaks. What the machine said is left where it is,
 * under the name of the node that said it: a box around it would put the two
 * on equal footing, and they are not.
 */
export function ThreadView({ entries, onOpenNode }: ThreadViewProps) {
  return (
    <ol aria-label="Task thread" className="space-y-3">
      {entries.map((entry) => (
        <FeedLine key={entry.id} entry={entry} onOpenNode={onOpenNode} />
      ))}
    </ol>
  )
}

/** Two lines of this column, near enough — the clamp itself does the exact work. */
function isLong(body: string | null): boolean {
  return body !== null && (body.length > 160 || body.includes('\n'))
}

function FeedLine({
  entry,
  onOpenNode,
}: {
  entry: FeedEntry
  onOpenNode: (nodeKey: string) => void
}) {
  // A resolved question is two lines until asked otherwise: history must not
  // shout over the thing that still needs an answer. An exchange that already
  // fits gets no control, since there is nothing behind it to open.
  const clamps = entry.decisionId !== null && isLong(entry.body)
  const [expanded, setExpanded] = useState(false)
  const clamped = clamps && !expanded
  const mine = entry.author === 'owner'
  // Nothing was said: this is a marker on the timeline, not a turn. It reads in
  // the neutral voice and it is the one place a clock earns its space, because
  // a marker's whole job is to say when.
  const said = Boolean(entry.body)
  const balloon = mine && said
  const verb = balloon && entry.verb === IMPLIED_OWNER_VERB ? null : entry.verb
  // A marker is nothing but its line. A balloon drops the line entirely when
  // there is no name, no verb and no run to open behind it.
  const carriesSomething = verb !== null || entry.author !== 'owner' || entry.nodeKey !== null
  const showsLine = !said || carriesSomething

  return (
    <li className="flex" data-feed-kind={entry.author} title={formatTimestamp(entry.at)}>
      <div
        className={`flex min-w-0 max-w-[42rem] flex-col gap-1 ${
          mine ? 'ml-auto items-end' : 'mr-auto items-start'
        }`}
      >
        {said && (
          <time className="sr-only" dateTime={String(entry.at)}>
            {formatTimestamp(entry.at)}
          </time>
        )}

        {showsLine && (
          <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[0.62rem] text-muted">
            {/* Your own side needs no name; a node's name is the only identity
                the machine has, so it keeps one. */}
            {entry.author !== 'owner' && (
              <span className={`uppercase tracking-[0.06em] ${AUTHOR_TONE[entry.author]}`}>
                {entry.label}
              </span>
            )}

            {said ? (
              verb && <span>{verb}</span>
            ) : (
              <>
                <span>{entry.title}</span>
                <time dateTime={String(entry.at)} className="text-muted/70">
                  {formatClock(entry.at)}
                </time>
              </>
            )}

            {entry.nodeKey && (
              <button
                type="button"
                onClick={() => entry.nodeKey && onOpenNode(entry.nodeKey)}
                className="border-b border-cyan/35 text-cyan hover:border-cyan"
              >
                run log
              </button>
            )}
          </p>
        )}

        {entry.body && (
          <div
            data-balloon={balloon ? '' : undefined}
            className={`min-w-0 ${balloon ? 'rounded-[1.25rem] bg-elevated px-4 py-2.5' : ''}`}
          >
            <div
              className={`artifact-document text-[0.85rem] ${clamped ? 'line-clamp-2 text-muted' : ''}`}
            >
              <ArtifactMarkdown content={entry.body} />
            </div>

            {clamps && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="mt-1 font-mono text-[0.62rem] text-cyan hover:underline"
              >
                {expanded ? 'clamp it back' : 'read the whole thing →'}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
