import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getActivityPatch } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { type ActivityEdit, editSummary } from '../lib/task-thread.ts'
import { Diff, TextButton } from '../ui/index.ts'
import { signalText } from './tone.ts'

interface ActivityEditBlockProps {
  readonly taskId: string
  /** The event's own cursor — the address its whole patch is read at (REQ-1018). */
  readonly seq: number
  readonly edit: ActivityEdit
  /** Opens the file's whole diff on the task branch, where the surface offers one. */
  readonly onOpenFile?: (path: string) => void
}

/**
 * What one file-editing tool use changed, under the line that named it. The
 * counts sit on the same branch a sentence's particulars hang from, and the
 * diff is the body: a record saying a file was written, and not what it now
 * says, is a record of nothing (REQ-915).
 */
export function ActivityEditBlock({ taskId, seq, edit, onOpenFile }: ActivityEditBlockProps) {
  const [expanded, setExpanded] = useState(false)
  // The whole patch is a read of its own, so it is fetched only once the owner
  // asks for it — never as part of drawing the record.
  const whole = useQuery({
    queryKey: queryKeys.activityPatch(taskId, seq),
    queryFn: ({ signal }) => getActivityPatch(taskId, seq, signal),
    enabled: expanded,
  })
  const hasMore = edit.clamped || edit.truncated
  const diff = expanded ? (whole.data?.patch ?? edit.preview) : edit.preview

  return (
    <div className="min-w-0 pl-2">
      <p className="flex items-baseline gap-2 text-muted">
        <span className="shrink-0" aria-hidden="true">
          └
        </span>
        <span className="min-w-0 break-words">
          {editSummary(edit)}
          {!edit.anchored && (
            <span className="ml-2 opacity-70" title="The file could not be read to place this edit">
              · position unknown
            </span>
          )}
        </span>
      </p>

      <Diff
        diff={diff}
        lineNumbers={edit.anchored}
        className="scroll-thin mt-1 max-h-96 overflow-auto pl-4"
      />

      <p className="flex flex-wrap items-baseline gap-x-3 pl-4 text-[0.68rem] text-muted">
        {hasMore &&
          (expanded ? (
            <>
              {whole.isPending && <span>loading the whole edit…</span>}
              {whole.isError && (
                <span className={signalText('stopped')}>The whole edit is unavailable.</span>
              )}
              {edit.truncated && whole.data && <span>this edit was too large to record whole</span>}
              <TextButton onClick={() => setExpanded(false)}>clamp it back</TextButton>
            </>
          ) : (
            <TextButton onClick={() => setExpanded(true)}>show the whole edit →</TextButton>
          ))}

        {onOpenFile && (
          <TextButton onClick={() => onOpenFile(edit.path)}>open the file's diff →</TextButton>
        )}
      </p>
    </div>
  )
}
