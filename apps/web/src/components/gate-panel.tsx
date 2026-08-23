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
  /** The console's own text: at a gate, what the owner types is the gate comment (REQ-921). */
  readonly comment: string
  readonly reworkTarget: string
  readonly onReworkTargetChange: (value: string) => void
  readonly busy: boolean
  readonly error?: string
  readonly onApprove: () => void
  readonly onRedirect: () => void
  readonly onRework: () => void
}

/**
 * REQ-905: the gate's own verbs, beside the one input rather than around a
 * second one. Approve is the visible action; sending the work back is one
 * disclosure away, since it is the rarer answer — and it needs words, which
 * the console is already collecting.
 */
export function GatePanel({
  gateKey,
  approveTo,
  reworkTargets,
  redirect,
  comment,
  reworkTarget,
  onReworkTargetChange,
  busy,
  error,
  onApprove,
  onRedirect,
  onRework,
}: GatePanelProps) {
  const canSendBack = reworkTargets.length > 0 || redirect !== null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="button-primary min-h-9 py-1"
        onClick={onApprove}
        disabled={busy}
      >
        Approve → {nodeLabel(approveTo).toLowerCase()}
      </button>

      {canSendBack && (
        <details className="relative">
          <summary className="cursor-pointer px-2 py-1 font-mono text-[0.66rem] uppercase tracking-widest text-muted hover:text-text">
            Send it back…
          </summary>

          <div className="absolute bottom-full right-0 z-10 mb-2 w-72 border border-amber/35 bg-surface p-3">
            <p className="font-mono text-[0.62rem] leading-4 text-muted">
              {nodeLabel(gateKey)} · both need the comment you are typing.
            </p>

            <div className="mt-3 flex flex-col gap-2">
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
                    className="control"
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
          </div>
        </details>
      )}

      {error && <p className="field-error w-full">{error}</p>}
    </div>
  )
}
