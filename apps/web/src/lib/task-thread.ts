import type { ConversationMessage, DecisionItem, TaskDetail, TimelineEvent } from './api-client.ts'

type Stage = TaskDetail['stages'][number]

export const EVENT_TITLES: Record<string, string> = {
  'task.created': 'Task launched',
  'task.transitioned': 'Task moved',
  'task.parked': 'Parked for you',
  'task.failed': 'Task failed',
  'task.resumed': 'Task resumed',
  'task.restarted': 'Task restarted',
  'task.cancelled': 'Task cancelled',
  'task.published': 'Pull request published',
  'task.budget_raised': 'Budget raised',
  'task.environment_pinned': 'Environment pinned',
  'task.environment_repinned': 'Environment repinned',
  'stage.dispatched': 'Stage started',
  'stage.completed': 'Stage accepted',
  'stage.failed': 'Stage failed',
  'stage.stopping': 'Stopping the run',
  'stage.interrupted': 'Run stopped',
  'stage.cleanup_failed': 'Cleanup failed',
  'stage.restart_confirmed': 'Restart confirmed',
  'gate.approved': 'Gate approved',
  'gate.redirected': 'Task redirected',
  'gate.reworked': 'Rework requested',
  'feedback.comment': 'Owner comment',
  'decision.raised': 'Decision raised',
  'decision.answered': 'Decision answered',
  'decision.dismissed': 'Decision dismissed',
  'decision.refused': 'Questions refused',
  'decision.inherited': 'Coverage gap inherited',
  'task.plan_recorded': 'Plan recorded',
  'task.profile_changed': 'Pipeline profile changed',
  'coverage_waiver.recorded': 'Coverage gap accepted',
  'conversation.action.proposed': 'Action proposed',
  'conversation.action.confirmed': 'Action confirmed',
  'conversation.action.applied': 'Action applied',
}

/**
 * Events the thread never gives a line of its own: the chapter each one opens
 * or closes already says it, or the conversation query renders the message
 * itself. Dropping them here is what keeps the thread readable as a chat
 * rather than as the raw ledger.
 */
const SILENT_EVENTS: ReadonlySet<string> = new Set([
  'stage.dispatched',
  'task.transitioned',
  'conversation.created',
  'conversation.message.created',
  'conversation.response.completed',
  'conversation.response.failed',
  'task.environment_pinned',
  'task.environment_repinned',
])

/** The events that actually move a task between nodes; every other event reads the state, never writes it. */
const STATE_MOVERS: ReadonlySet<string> = new Set([
  'task.transitioned',
  'task.parked',
  'task.failed',
])

export function payloadValue(event: TimelineEvent, key: string): string | null {
  const value = event.payload[key]

  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Payload lists are what several events carry that matters most — the refused keys above all. */
function payloadList(event: TimelineEvent, key: string): string[] {
  const value = event.payload[key]
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function payloadNumber(event: TimelineEvent, key: string): number | null {
  const value = event.payload[key]

  return typeof value === 'number' ? value : null
}

/** Human-facing verb per known tool name; an unrecognized tool falls back to its own name. */
const ACTIVITY_VERBS: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Bash: 'Running',
  BashOutput: 'Checking',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Task: 'Delegating to',
  TodoWrite: 'Updating plan',
}

/** REQ-915: a live `stage.activity` event reads as "Editing src/foo.ts", not raw tool/target keys. */
export function stageActivityLabel(event: TimelineEvent): string {
  const tool = payloadValue(event, 'tool') ?? 'Unknown tool'
  const target = payloadValue(event, 'target')
  const verb = ACTIVITY_VERBS[tool] ?? tool

  return target ? `${verb} ${target}` : verb
}

/**
 * REQ-915/AC-941: once an attempt's result is accepted — or it fails, or it's
 * interrupted — its activity is stale. Demoted here by dropping it from the
 * timeline rather than leaving it standing beside the outcome.
 */
export function visibleTimelineEvents(
  events: readonly TimelineEvent[],
  stages: readonly { id: string; status: string }[],
): TimelineEvent[] {
  const runningStageIds = new Set(
    stages.filter((stage) => stage.status === 'running').map((stage) => stage.id),
  )

  return events.filter(
    (event) => event.type !== 'stage.activity' || runningStageIds.has(event.stageId ?? ''),
  )
}

/** Mirrors the engine's own `countRedirects`, so the client reads the cap the same way the server enforces it. */
export function countGateRedirects(events: readonly TimelineEvent[], gateKey: string): number {
  return events.filter(
    (event) => event.type === 'gate.redirected' && payloadValue(event, 'gate') === gateKey,
  ).length
}

/** A transition names where it went; the chapter it opens is titled by that, not by "task.transitioned". */
export function eventTitle(event: TimelineEvent): string {
  const to = payloadValue(event, 'to')
  if (event.type === 'task.transitioned' && to) return `Moved to ${nodeLabel(to).toLowerCase()}`
  if (event.type === 'gate.approved' && to) return `Approved → ${nodeLabel(to).toLowerCase()}`
  if (event.type === 'gate.redirected' && to) return `Redirected → ${nodeLabel(to).toLowerCase()}`
  if (event.type === 'gate.reworked' && to) return `Rework → ${nodeLabel(to).toLowerCase()}`

  return EVENT_TITLES[event.type] ?? event.type
}

/**
 * decision.* events carry only the decision's id and identity, not its
 * question or answer text — that lives on the decision row itself, so the
 * timeline looks it up from the task's already-loaded decisions.
 */
export function eventDetail(
  event: TimelineEvent,
  decisionsById: Map<string, DecisionItem>,
): string | null {
  const decisionId = payloadValue(event, 'decisionId')
  const decision = decisionId ? decisionsById.get(decisionId) : undefined

  if (event.type === 'decision.raised') {
    return decision?.promptMd ?? payloadValue(event, 'key') ?? 'A decision was raised.'
  }
  if (event.type === 'decision.answered' || event.type === 'decision.dismissed') {
    const verb = event.type === 'decision.answered' ? 'Answered' : 'Dismissed'
    const actor = payloadValue(event, 'actor')
    const by = actor ? ` by ${actor}` : ''

    return decision?.answerMd ? `${verb}${by}: ${decision.answerMd}` : `${verb}${by}.`
  }

  // REQ-1208: a refused question is only refused out loud if its key is here.
  // The generic fallback below reads arrays as absent, which would render the
  // cap as an unexplained line and lose exactly what it was meant to name.
  if (event.type === 'decision.refused') {
    const keys = payloadList(event, 'keys')
    const cap = payloadNumber(event, 'cap')
    const limit = cap === null ? '' : ` (cap ${cap} per stage)`

    return keys.length > 0
      ? `Not asked${limit}: ${keys.join(', ')}`
      : `Questions past the cap were refused${limit}.`
  }

  if (event.type === 'task.plan_recorded') {
    const size = payloadValue(event, 'size') ?? 'unknown'
    const prerequisites = payloadList(event, 'prerequisites')
    const applied =
      event.payload.applied === false ? ' — profile already pinned, size not applied' : ''
    const proposes =
      prerequisites.length > 0 ? `; proposes ${prerequisites.join(', ')}` : '; no prerequisites'

    return `Planning declared size ${size}${proposes}${applied}.`
  }

  if (event.type === 'task.profile_changed') {
    const from = payloadValue(event, 'from') ?? 'the pinned profile'
    const to = payloadValue(event, 'to') ?? 'a new profile'
    const size = payloadValue(event, 'size')

    return size
      ? `Declared size ${size} switched the pipeline from ${from} to ${to}.`
      : `Pipeline switched from ${from} to ${to}.`
  }

  if (event.type === 'coverage_waiver.recorded') {
    const repoUrl = payloadValue(event, 'repoUrl')

    return repoUrl
      ? `The coverage gap was accepted for ${repoUrl}. Later tasks against it inherit this until a probe finds it adequate, or it is revoked in Settings.`
      : 'The coverage gap was accepted for this repository.'
  }

  if (event.type === 'decision.inherited') {
    const originTaskId = payloadValue(event, 'originTaskId')

    return originTaskId
      ? `This repository's coverage gap was already accepted on task ${originTaskId.slice(0, 8)}; the task was not asked again.`
      : "This repository's coverage gap was already accepted; the task was not asked again."
  }

  const comment = payloadValue(event, 'comment')
  if (comment) return comment

  const reason = payloadValue(event, 'reason')
  const detail = payloadValue(event, 'detail')
  if (reason || detail) {
    return [reason ? humanize(reason) : null, detail].filter(Boolean).join(' — ')
  }

  return payloadValue(event, 'title')
}

/** Engine enums (`verification_failed`) are written for code; the thread reads them as words. */
function humanize(value: string): string {
  return value.includes(' ') ? value : value.replaceAll('_', ' ')
}

// ─── labels and numbers ───────────────────────────────────────────────────────

/** `human_kickoff_gate` reads as "Kickoff gate": the pipeline column already says these are stages. */
export function nodeLabel(key: string): string {
  const words = key.replace(/^human_/, '').replaceAll('_', ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatTokens(total: number): string {
  if (total < 1_000) return String(total)
  if (total < 1_000_000) return `${(total / 1_000).toFixed(1)}k`

  return `${(total / 1_000_000).toFixed(2)}M`
}

function millis(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()

  return Number.isFinite(parsed) ? parsed : null
}

/** A stage that is still running is timed against now, so a live chapter counts up. */
export function stageDuration(stage: Stage, now = Date.now()): number | null {
  const started = millis(stage.startedAt)
  if (started === null) return null

  return (millis(stage.finishedAt) ?? now) - started
}

export function stageTokens(stage: Stage): number | null {
  const tokens = stage.telemetry?.tokens
  if (!tokens) return null

  return Object.values(tokens).reduce((total, value) => total + value, 0)
}

// ─── the thread ───────────────────────────────────────────────────────────────

export type ThreadEntry =
  | {
      readonly kind: 'event'
      readonly id: string
      readonly at: string
      readonly event: TimelineEvent
    }
  | {
      readonly kind: 'message'
      readonly id: string
      readonly at: string
      readonly message: ConversationMessage
    }

export type ChapterKind = 'stage' | 'gate' | 'task'

export interface ThreadChapter {
  readonly id: string
  readonly kind: ChapterKind
  /** The pipeline node this chapter covers — a stage, a gate, or an engine-owned state. */
  readonly nodeKey: string
  readonly stage: Stage | null
  /** How many times this node ran in total: a run number means nothing when there was only one. */
  readonly runs: number
  readonly entries: ThreadEntry[]
}

interface ThreadInput {
  readonly events: readonly TimelineEvent[]
  readonly stages: readonly Stage[]
  readonly messages: readonly ConversationMessage[]
  /** Where the task stood before the oldest event in the window — the graph's entry node. */
  readonly entryState: string
}

function entryTime(entry: ThreadEntry): number {
  return millis(entry.at) ?? 0
}

/** Events written in the same millisecond still have an order: the ledger's own sequence. */
function entryOrder(entry: ThreadEntry): number {
  return entry.kind === 'event' ? entry.event.seq : Number.MAX_SAFE_INTEGER
}

/**
 * Splits the ledger into per-stage chapters so the thread reads as a
 * conversation with one agent at a time instead of one unbroken log.
 *
 * An entry belongs to a stage when it names that stage, or when it happened
 * while that stage was the running one — an owner comment posted mid-run
 * belongs inside the run it is about, not in a chapter of its own. Everything
 * else falls to the state the task was in at that moment, which is what makes
 * a gate's approvals and comments read as the gate's own chapter.
 */
export function buildThread({
  events,
  stages,
  messages,
  entryState,
}: ThreadInput): ThreadChapter[] {
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]))
  const windows = stages
    .flatMap((stage) => {
      const from = millis(stage.startedAt)

      return from === null
        ? []
        : [{ stage, from, to: millis(stage.finishedAt) ?? Number.MAX_SAFE_INTEGER }]
    })
    .sort((left, right) => left.from - right.from)

  const entries: ThreadEntry[] = [
    ...events.map(
      (event): ThreadEntry => ({
        kind: 'event',
        id: `event-${event.seq}`,
        at: String(event.createdAt),
        event,
      }),
    ),
    ...messages.map(
      (message): ThreadEntry => ({
        kind: 'message',
        id: `message-${message.id}`,
        at: String(message.createdAt),
        message,
      }),
    ),
  ].sort(
    (left, right) => entryTime(left) - entryTime(right) || entryOrder(left) - entryOrder(right),
  )

  // The event window holds only the tail of a long task, so the opening state
  // is read off the oldest transition that still carries one rather than
  // assumed to be the graph's entry.
  const firstFrom = events
    .map((event) => payloadValue(event, 'from'))
    .find((from): from is string => from !== null)

  let state = firstFrom ?? entryState
  let epoch = 0
  const chapters: ThreadChapter[] = []
  const byId = new Map<string, ThreadChapter>()

  const runCount = (nodeKey: string) =>
    stages.filter((candidate) => candidate.nodeKey === nodeKey).length

  const open = (id: string, kind: ChapterKind, nodeKey: string, stage: Stage | null) => {
    const existing = byId.get(id)
    if (existing) return existing

    const chapter: ThreadChapter = {
      id,
      kind,
      nodeKey,
      stage,
      runs: stage ? runCount(nodeKey) : 1,
      entries: [],
    }
    byId.set(id, chapter)
    chapters.push(chapter)

    return chapter
  }

  for (const entry of entries) {
    // A move is read before the entry is placed, so "Parked for you" opens the
    // gate's chapter instead of closing the stage that ran into it.
    if (entry.kind === 'event') {
      const to = payloadValue(entry.event, 'to')
      const moves = STATE_MOVERS.has(entry.event.type)
      if (moves && to && to !== state) {
        state = to
        epoch += 1
      }
    }

    // A silent event opens no chapter of its own: a transition that only moves
    // the task between two stages would otherwise leave an empty one behind.
    if (entry.kind === 'event' && SILENT_EVENTS.has(entry.event.type)) continue

    const stageId = entry.kind === 'event' ? entry.event.stageId : entry.message.stageId
    const named = stageId ? stagesById.get(stageId) : undefined
    const at = entryTime(entry)
    // Inclusive at both ends: an event stamped exactly when its stage finished
    // is that stage's, not the beginning of a chapter of its own.
    const running = windows.find(
      (window) => window.from <= at && at <= window.to && window.stage.nodeKey === state,
    )
    const stage = named ?? running?.stage

    const chapter = stage
      ? open(`stage:${stage.id}`, 'stage', stage.nodeKey, stage)
      : open(`state:${state}:${epoch}`, state.includes('gate') ? 'gate' : 'task', state, null)

    chapter.entries.push(entry)
  }

  // A stage that has started but whose events fell outside the window still
  // gets its chapter, so the pipeline and the thread never disagree about
  // which stages this task ran.
  for (const { stage } of windows) {
    open(`stage:${stage.id}`, 'stage', stage.nodeKey, stage)
  }

  return chapters.sort((left, right) => chapterStart(left) - chapterStart(right))
}

function chapterStart(chapter: ThreadChapter): number {
  const stageStart = chapter.stage ? millis(chapter.stage.startedAt) : null

  return (
    stageStart ?? (chapter.entries[0] ? entryTime(chapter.entries[0]) : Number.MAX_SAFE_INTEGER)
  )
}
