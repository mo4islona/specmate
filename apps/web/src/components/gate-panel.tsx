import { nodeLabel } from '../lib/task-thread.ts'

interface GateVerbsProps {
  readonly gateKey: string
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
  readonly onRedirect: () => void
  readonly onRework: () => void
}

/**
 * REQ-905: the gate's own verbs, in the console's footer beside the one input.
 * Approving is the console's primary button; sending the work back is quieter,
 * since it is the rarer answer — and it needs words, which the input is already
 * collecting.
 */
export function GateVerbs({
  gateKey,
  reworkTargets,
  redirect,
  comment,
  reworkTarget,
  onReworkTargetChange,
  busy,
  error,
  onRedirect,
  onRework,
}: GateVerbsProps) {
  if (reworkTargets.length === 0 && redirect === null) return null

  return (
    <>
      {reworkTargets.length > 0 && (
        <details className="relative">
          <summary className="button-ghost cursor-pointer list-none">Rework ⌄</summary>

          <div className="absolute bottom-full left-0 z-10 mb-2 w-72 border border-amber/35 bg-surface p-3">
            <p className="font-mono text-[0.62rem] leading-4 text-muted">
              {nodeLabel(gateKey)} · rework needs the comment you are typing.
            </p>

            <select
              className="control mt-3 w-full"
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
              className="button-danger mt-2 w-full"
              disabled={!comment.trim() || !reworkTarget || busy}
              onClick={onRework}
            >
              Request rework
            </button>
          </div>
        </details>
      )}

      {redirect &&
        (redirect.spent ? (
          <span
            className="button-ghost cursor-not-allowed opacity-50"
            title={`${redirect.used} of ${redirect.limit} ${redirect.cap.replaceAll('_', ' ')} used`}
            role="status"
          >
            Redirect spent
          </span>
        ) : (
          <button
            type="button"
            className="button-ghost"
            disabled={!comment.trim() || busy}
            onClick={onRedirect}
            title={comment.trim() ? undefined : 'Redirecting needs a comment'}
          >
            Redirect
          </button>
        ))}

      {error && <p className="field-error w-full">{error}</p>}
    </>
  )
}
