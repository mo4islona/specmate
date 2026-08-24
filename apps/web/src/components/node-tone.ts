import type { NodeState } from '../lib/task-pipeline.ts'

/** One colour per node state, read the same in the rail and over the step it heads. */
export const NODE_DOT: Record<NodeState, string> = {
  done: 'bg-border-bright',
  running: 'bg-accent dot-live',
  awaiting: 'bg-attention dot-live',
  stopped: 'bg-danger',
  skipped: 'border border-border-bright bg-ground',
  pending: 'border border-border-bright bg-ground',
}

export const NODE_NAME: Record<NodeState, string> = {
  done: 'text-text',
  running: 'font-medium text-accent',
  awaiting: 'font-medium text-attention',
  stopped: 'font-medium text-danger',
  skipped: 'text-muted',
  pending: 'text-muted',
}

/**
 * The state as a mark rather than a word. `passed` and `stopped` written out
 * beside a coloured dot were the dot's own meaning spelled again, in the column
 * meant for what the node actually cost.
 */
export const NODE_MARK: Record<NodeState, { glyph: string; classes: string; label: string }> = {
  done: { glyph: '✓', classes: 'text-success', label: 'done' },
  running: { glyph: '●', classes: 'dot-live text-accent', label: 'running' },
  awaiting: { glyph: '?', classes: 'text-attention', label: 'waiting on you' },
  stopped: { glyph: '✕', classes: 'text-danger', label: 'stopped' },
  skipped: { glyph: '–', classes: 'text-muted', label: 'skipped' },
  pending: { glyph: '○', classes: 'text-muted', label: 'not started' },
}
