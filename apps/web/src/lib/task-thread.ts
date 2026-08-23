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
  'task.renamed': 'Task renamed',
  'task.base_branch_pinned': 'Base branch pinned',
  'task.profile_changed': 'Pipeline profile changed',
  'coverage_waiver.recorded': 'Coverage gap accepted',
  'conversation.action.proposed': 'Action proposed',
  'conversation.action.confirmed': 'Action confirmed',
  'conversation.action.applied': 'Action applied',
}

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
  const { kind, target } = stageActivityParts(event)

  return target ? `${kind} ${target}` : kind
}

/** The run log gives the verb and its target a column each; everywhere else they read as one line. */
export function stageActivityParts(event: TimelineEvent): { kind: string; target: string } {
  const tool = payloadValue(event, 'tool') ?? 'Unknown tool'

  return { kind: ACTIVITY_VERBS[tool] ?? tool, target: payloadValue(event, 'target') ?? '' }
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

  // `task.created` carries the title, which the header of every surface already
  // states — repeating it as the thread's first body is a line saying nothing.
  if (event.type === 'task.created') return null

  if (event.type === 'decision.raised') {
    return decision?.promptMd ?? payloadValue(event, 'key') ?? 'A decision was raised.'
  }
  // The words alone: who answered is the side the entry sits on and what they
  // did is its verb, so a body that opens with "Answered by owner:" says the
  // line's own label back to it (REQ-919).
  if (event.type === 'decision.answered' || event.type === 'decision.dismissed') {
    return decision?.answerMd ?? null
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

  if (event.type === 'task.renamed') {
    const from = payloadValue(event, 'from')
    const title = payloadValue(event, 'title') ?? 'a name of its own'

    return from
      ? `Planning read the repository and renamed this from "${from}" to "${title}".`
      : `Planning named this "${title}".`
  }

  if (event.type === 'task.base_branch_pinned') {
    const baseBranch = payloadValue(event, 'baseBranch') ?? 'the repository default'

    return `The task branch was cut from ${baseBranch}, the repository's default.`
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

// ─── the feed ─────────────────────────────────────────────────────────────────

/**
 * What earns a line: something a person said, something asked of them, or an
 * outcome that needs them. Stated as an allow-set rather than a deny-set on
 * purpose — the thread stays five to fifteen lines only if a new event type has
 * to be let in deliberately (REQ-919).
 */
const FEED_EVENTS: ReadonlySet<string> = new Set([
  'task.created',
  'task.published',
  'task.cancelled',
  'task.failed',
  'task.budget_raised',
  'gate.approved',
  'gate.redirected',
  'gate.reworked',
  'feedback.comment',
  'decision.answered',
  'decision.dismissed',
  'decision.refused',
  'decision.inherited',
  'coverage_waiver.recorded',
  'stage.failed',
])

/** Whose line it is. The machine's own name is the node, never "system". */
export type FeedAuthor = 'owner' | 'guide' | 'task'

export interface FeedEntry {
  readonly id: string
  readonly at: string
  readonly author: FeedAuthor
  /** Rendered beside the author: "answered", "commented", "asked". */
  readonly verb: string
  /**
   * The same event with nobody attached — "Task launched", "Gate approved".
   * An entry that carries no words is a marker on the timeline rather than a
   * turn in the conversation, and reads better without a voice.
   */
  readonly title: string
  readonly label: string
  readonly body: string | null
  /** The node whose run log explains this line, where one does. */
  readonly nodeKey: string | null
  /** Set when the line is a resolved question, so its whole exchange can be opened. */
  readonly decisionId: string | null
}

const OWNER_EVENTS: ReadonlySet<string> = new Set([
  'task.created',
  'task.budget_raised',
  'gate.approved',
  'gate.redirected',
  'gate.reworked',
  'feedback.comment',
  'decision.answered',
  'decision.dismissed',
])

const EVENT_VERBS: Record<string, string> = {
  'task.created': 'launched this task',
  'task.published': 'published a pull request',
  'task.cancelled': 'was cancelled',
  'task.failed': 'stopped',
  'task.budget_raised': 'raised the budget',
  'gate.approved': 'approved',
  'gate.redirected': 'redirected',
  'gate.reworked': 'sent back for rework',
  'feedback.comment': 'commented',
  'decision.answered': 'answered',
  'decision.dismissed': 'dismissed',
  'decision.refused': 'declined to ask',
  'decision.inherited': 'inherited an answer',
  'coverage_waiver.recorded': 'accepted the coverage gap',
  'stage.failed': 'failed',
}

interface FeedInput {
  readonly events: readonly TimelineEvent[]
  readonly messages: readonly ConversationMessage[]
  readonly stages: readonly Stage[]
  readonly decisionsById: Map<string, DecisionItem>
}

/**
 * A stage failure earns a line only when it is still the last word at its node.
 * A run that failed and was retried into an acceptance is the machine's own
 * business; one that stopped the task is addressed to the owner.
 */
function stillFailing(event: TimelineEvent, stages: readonly Stage[]): boolean {
  const failed = stages.find((stage) => stage.id === event.stageId)
  if (!failed) return false

  return !stages.some(
    (stage) =>
      stage.nodeKey === failed.nodeKey &&
      stage.attempt > failed.attempt &&
      stage.status === 'succeeded',
  )
}

export function buildFeed({ events, messages, stages, decisionsById }: FeedInput): FeedEntry[] {
  const entries: FeedEntry[] = []

  for (const event of events) {
    if (!FEED_EVENTS.has(event.type)) continue
    if (event.type === 'stage.failed' && !stillFailing(event, stages)) continue

    // An open question lives above the input, never also in the feed (AC-956);
    // a resolved one reads here as the exchange it turned into.
    const decisionId = payloadValue(event, 'decisionId')
    const decision = decisionId ? decisionsById.get(decisionId) : undefined
    if (decision && decision.status === 'open') continue

    const stage = stages.find((row) => row.id === event.stageId)

    entries.push({
      id: `event-${event.seq}`,
      at: String(event.createdAt),
      author: OWNER_EVENTS.has(event.type) ? 'owner' : 'task',
      verb: EVENT_VERBS[event.type] ?? eventTitle(event).toLowerCase(),
      title: eventTitle(event),
      label: feedLabel(event, stage),
      body: eventDetail(event, decisionsById),
      nodeKey: stage?.nodeKey ?? payloadValue(event, 'nodeKey'),
      decisionId: decision ? decision.id : null,
    })
  }

  for (const message of messages) {
    entries.push({
      id: `message-${message.id}`,
      at: String(message.createdAt),
      author: message.role === 'owner' ? 'owner' : 'guide',
      verb: message.role === 'owner' ? 'asked' : 'answered',
      title: message.role === 'owner' ? 'Message sent' : 'Guide replied',
      label: message.role === 'owner' ? 'You' : 'Guide',
      body: message.contentMd,
      nodeKey: null,
      decisionId: null,
    })
  }

  return entries.sort(
    (left, right) =>
      (millis(left.at) ?? 0) - (millis(right.at) ?? 0) || left.id.localeCompare(right.id),
  )
}

/** Who the line is from: the owner, or the node that produced it. */
function feedLabel(event: TimelineEvent, stage: Stage | undefined): string {
  if (OWNER_EVENTS.has(event.type)) return 'You'
  if (stage) return nodeLabel(stage.nodeKey)

  const gate = payloadValue(event, 'gate') ?? payloadValue(event, 'nodeKey')

  return gate ? nodeLabel(gate) : 'Task'
}
