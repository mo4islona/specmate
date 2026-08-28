import { isHumanGate, type TaskState } from '@specmate/core'
import type { StreamConnectionState } from '../lib/event-stream.ts'
import type { ConsoleTone } from '../lib/task-console.ts'
import type { NodeState } from '../lib/task-pipeline.ts'
import type { StateTone } from '../lib/task-state.ts'
import type { BadgeTone, IconName } from '../ui/index.ts'

/**
 * Every colour the app lights outside its own kit, in one place.
 *
 * Four state vocabularies used to keep their own tone maps — the pipeline's
 * node, the task index's badge, the header's sentence, the console's slab — and
 * no two of them agreed. `done` was a green ✓ in the rail, a grey dot over the
 * step it headed, and a cyan pill in the index; the same finished step wore
 * three colours depending on which component happened to draw it.
 *
 * So the four vocabularies now reduce to one. A state is not a hue, it is a
 * *signal*, and there are five of them. Each surface says which signal its own
 * state is; this file is the only thing that knows what a signal looks like, and
 * `kit-discipline.test.ts` is what keeps it that way.
 *
 * The budget itself — why `info` and `success` are not here at all — is written
 * out at the top of `index.css`.
 */
export type Signal =
  /** Moving right now. */
  | 'live'
  /** Waiting on the owner. */
  | 'asking'
  /** It failed. */
  | 'stopped'
  /** It finished, and nobody needs to look at it again. */
  | 'settled'
  /** It has not started, or it never will. */
  | 'idle'

const SIGNAL_TEXT: Record<Signal, string> = {
  live: 'text-primary',
  asking: 'text-warning',
  stopped: 'text-destructive',
  settled: 'text-foreground',
  idle: 'text-muted-foreground',
}

/**
 * Filled, for a list dense enough that a ring would close up. The colour only —
 * whether the mark also breathes is the caller's to say. See `signalBreathes`.
 */
const SIGNAL_DOT: Record<Signal, string> = {
  live: 'bg-primary',
  asking: 'bg-warning',
  stopped: 'bg-destructive',
  settled: 'bg-border-strong',
  idle: 'bg-muted-foreground',
}

/** A signal loud enough to be worth a heavier word than its neighbours. */
const SIGNAL_WEIGHT: Record<Signal, string> = {
  live: 'font-medium',
  asking: 'font-medium',
  stopped: 'font-medium',
  settled: '',
  idle: '',
}

export function signalText(signal: Signal): string {
  return SIGNAL_TEXT[signal]
}

export function signalDot(signal: Signal): string {
  return SIGNAL_DOT[signal]
}

/**
 * Which signals breathe: something moving, and the thing waiting on the owner.
 * Both are worth the eye, and a group heading is not — it is a word you read
 * once and then stop seeing, which is why a task holding a gate open has to say
 * so on its own row.
 *
 * The caller still decides, because a mark only breathes where it stands for the
 * row's own state: the step you are already reading is marked as where you are,
 * not as what it is doing.
 */
export function signalBreathes(signal: Signal): boolean {
  return signal === 'live' || signal === 'asking'
}

/** The signal as a name: the colour, and the weight that goes with it. */
export function signalName(signal: Signal): string {
  const weight = SIGNAL_WEIGHT[signal]

  return weight ? `${weight} ${SIGNAL_TEXT[signal]}` : SIGNAL_TEXT[signal]
}

// ── The pipeline ────────────────────────────────────────────────────────────

const NODE_SIGNAL: Record<NodeState, Signal> = {
  done: 'settled',
  running: 'live',
  awaiting: 'asking',
  stopped: 'stopped',
  skipped: 'idle',
  pending: 'idle',
}

export function nodeSignal(state: NodeState): Signal {
  return NODE_SIGNAL[state]
}

export function nodeName(state: NodeState): string {
  return signalName(NODE_SIGNAL[state])
}

/**
 * A node that has not run is a ring rather than a dot — the difference between
 * "nothing here yet" and "settled" is a fact about the walk, and it is the one
 * distinction the grey ramp cannot carry on its own.
 */
export function nodeDot(state: NodeState): string {
  if (state === 'pending' || state === 'skipped') return 'border border-border-strong bg-background'

  return SIGNAL_DOT[NODE_SIGNAL[state]]
}

/** Whose step is behind the run, and so wears the colour it earned. */
export function nodeLit(state: NodeState): boolean {
  return state === 'done'
}

/**
 * The state as a mark rather than a word. `passed` and `stopped` written out
 * beside a coloured dot were the dot's own meaning spelled again, in the column
 * meant for what the node actually cost.
 */
export const NODE_MARK: Record<NodeState, { icon: IconName; label: string }> = {
  done: { icon: 'check', label: 'done' },
  running: { icon: 'running', label: 'running' },
  awaiting: { icon: 'waiting', label: 'waiting on you' },
  stopped: { icon: 'close', label: 'stopped' },
  skipped: { icon: 'skipped', label: 'skipped' },
  pending: { icon: 'pending', label: 'not started' },
}

/**
 * A step that has not started is quieter than the walk that reached it. The rail
 * reads top to bottom as a sequence, and what is still ahead should not compete
 * for the eye with where the run actually is — the grey ramp alone was not
 * enough separation once every row carried a drawn mark rather than a character.
 */
export function nodeAhead(state: NodeState): string {
  return state === 'pending' ? 'opacity-60' : ''
}

/**
 * The face's own classes, for the faces that have no colour of their own — the
 * person and the app. A vendor's logo answers for itself and ignores all of it.
 *
 * `settled` is the page's own text rather than the grey `signalName` gives a
 * finished row. It is the same idea a lit logo is: a gate you have already been
 * through should read as crisp as the steps around it that landed, and only what
 * is still ahead should be faint.
 *
 * Both signals worth the eye breathe, not just the moving one — a gate holding
 * the run open has nothing left to say "you" with except the amber on the person
 * and the breath under it.
 */
export function nodeMarkClass(state: NodeState): string {
  const signal = NODE_SIGNAL[state]
  const live = signalBreathes(signal) ? 'animate-breath ' : ''

  return `${live}${signal === 'settled' ? 'text-foreground' : SIGNAL_TEXT[signal]}`
}

// ── The task, as the index and the header read it ───────────────────────────

/** Where a task's state sits in the kit's badge vocabulary. */
export function statusTone(status: TaskState): BadgeTone {
  if (isHumanGate(status) || status === 'waiting_human') return 'parked'
  if (status === 'failed' || status === 'blocked') return 'failed'
  if (status === 'archived' || status === 'cancelled') return 'done'
  if (status === 'draft' || status === 'paused') return 'muted'

  return 'active'
}

const BADGE_SIGNAL: Record<BadgeTone, Signal> = {
  active: 'live',
  parked: 'asking',
  failed: 'stopped',
  done: 'settled',
  muted: 'idle',
  warning: 'asking',
}

/** The same tone as a mark rather than a pill, for lists too dense to carry chips. */
export function toneDot(tone: BadgeTone): string {
  return SIGNAL_DOT[BADGE_SIGNAL[tone]]
}

const STATE_SIGNAL: Record<StateTone, Signal> = {
  running: 'live',
  attention: 'asking',
  stopped: 'stopped',
  done: 'settled',
}

export function stateSignal(tone: StateTone): Signal {
  return STATE_SIGNAL[tone]
}

// ── The console ─────────────────────────────────────────────────────────────

const CONSOLE_SIGNAL: Record<ConsoleTone, Signal> = {
  asking: 'asking',
  running: 'live',
  stopped: 'stopped',
  spent: 'idle',
  plain: 'idle',
}

export function consoleSignal(tone: ConsoleTone): Signal {
  return CONSOLE_SIGNAL[tone]
}

// ── The connection light ────────────────────────────────────────────────────

const STREAM_SIGNAL: Record<StreamConnectionState, Signal> = {
  live: 'live',
  connecting: 'asking',
  stale: 'stopped',
}

export function streamSignal(state: StreamConnectionState): Signal {
  return STREAM_SIGNAL[state]
}
