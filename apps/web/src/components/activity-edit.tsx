import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { memo, useState } from 'react'
import { getActivityPatch } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { type ActivityEdit, editSummary } from '../lib/task-thread.ts'
import { Diff, Icon, IconButton, Working } from '../ui/index.ts'
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
export const ActivityEditBlock = memo(function ActivityEditBlock({
  taskId,
  seq,
  edit,
  onOpenFile,
}: ActivityEditBlockProps) {
  const [expanded, setExpanded] = useState(false)
  // The whole patch is a read of its own, so it is fetched only once the owner
  // asks for it — never as part of drawing the record.
  const whole = useQuery({
    queryKey: queryKeys.activityPatch(taskId, seq),
    queryFn: ({ signal }) => getActivityPatch(taskId, seq, signal),
    enabled: expanded,
  })
  const hasMore = edit.clamped || edit.truncated
  const diff = (expanded ? whole.data?.patch : null) ?? edit.preview

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

      {/* The controls hang off this frame rather than off the diff, and the diff
          is the thing that scrolls: an absolute child of a scrolling box rides
          the code sideways and out of the corner it was put in. */}
      <div className="group/edit relative mt-1 ml-4 min-w-0">
        {/* No height of its own, and so no scrollbar of its own: a box that
            scrolls inside the thread's own scroll is a wheel that stops when it
            crosses code. The record is one column, and it is what scrolls. */}
        <Diff diff={diff} path={edit.path} lineNumbers={edit.anchored} className="scroll-thin" />

        {/* Quiet until asked for. Two glyphs over every edit in a step is the
            noise the row of words under them was. */}
        <span className="absolute top-1 right-1 flex gap-1 opacity-40 transition-opacity focus-within:opacity-100 group-hover/edit:opacity-100">
          {hasMore && (
            <IconButton
              label={expanded ? 'Clamp the edit back' : 'Show the whole edit'}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Icon name="fold" /> : <Icon name="unfold" />}
            </IconButton>
          )}

          {onOpenFile && (
            <IconButton label="Open the file's diff" onClick={() => onOpenFile(edit.path)}>
              <Icon name="expand" />
            </IconButton>
          )}
        </span>
      </div>

      <WholeEditNote expanded={expanded} edit={edit} whole={whole} />
    </div>
  )
})

type WholeEdit = ReturnType<typeof useQuery<{ seq: number; patch: string | null }>>

/**
 * The one line the glyphs cannot carry, and only where there is something to
 * say. An event recorded before its whole patch was kept answers with nothing,
 * and saying so is the difference between an answer and a control that appears
 * to do nothing.
 */
function WholeEditNote({
  expanded,
  edit,
  whole,
}: {
  expanded: boolean
  edit: ActivityEdit
  whole: WholeEdit
}): ReactNode {
  if (!expanded) return null

  const said = (): ReactNode => {
    if (whole.isPending) return <Working>reading the whole edit…</Working>
    if (whole.isError) {
      return <span className={signalText('stopped')}>The whole edit is unavailable.</span>
    }
    if (whole.data.patch === null) return 'this edit was recorded before its whole text was kept'
    if (edit.truncated) return 'this edit was too large to record whole'

    return null
  }

  const note = said()

  return note === null ? null : <p className="mt-1 ml-4 text-[0.68rem] text-muted">{note}</p>
}
