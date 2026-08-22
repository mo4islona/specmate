import type { DecisionItem } from '../lib/api-client.ts'
import { formatClock } from '../lib/format.ts'
import {
  eventDetail,
  eventTitle,
  nodeLabel,
  payloadValue,
  stageActivityLabel,
  type ThreadChapter,
  type ThreadEntry,
} from '../lib/task-thread.ts'
import { CommitRef } from './commit-ref.tsx'
import { ConversationMessageItem } from './conversation-message.tsx'
import { DecisionCard } from './decision-card.tsx'

type Tone = 'muted' | 'amber' | 'danger' | 'phosphor'

const TONES: Record<Tone, string> = {
  muted: 'text-muted',
  amber: 'text-amber',
  danger: 'text-danger',
  phosphor: 'text-phosphor',
}

const EVENT_TONES: Record<string, Tone> = {
  'stage.failed': 'danger',
  'stage.cleanup_failed': 'danger',
  'task.failed': 'danger',
  'task.parked': 'amber',
  'task.budget_raised': 'amber',
  'gate.redirected': 'amber',
  'gate.reworked': 'amber',
  'stage.stopping': 'amber',
  'stage.interrupted': 'amber',
  'gate.approved': 'phosphor',
  'task.published': 'phosphor',
}

/** A running stage reports every tool call; the thread keeps the recent tail and counts the rest. */
const ACTIVITY_TAIL = 8

interface ThreadViewProps {
  readonly chapters: readonly ThreadChapter[]
  readonly decisionsById: Map<string, DecisionItem>
  readonly repoUrl: string
  /** The node the task stands on — the only one whose marker is allowed to call for attention. */
  readonly activeNodeKey: string | null
  /** Chapters the owner has flipped away from their default open/closed state. */
  readonly toggled: ReadonlySet<string>
  readonly onToggle: (chapterId: string) => void
}

/**
 * Only the newest chapter is open to begin with — the rest are the task's
 * history, one line each. `toggled` holds the chapters the owner flipped, so a
 * new stage arriving never reopens what they closed.
 */
export function isChapterOpen(
  chapterId: string,
  latestChapterId: string | undefined,
  toggled: ReadonlySet<string>,
): boolean {
  const openByDefault = chapterId === latestChapterId

  return toggled.has(chapterId) ? !openByDefault : openByDefault
}

export function ThreadView({
  chapters,
  decisionsById,
  repoUrl,
  activeNodeKey,
  toggled,
  onToggle,
}: ThreadViewProps) {
  const latestId = chapters.at(-1)?.id

  if (chapters.length === 0) {
    return <p className="py-16 text-center text-sm text-muted">Nothing has happened yet.</p>
  }

  return (
    <div className="space-y-1">
      {chapters.map((chapter) => {
        const open = isChapterOpen(chapter.id, latestId, toggled)

        return (
          <ChapterBlock
            key={chapter.id}
            chapter={chapter}
            open={open}
            active={chapter.nodeKey === activeNodeKey}
            onToggle={() => onToggle(chapter.id)}
            decisionsById={decisionsById}
            repoUrl={repoUrl}
          />
        )
      })}
    </div>
  )
}

function ChapterBlock({
  chapter,
  open,
  active,
  onToggle,
  decisionsById,
  repoUrl,
}: {
  chapter: ThreadChapter
  open: boolean
  active: boolean
  onToggle: () => void
  decisionsById: Map<string, DecisionItem>
  repoUrl: string
}) {
  const { stage } = chapter
  const running = stage?.status === 'running'
  const failed = stage?.status === 'failed'
  const { entries, hidden } = trimActivity(chapter.entries)

  return (
    <section id={`chapter-${chapter.id}`} data-node={chapter.nodeKey} className="scroll-mt-12">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group sticky top-0 z-10 flex w-full items-center gap-2.5 bg-ground/95 py-2 text-left backdrop-blur"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            running
              ? 'dot-live bg-phosphor'
              : failed
                ? 'bg-danger'
                : active && chapter.kind === 'gate'
                  ? 'dot-live bg-amber'
                  : 'bg-border-bright'
          }`}
          aria-hidden="true"
        />
        {/* Name only: how long the stage took, what it spent and what it committed
            are facts about the node, and the pipeline already states them there. */}
        <span
          className={`shrink-0 text-[0.78rem] ${open ? 'text-text' : 'text-muted group-hover:text-text'}`}
        >
          {chapterTitle(chapter)}
        </span>
        <span className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
      </button>

      {open && (
        <ol className="mb-4 space-y-0.5 pl-4">
          {hidden > 0 && (
            <li className="py-1 font-mono text-[0.68rem] text-muted">{hidden} earlier actions</li>
          )}
          {entries.map((entry) => (
            <ThreadEntryItem
              key={entry.id}
              entry={entry}
              decisionsById={decisionsById}
              repoUrl={repoUrl}
            />
          ))}
          {entries.length === 0 && hidden === 0 && (
            <li className="py-1 text-[0.72rem] text-muted">No entries recorded for this stage.</li>
          )}
        </ol>
      )}
    </section>
  )
}

/** A run number is noise until a node has run more than once. */
function chapterTitle(chapter: ThreadChapter): string {
  const label = nodeLabel(chapter.nodeKey)
  if (!chapter.stage || chapter.runs < 2) return label

  return `${label} · run ${chapter.stage.attempt + 1}`
}

function trimActivity(entries: readonly ThreadEntry[]): {
  entries: ThreadEntry[]
  hidden: number
} {
  const activity = entries.filter(
    (entry) => entry.kind === 'event' && entry.event.type === 'stage.activity',
  )
  if (activity.length <= ACTIVITY_TAIL) return { entries: [...entries], hidden: 0 }

  const dropped = new Set(activity.slice(0, activity.length - ACTIVITY_TAIL).map((e) => e.id))

  return { entries: entries.filter((entry) => !dropped.has(entry.id)), hidden: dropped.size }
}

function ThreadEntryItem({
  entry,
  decisionsById,
  repoUrl,
}: {
  entry: ThreadEntry
  decisionsById: Map<string, DecisionItem>
  repoUrl: string
}) {
  if (entry.kind === 'message') {
    return <ConversationMessageItem message={entry.message} />
  }

  const { event } = entry

  if (event.type === 'stage.activity') {
    return (
      <li
        className="flex items-baseline gap-2 py-0.5 font-mono text-[0.7rem] text-muted"
        data-timeline-kind="stage-activity"
        role="status"
      >
        <span className="dot-live h-1 w-1 shrink-0 rounded-full bg-phosphor" aria-hidden="true" />
        <span className="min-w-0 truncate">{stageActivityLabel(event)}</span>
        <Clock at={entry.at} />
      </li>
    )
  }

  if (event.type === 'feedback.comment') {
    return (
      <li className="border-l-2 border-l-phosphor/50 py-2 pl-3">
        <div className="flex items-baseline gap-2">
          <span className="micro-label text-phosphor">you</span>
          <Clock at={entry.at} />
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
          {payloadValue(event, 'comment') ?? ''}
        </p>
      </li>
    )
  }

  const decision = decisionsById.get(payloadValue(event, 'decisionId') ?? '')
  if (decision) {
    // A decision is one thing on the screen, never two: while open it lives
    // where the owner answers it, and it only enters the history once resolved.
    if (decision.status === 'open') return null
    if (event.type !== 'decision.raised') return null

    return (
      <DecisionCard
        decision={decision}
        parkedOnThis={false}
        compact
        onAnswerOption={() => undefined}
        onAnswerText={() => undefined}
        onDismiss={() => undefined}
      />
    )
  }

  const detail = eventDetail(event, decisionsById)
  const tone = EVENT_TONES[event.type] ?? 'muted'
  const commit = payloadValue(event, 'commit')

  return (
    <li className="flex items-baseline gap-2 py-1 text-[0.74rem] leading-5">
      <span className={`shrink-0 ${TONES[tone]}`}>{eventTitle(event)}</span>
      {detail && <span className="min-w-0 flex-1 truncate text-muted">{detail}</span>}
      {commit && <CommitRef sha={commit} repoUrl={repoUrl} />}
      <Clock at={entry.at} className={detail ? '' : 'ml-auto'} />
    </li>
  )
}

function Clock({ at, className = '' }: { at: string; className?: string }) {
  return (
    <time
      className={`ml-auto shrink-0 font-mono text-[0.6rem] text-muted ${className}`}
      dateTime={at}
    >
      {formatClock(at)}
    </time>
  )
}
