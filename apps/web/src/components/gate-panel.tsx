import type { ReactNode } from 'react'
import { nodeLabel } from '../lib/task-thread.ts'

interface GatePanelProps {
  readonly gateKey: string
  readonly approveTo: string
  readonly reworkTargets: readonly string[]
  /** Absent when the gate has no redirect edge; `spent` when its cap is used up. */
  readonly redirect: {
    readonly spent: boolean
    readonly used: number
    readonly limit: number
    readonly cap: string
  } | null
  readonly comment: string
  readonly onCommentChange: (value: string) => void
  readonly reworkTarget: string
  readonly onReworkTargetChange: (value: string) => void
  readonly busy: boolean
  readonly error?: string
  readonly onApprove: () => void
  readonly onRedirect: () => void
  readonly onRework: () => void
  /** The kickoff brief, when this gate is the one that decides on it. */
  readonly children?: ReactNode
}

/**
 * REQ-905/REQ-913: the one thing on the screen that is waiting on a person.
 * Approve is the visible action; sending the work back is one disclosure away,
 * since it is the rarer answer and it needs words either way.
 */
export function GatePanel({
  gateKey,
  approveTo,
  reworkTargets,
  redirect,
  comment,
  onCommentChange,
  reworkTarget,
  onReworkTargetChange,
  busy,
  error,
  onApprove,
  onRedirect,
  onRework,
  children,
}: GatePanelProps) {
  const canSendBack = reworkTargets.length > 0 || redirect !== null

  return (
    <section className="attention-pulse border border-amber/45 bg-amber/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="micro-label text-amber">Waiting on you</p>
          <h2 className="mt-1.5 text-base font-semibold">{nodeLabel(gateKey)}</h2>
        </div>
        <button type="button" className="button-primary" onClick={onApprove} disabled={busy}>
          Approve → {nodeLabel(approveTo).toLowerCase()}
        </button>
      </div>

      {children}

      {canSendBack && (
        <details className="mt-4 border-t border-amber/20 pt-3">
          <summary className="cursor-pointer font-mono text-[0.7rem] uppercase tracking-widest text-muted hover:text-text">
            Send it back…
          </summary>

          <textarea
            className="control mt-3 min-h-20 w-full resize-y"
            value={comment}
            onChange={(event) => onCommentChange(event.currentTarget.value)}
            placeholder="What has to change? Redirect and rework both need this."
            aria-label="Gate comment"
          />

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            {redirect &&
              (redirect.spent ? (
                <p className="font-mono text-xs text-muted" role="status">
                  Redirect unavailable: {redirect.used} of {redirect.limit}{' '}
                  {redirect.cap.replaceAll('_', ' ')} used.
                </p>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={!comment.trim() || busy}
                  onClick={onRedirect}
                >
                  Redirect
                </button>
              ))}

            {reworkTargets.length > 0 && (
              <>
                <select
                  className="control sm:w-44"
                  value={reworkTarget}
                  onChange={(event) => onReworkTargetChange(event.currentTarget.value)}
                  aria-label="Rework target"
                >
                  <option value="">Rework target…</option>
                  {reworkTargets.map((target) => (
                    <option key={target} value={target}>
                      {nodeLabel(target).toLowerCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button-danger"
                  disabled={!comment.trim() || !reworkTarget || busy}
                  onClick={onRework}
                >
                  Request rework
                </button>
              </>
            )}
          </div>
        </details>
      )}

      {error && <p className="field-error">{error}</p>}
    </section>
  )
}
