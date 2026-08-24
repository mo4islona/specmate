import { useState } from 'react'
import { nodeLabel } from '../lib/task-thread.ts'
import { Button, buttonClass, ErrorNote, Popover, Select } from '../ui/index.ts'

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
  const [reworking, setReworking] = useState(false)

  if (reworkTargets.length === 0 && redirect === null) return null

  return (
    <>
      {reworkTargets.length > 0 && (
        <Popover
          open={reworking}
          onDismiss={() => setReworking(false)}
          width="19rem"
          role="dialog"
          label="Request rework"
          trigger={
            <Button
              variant="ghost"
              aria-expanded={reworking}
              onClick={() => setReworking(!reworking)}
            >
              Rework ⌄
            </Button>
          }
        >
          <p className="text-[0.78rem] leading-6 text-muted">
            {nodeLabel(gateKey)} · rework needs the comment you are typing.
          </p>

          <Select
            className="mt-3"
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
          </Select>

          <Button
            variant="danger"
            className="mt-2.5 w-full"
            disabled={!comment.trim() || !reworkTarget || busy}
            onClick={onRework}
          >
            Request rework
          </Button>
        </Popover>
      )}

      {redirect &&
        (redirect.spent ? (
          // A span rather than a disabled button: nothing happens here, and what
          // it reports — the cap, and that it is used up — is a status.
          <span
            className={`${buttonClass('ghost')} cursor-not-allowed opacity-45`}
            title={`${redirect.used} of ${redirect.limit} ${redirect.cap.replaceAll('_', ' ')} used`}
            role="status"
          >
            Redirect spent
          </span>
        ) : (
          <Button
            variant="ghost"
            disabled={!comment.trim() || busy}
            onClick={onRedirect}
            title={comment.trim() ? undefined : 'Redirecting needs a comment'}
          >
            Redirect
          </Button>
        ))}

      {error && <ErrorNote className="w-full px-2.5">{error}</ErrorNote>}
    </>
  )
}
