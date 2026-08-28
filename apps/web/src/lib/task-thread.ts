import { failureSentence } from '@specmate/core'
import type { ConversationMessage, DecisionItem, TaskDetail, TimelineEvent } from './api-client.ts'
import { isReadOnlyShell } from './shell-reads.ts'

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

interface ToolVerb {
  /** What it is doing, for the line that reports a run in progress. */
  readonly doing: string
  /** What it did, for the record a finished run leaves behind. */
  readonly did: string
  /**
   * Whether the tool changes anything. Only a change earns a permanent line:
   * a run that read forty files and edited two is two lines and a count, not
   * forty-two (REQ-915). `Bash` is the one entry this cannot settle on its own
   * — see `isMutatingActivity`.
   */
  readonly mutates: boolean
}

const TOOL_VERBS: Record<string, ToolVerb> = {
  Read: { doing: 'Reading', did: 'Read', mutates: false },
  Glob: { doing: 'Searching', did: 'Searched', mutates: false },
  Grep: { doing: 'Searching', did: 'Searched', mutates: false },
  WebFetch: { doing: 'Fetching', did: 'Fetched', mutates: false },
  WebSearch: { doing: 'Searching', did: 'Searched', mutates: false },
  BashOutput: { doing: 'Checking', did: 'Checked', mutates: false },
  TodoWrite: { doing: 'Updating plan', did: 'Updated its plan', mutates: false },
  Task: { doing: 'Delegating to', did: 'Delegated to', mutates: false },
  Edit: { doing: 'Editing', did: 'Edited', mutates: true },
  MultiEdit: { doing: 'Editing', did: 'Edited', mutates: true },
  Write: { doing: 'Writing', did: 'Wrote', mutates: true },
  NotebookEdit: { doing: 'Editing', did: 'Edited', mutates: true },
  Bash: { doing: 'Running', did: 'Ran', mutates: true },
}

/** An unrecognized tool keeps its own name and its line: we cannot claim it changed nothing. */
function toolVerb(tool: string): ToolVerb {
  return TOOL_VERBS[tool] ?? { doing: tool, did: tool, mutates: true }
}

export function isMutatingActivity(event: TimelineEvent): boolean {
  const tool = payloadValue(event, 'tool') ?? 'Unknown tool'

  // A shell call is judged by what it ran, not by the fact that it was a shell.
  // `sed -n '1,140p'` and `tail -40` are how a run reads what the Read tool
  // cannot page, and a permanent line for each of those is exactly the
  // forty-two lines REQ-915 exists to prevent.
  if (tool === 'Bash') return !isReadOnlyShell(payloadValue(event, 'target') ?? '')

  return toolVerb(tool).mutates
}

/**
 * Every target the agent reports is an absolute path inside the sandbox, so
 * every line of a run repeated the same seventy characters of workspace root
 * before saying anything. What the owner reads is the path within the
 * repository.
 */
export function shortenTarget(target: string): string {
  return target.replace(/^\/\S*?\/workspaces\/[^/\s]+\/[^/\s]+\//, '')
}

/** REQ-915: a live `stage.activity` event reads as "Editing src/foo.ts", not raw tool/target keys. */
export function stageActivityLabel(event: TimelineEvent): string {
  const { kind, target } = stageActivityParts(event)

  return target ? `${kind} ${target}` : kind
}

/** The record gives the verb and its target a column each; everywhere else they read as one line. */
export function stageActivityParts(
  event: TimelineEvent,
  tense: 'doing' | 'did' = 'doing',
): { kind: string; target: string } {
  const tool = payloadValue(event, 'tool') ?? 'Unknown tool'
  const target = payloadValue(event, 'target') ?? ''

  return { kind: toolVerb(tool)[tense], target: shortenTarget(target) }
}

/** What one file-editing tool use did (REQ-212), as the timeline carries it. */
export interface ActivityEdit {
  readonly path: string
  readonly additions: number
  readonly deletions: number
  readonly preview: string
  readonly clamped: boolean
  readonly truncated: boolean
  readonly anchored: boolean
}

/**
 * The payload is typed as an open record, and an event recorded before this
 * existed carries no edit at all — so the shape is checked rather than asserted.
 */
export function activityEdit(event: TimelineEvent): ActivityEdit | null {
  const edit = event.payload.edit
  if (typeof edit !== 'object' || edit === null) return null

  const fields = edit as Record<string, unknown>
  if (typeof fields.path !== 'string' || typeof fields.preview !== 'string') return null

  return {
    path: fields.path,
    additions: typeof fields.additions === 'number' ? fields.additions : 0,
    deletions: typeof fields.deletions === 'number' ? fields.deletions : 0,
    preview: fields.preview,
    clamped: fields.clamped === true,
    truncated: fields.truncated === true,
    anchored: fields.anchored === true,
  }
}

/** "Added 10 lines, removed 4 lines" — a side that did nothing does not claim a clause. */
export function editSummary(edit: ActivityEdit): string {
  const added = edit.additions > 0 ? `${edit.additions} ${lineWord(edit.additions)}` : null
  const removed = edit.deletions > 0 ? `${edit.deletions} ${lineWord(edit.deletions)}` : null

  if (added && removed) return `Added ${added}, removed ${removed}`
  if (added) return `Added ${added}`
  if (removed) return `Removed ${removed}`

  return 'Rewrote the file with no line changed'
}

function lineWord(count: number): string {
  return count === 1 ? 'line' : 'lines'
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
    return [reason ? reasonText(reason) : null, detail].filter(Boolean).join(' — ')
  }

  return payloadValue(event, 'title')
}

/** Engine enums (`verification_failed`) are written for code; the thread reads them as words. */
function humanize(value: string): string {
  return value.includes(' ') ? value : value.replaceAll('_', ' ')
}

/**
 * A failure the harness named reads as the sentence its table entry carries.
 * Anything else a `reason` payload holds was never in that vocabulary, and the
 * identifier read as words is all there is to say about it.
 */
function reasonText(reason: string): string {
  return failureSentence(reason) ?? humanize(reason)
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

/**
 * The provider's own usage keys, in the owner's words. Read against a budget,
 * `cache_read_input_tokens` and `input_tokens` are not the same thing at all —
 * one is nearly free — so the total is worth splitting where there is room.
 */
const TOKEN_LABELS: Record<string, string> = {
  input_tokens: 'in',
  output_tokens: 'out',
  cache_creation_input_tokens: 'cache write',
  cache_read_input_tokens: 'cache read',
}

export interface TokenPart {
  readonly label: string
  readonly value: number
}

/** Known keys first, in the order above; anything the provider adds keeps its own name. */
export function tokenSplit(tokens: Readonly<Record<string, number>>): TokenPart[] {
  const known = Object.keys(TOKEN_LABELS)
  const rest = Object.keys(tokens)
    .filter((key) => !known.includes(key))
    .sort()

  return [...known, ...rest]
    .filter((key) => (tokens[key] ?? 0) > 0)
    .map((key) => ({
      label: TOKEN_LABELS[key] ?? key.replaceAll('_', ' '),
      value: tokens[key] as number,
    }))
}

// ─── the step's chapter ───────────────────────────────────────────────────────

/** Whose turn it is. The machine's own name is the node, never "system". */
export type FeedAuthor = 'owner' | 'guide' | 'task'

/** Which column of the record carries the colour: boundaries, trouble, the rest. */
export type LineTone = 'plain' | 'boundary' | 'trouble'

/** Something a person said, was asked, or decided. */
export interface TurnEntry {
  readonly kind: 'turn'
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
  /** Set on a question and on its answer, so the exchange can be opened. */
  readonly decisionId: string | null
}

/**
 * A line of the machine's own record: what the run did, and to what. A `call`
 * is one tool use and reads as `Edited(src/foo.ts)`; an `event` is something
 * that happened to the run and reads as a sentence with its particulars on a
 * branch beneath it.
 */
export interface LineEntry {
  readonly kind: 'line'
  readonly id: string
  readonly at: string
  readonly shape: 'call' | 'event'
  readonly action: string
  readonly target: string
  readonly tone: LineTone
  /** The newest action of a run still under way (REQ-915). */
  readonly live: boolean
  /** The event's own cursor, which is where its whole patch is read (REQ-1018). */
  readonly seq: number
  /** What the call changed, where it was a file-editing one (REQ-212). */
  readonly edit: ActivityEdit | null
}

export type FeedEntry = TurnEntry | LineEntry

/**
 * What earns a turn rather than a log line: something a person said, something
 * asked of them, or an outcome addressed to them. Everything else a step did is
 * the machine's own record, and reads as a line of it (REQ-919).
 */
const TURN_EVENTS: ReadonlySet<string> = new Set([
  'task.created',
  'task.published',
  'task.cancelled',
  'task.failed',
  'task.budget_raised',
  'gate.approved',
  'gate.redirected',
  'gate.reworked',
  'feedback.comment',
  'decision.raised',
  'decision.answered',
  'decision.dismissed',
  'decision.refused',
  'decision.inherited',
  'coverage_waiver.recorded',
])

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
  'decision.raised': 'asked',
  'decision.answered': 'answered',
  'decision.dismissed': 'dismissed',
  'decision.refused': 'declined to ask',
  'decision.inherited': 'inherited an answer',
  'coverage_waiver.recorded': 'accepted the coverage gap',
}

/** A run's own boundaries: where it started, and how it ended. */
const BOUNDARY_EVENTS: ReadonlySet<string> = new Set([
  'stage.dispatched',
  'stage.completed',
  'stage.interrupted',
  'stage.restart_confirmed',
  'task.transitioned',
])

const TROUBLE_EVENTS: ReadonlySet<string> = new Set([
  'stage.failed',
  'stage.cleanup_failed',
  'stage.stopping',
])

function lineTone(event: TimelineEvent): LineTone {
  if (TROUBLE_EVENTS.has(event.type)) return 'trouble'
  if (BOUNDARY_EVENTS.has(event.type)) return 'boundary'

  return 'plain'
}

/** The record gives the action and its target a column each. */
function lineParts(event: TimelineEvent): { action: string; target: string } {
  if (event.type === 'stage.activity') {
    const { kind, target } = stageActivityParts(event, 'did')

    return { action: kind, target }
  }

  const reason = payloadValue(event, 'reason')
  const target =
    payloadValue(event, 'commit') ??
    payloadValue(event, 'title') ??
    (reason ? reasonText(reason) : null) ??
    payloadValue(event, 'detail') ??
    ''

  return { action: eventTitle(event), target }
}

interface StepInput {
  readonly events: readonly TimelineEvent[]
  readonly stages: readonly Stage[]
  /** Where the walk starts, for what happened before the first transition. */
  readonly firstNodeKey: string | null
}

/**
 * Which node's chapter each event belongs to, by sequence. A stage event
 * belongs to its stage's node, a gate or decision event to the node it names,
 * and everything else to the node the task stood on when it happened — which is
 * why this walks the transitions rather than reading the task's state now.
 * Nothing is left homeless: the thread reads one chapter at a time, and an
 * event with no chapter is one nobody can reach.
 */
export function assignSteps({
  events,
  stages,
  firstNodeKey,
}: StepInput): Map<number, string | null> {
  const stageNodes = new Map(stages.map((stage) => [stage.id, stage.nodeKey]))
  const steps = new Map<number, string | null>()
  let standing = firstNodeKey

  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const named =
      (event.stageId ? stageNodes.get(event.stageId) : null) ??
      payloadValue(event, 'nodeKey') ??
      payloadValue(event, 'gate') ??
      (event.type === 'task.transitioned' ? payloadValue(event, 'to') : null)

    steps.set(event.seq, named ?? standing)

    // An approval is written at the gate it passed and moves the task on; the
    // chapter it opens is the one it named, not the one it was recorded in.
    const moved = payloadValue(event, 'to') ?? named
    if (moved) standing = moved
  }

  return steps
}

interface StepFeedInput extends StepInput {
  readonly messages: readonly ConversationMessage[]
  readonly decisionsById: Map<string, DecisionItem>
  /** The chapter being read. */
  readonly nodeKey: string | null
}

/**
 * One step's whole history: what it did, what it asked, and what was said to it
 * while it stood there (REQ-919). Reading another step is reading another
 * chapter — the rail is the switch, and no entry belongs to two of them.
 */
export function buildStepFeed({
  events,
  messages,
  stages,
  decisionsById,
  nodeKey,
  firstNodeKey,
}: StepFeedInput): FeedEntry[] {
  const steps = assignSteps({ events, stages, firstNodeKey })
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]))
  const newestActivity = newestActivityByStage(events)
  // Reading a timestamp costs a date parse, and every event's was read once per
  // message to place it and again on every comparison of the sort below — two
  // hundred events sorting is some thousands of parses. They are read here,
  // once, and everything downstream works in numbers.
  const at = new Map(events.map((event) => [event.seq, millis(event.createdAt) ?? 0]))
  const entries: { at: number; entry: FeedEntry }[] = []

  /**
   * REQ-915: the newest action of a run still under way is what is happening
   * now. Once that run ends the line stays in the record, but it stops claiming
   * to be live — the outcome beneath it is the fresher fact.
   */
  const live = (event: TimelineEvent): boolean => {
    if (event.type !== 'stage.activity' || !event.stageId) return false
    if (stagesById.get(event.stageId)?.status !== 'running') return false

    return newestActivity.get(event.stageId) === event.seq
  }

  for (const event of events) {
    if (steps.get(event.seq) !== nodeKey) continue

    const decisionId = payloadValue(event, 'decisionId')
    const decision = decisionId ? decisionsById.get(decisionId) : undefined
    // An open question lives above the input, never also in the thread (AC-956).
    if (decision && decision.status === 'open') continue

    // Reading and searching are how a run gets to what it changes, not what it
    // did. They report themselves while the run is under way — one line, in
    // place — and leave nothing behind (REQ-915).
    if (event.type === 'stage.activity' && !isMutatingActivity(event)) continue

    if (TURN_EVENTS.has(event.type)) {
      const stage = event.stageId ? stagesById.get(event.stageId) : undefined

      entries.push({
        at: at.get(event.seq) ?? 0,
        entry: {
          kind: 'turn',
          id: `event-${event.seq}`,
          at: String(event.createdAt),
          author: OWNER_EVENTS.has(event.type) ? 'owner' : 'task',
          verb: EVENT_VERBS[event.type] ?? eventTitle(event).toLowerCase(),
          title: eventTitle(event),
          label: feedLabel(event, stage),
          body: eventDetail(event, decisionsById),
          decisionId: decision ? decision.id : null,
        },
      })

      continue
    }

    const { action, target } = lineParts(event)
    const edit = event.type === 'stage.activity' ? activityEdit(event) : null

    entries.push({
      at: at.get(event.seq) ?? 0,
      entry: {
        kind: 'line',
        id: `event-${event.seq}`,
        at: String(event.createdAt),
        shape: event.type === 'stage.activity' ? 'call' : 'event',
        // The edit knows the path relative to the repository; the raw target is
        // whatever the CLI reported, which is the fallback rather than the answer.
        action,
        target: edit ? edit.path : target,
        tone: lineTone(event),
        live: live(event),
        seq: event.seq,
        edit,
      },
    })
  }

  for (const message of messages) {
    const wrote = millis(message.createdAt) ?? 0
    if (messageStep(wrote, events, at, steps, firstNodeKey) !== nodeKey) continue

    entries.push({
      at: wrote,
      entry: {
        kind: 'turn',
        id: `message-${message.id}`,
        at: String(message.createdAt),
        author: message.role === 'owner' ? 'owner' : 'guide',
        verb: message.role === 'owner' ? 'asked' : 'answered',
        title: message.role === 'owner' ? 'Message sent' : 'Guide replied',
        label: message.role === 'owner' ? 'You' : 'Guide',
        body: message.contentMd,
        decisionId: null,
      },
    })
  }

  return entries
    .sort((left, right) => left.at - right.at || left.entry.id.localeCompare(right.entry.id))
    .map((row) => row.entry)
}

/** The newest `stage.activity` each run has reported, by run. */
function newestActivityByStage(events: readonly TimelineEvent[]): Map<string, number> {
  const newest = new Map<string, number>()

  for (const event of events) {
    if (event.type !== 'stage.activity' || !event.stageId) continue

    const seen = newest.get(event.stageId)
    if (seen === undefined || event.seq > seen) newest.set(event.stageId, event.seq)
  }

  return newest
}

/** What a run is doing at this moment, in its own words. */
export interface LiveActivity {
  readonly action: string
  readonly target: string
  /** The run it belongs to, so the line remounts rather than morphs across runs. */
  readonly stageId: string
}

/**
 * The one line that stands in for every read: the newest action of a run under
 * way at this step, present tense, replaced in place as the run works and gone
 * the moment the run ends (REQ-915). A run that has started but reported
 * nothing yet still gets a line — silence at a live node reads as a hang.
 */
export function liveActivity({
  events,
  stages,
  nodeKey,
}: {
  events: readonly TimelineEvent[]
  stages: readonly Stage[]
  nodeKey: string | null
}): LiveActivity | null {
  const running = stages.find((stage) => stage.status === 'running' && stage.nodeKey === nodeKey)
  if (!running) return null

  const latest = events.reduce<TimelineEvent | null>((newest, event) => {
    if (event.type !== 'stage.activity' || event.stageId !== running.id) return newest

    return newest === null || event.seq > newest.seq ? event : newest
  }, null)
  if (!latest) return { action: 'Working', target: '', stageId: running.id }

  const { kind, target } = stageActivityParts(latest)

  return { action: kind, target, stageId: running.id }
}

/** A message carries no node of its own: it belongs to the step the task stood on when it was written. */
function messageStep(
  moment: number,
  events: readonly TimelineEvent[],
  at: ReadonlyMap<number, number>,
  steps: Map<number, string | null>,
  firstNodeKey: string | null,
): string | null {
  let latest = -1
  let step = firstNodeKey

  for (const event of events) {
    const when = at.get(event.seq) ?? 0
    if (when > moment || event.seq <= latest) continue

    latest = event.seq
    step = steps.get(event.seq) ?? step
  }

  return step
}

/** Who the turn is from: the owner, or the node that produced it. */
function feedLabel(event: TimelineEvent, stage: Stage | undefined): string {
  if (OWNER_EVENTS.has(event.type)) return 'You'
  if (stage) return nodeLabel(stage.nodeKey)

  const gate = payloadValue(event, 'gate') ?? payloadValue(event, 'nodeKey')

  return gate ? nodeLabel(gate) : 'Task'
}
