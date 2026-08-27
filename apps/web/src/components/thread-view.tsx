import { memo, useState } from 'react'
import { formatClock, formatTimestamp } from '../lib/format.ts'
import type {
  FeedAuthor,
  FeedEntry,
  LineEntry,
  LineTone,
  LiveActivity,
  TurnEntry,
} from '../lib/task-thread.ts'
import { cn, TextButton } from '../ui/index.ts'
import { ActivityEditBlock } from './activity-edit.tsx'
import { ArtifactMarkdown } from './artifact-markdown.tsx'
import { signalText } from './tone.ts'

const AUTHOR_TONE: Record<Exclude<FeedAuthor, 'owner'>, string> = {
  guide: 'text-muted-foreground',
  task: 'text-muted-foreground',
}

/** The bullet carries the colour; the words stay in the reading tone. */
const BULLET_TONE: Record<LineTone, string> = {
  boundary: 'text-border-strong',
  trouble: signalText('stopped'),
  plain: 'text-muted-foreground',
}

/**
 * What a bubble from you would only repeat. Every other verb — answered,
 * approved, redirected, raised the budget — changes what the entry means and
 * keeps its line.
 */
const IMPLIED_OWNER_VERB = 'commented'

interface ThreadViewProps {
  readonly entries: readonly FeedEntry[]
  /** What the run is doing at this moment, where one is under way. */
  readonly live?: LiveActivity | null
  /** Whose record this is — an edit's whole patch is read against the task. */
  readonly taskId: string
  /** Opens a file's whole diff over the surface, where the surface offers one. */
  readonly onOpenFile?: (path: string) => void
}

/**
 * One step's history, top to bottom (REQ-919): what the run changed, what it
 * asked, and what was said to it while it stood there. Two rhythms in one
 * column, on purpose — the machine's record is a dense log of time, action and
 * target, and a person's turn is a balloon on their side of it. Reading another
 * step is the rail's job, not a filter inside this list.
 *
 * The record ends where the run is now: a single line that replaces itself as
 * the run reads and searches its way to the next change (REQ-915).
 *
 * Every entry below is memoized against the one the last render drew, and every
 * one of them is skipped while it is off the screen. A record of a few hundred
 * entries is redrawn on every keystroke in the console under it and again on
 * every event a live run emits; without both of those, each of those redraws
 * re-read every patch in the step and re-tokenized every line of it.
 */
export const ThreadView = memo(function ThreadView({
  entries,
  live = null,
  taskId,
  onOpenFile,
}: ThreadViewProps) {
  return (
    <ol aria-label="Task thread">
      {entries.map((entry) =>
        entry.kind === 'line' ? (
          <RunLine key={entry.id} entry={entry} taskId={taskId} onOpenFile={onOpenFile} />
        ) : (
          <FeedTurn key={entry.id} entry={entry} />
        ),
      )}

      {live && <LiveLine live={live} />}
    </ol>
  )
})

/**
 * The one line every read collapses into. It carries no clock — it is now —
 * and leaves nothing behind: what a run looked at on the way to a change is not
 * the change. It wears a `+` rather than the record's `●` because it is not
 * part of the record yet.
 */
function LiveLine({ live }: { live: LiveActivity }) {
  return (
    <li
      data-feed-kind="live"
      aria-live="polite"
      className="flex items-baseline gap-2 py-[0.12rem] font-mono text-[0.72rem] leading-5"
    >
      <span
        className={cn('animate-breath shrink-0 leading-none', signalText('live'))}
        aria-hidden="true"
      >
        +
      </span>

      <span className="min-w-0 break-all">
        <span className={signalText('live')}>{live.action}…</span>
        {live.target && <span className="text-muted-foreground"> {live.target}</span>}
      </span>
    </li>
  )
}

/**
 * One thing the run did. A tool use reads as `Edited(src/foo.ts)` — the verb
 * and its object in one breath, the way a transcript reads. Anything that
 * happened *to* the run is a sentence with its particulars on a branch beneath
 * it. Neither carries a clock on the screen: a step is read as a sequence, and
 * a column of timestamps down the left was buying an ordering the order already
 * gives. The exact moment stays in the tooltip and in an `sr-only` `<time>`.
 */
const RunLine = memo(function RunLine({
  entry,
  taskId,
  onOpenFile,
}: {
  entry: LineEntry
  taskId: string
  onOpenFile?: (path: string) => void
}) {
  const call = entry.shape === 'call'

  return (
    <li
      data-feed-kind="line"
      data-live={entry.live ? '' : undefined}
      title={formatTimestamp(entry.at)}
      className="py-[0.12rem] font-mono text-[0.72rem] leading-5"
    >
      <time className="sr-only" dateTime={String(entry.at)}>
        {formatTimestamp(entry.at)}
      </time>

      <p className="flex items-baseline gap-2">
        <span
          className={cn(
            'shrink-0 leading-none',
            entry.live ? `animate-breath ${signalText('live')}` : BULLET_TONE[entry.tone],
          )}
          aria-hidden="true"
        >
          ●
        </span>

        {call ? (
          <span className="min-w-0 break-all">
            <span className="text-foreground">{entry.action}</span>
            <span className="text-muted-foreground">({entry.target})</span>
          </span>
        ) : (
          <span
            className={cn(
              'min-w-0 break-words',
              entry.tone === 'trouble' ? signalText('stopped') : 'text-foreground',
            )}
          >
            {entry.action}
          </span>
        )}
      </p>

      {!call && entry.target && (
        <p className="flex items-baseline gap-2 pl-2 text-muted-foreground">
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            └
          </span>
          <span className="min-w-0 break-words">{entry.target}</span>
        </p>
      )}

      {/* A call that changed a file says what it changed, on the same branch a
          sentence's particulars hang from (REQ-915). */}
      {entry.edit && (
        <ActivityEditBlock
          taskId={taskId}
          seq={entry.seq}
          edit={entry.edit}
          onOpenFile={onOpenFile}
        />
      )}
    </li>
  )
})

/** Two lines of this column, near enough — the clamp itself does the exact work. */
function isLong(body: string | null): boolean {
  return body !== null && (body.length > 160 || body.includes('\n'))
}

/**
 * Read as a chat. What you said is a balloon on your side — the one rounded,
 * filled thing in an interface of hairlines and square corners, because it is
 * the one place a person speaks. What the machine said is left where it is,
 * under the name of the node that said it: a box around it would put the two on
 * equal footing, and they are not.
 */
const FeedTurn = memo(function FeedTurn({ entry }: { entry: TurnEntry }) {
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
  // there is no name and no verb left to carry.
  const carriesSomething = verb !== null || entry.author !== 'owner'
  const showsLine = !said || carriesSomething

  return (
    <li className="flex py-2" data-feed-kind={entry.author} title={formatTimestamp(entry.at)}>
      <div
        className={cn(
          'flex min-w-0 max-w-[42rem] flex-col gap-1',
          mine ? 'ml-auto items-end' : 'mr-auto items-start',
        )}
      >
        {said && (
          <time className="sr-only" dateTime={String(entry.at)}>
            {formatTimestamp(entry.at)}
          </time>
        )}

        {showsLine && (
          <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[0.62rem] text-muted-foreground">
            {/* Your own side needs no name; a node's name is the only identity
                the machine has, so it keeps one. */}
            {entry.author !== 'owner' && (
              <span className={cn('uppercase tracking-[0.06em]', AUTHOR_TONE[entry.author])}>
                {entry.label}
              </span>
            )}

            {said ? (
              verb && <span>{verb}</span>
            ) : (
              <>
                <span>{entry.title}</span>
                <time dateTime={String(entry.at)} className="text-muted-foreground">
                  {formatClock(entry.at)}
                </time>
              </>
            )}
          </p>
        )}

        {entry.body && (
          <div
            data-balloon={balloon ? '' : undefined}
            className={cn('min-w-0', balloon && 'rounded-[1.25rem] bg-popover px-4 py-2.5')}
          >
            <div
              className={cn(
                'artifact-document text-[0.85rem]',
                clamped && 'line-clamp-2 text-muted-foreground',
              )}
            >
              <ArtifactMarkdown content={entry.body} />
            </div>

            {clamps && (
              <TextButton className="mt-1" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'clamp it back' : 'read the whole thing →'}
              </TextButton>
            )}
          </div>
        )}
      </div>
    </li>
  )
})
