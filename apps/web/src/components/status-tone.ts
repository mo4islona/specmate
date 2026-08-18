/** The small, shared vocabulary of visual tones a status badge can carry. */
export type StatusTone = 'active' | 'parked' | 'failed' | 'done' | 'muted' | 'warning'

const TONE_CLASSES: Record<StatusTone, string> = {
  active: 'border-status-active/40 bg-status-active/10 text-status-active',
  parked: 'border-status-parked/45 bg-status-parked/10 text-status-parked',
  failed: 'border-status-failed/45 bg-status-failed/10 text-status-failed',
  done: 'border-status-done/40 bg-status-done/10 text-status-done',
  muted: 'border-muted/35 bg-muted/5 text-muted',
  warning: 'border-amber/45 bg-amber/10 text-amber',
}

export function toneClasses(tone: StatusTone): string {
  return TONE_CLASSES[tone]
}

/** The pill markup `StatusChip` and `HarnessBadge` both render, tone classes appended by the caller. */
export const STATUS_BADGE_BASE_CLASSES =
  'inline-flex max-w-full items-center border px-2 py-1 font-mono text-[0.65rem] uppercase tracking-[0.12em]'
