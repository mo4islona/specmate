import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useLocation } from 'wouter'
import {
  deleteTask,
  type listAttention,
  type listTasks,
  type TaskSummary,
} from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import {
  Button,
  cn,
  Field,
  Icon,
  IconButton,
  Input,
  MicroLabel,
  Note,
  Popover,
} from '../ui/index.ts'
import { RequestError } from './request-error.tsx'

interface TaskActionsProps {
  readonly task: TaskSummary
  readonly current: boolean
}

type TasksCache = Awaited<ReturnType<typeof listTasks>>
type AttentionCache = Awaited<ReturnType<typeof listAttention>>

/** The one task-row action rare enough to stay behind the overflow trigger. */
export function TaskActions({ task, current }: TaskActionsProps) {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const deletion = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      if (current) navigate('/')
      queryClient.setQueryData<TasksCache>(queryKeys.tasks, (cached) =>
        cached ? { tasks: cached.tasks.filter((row) => row.id !== task.id) } : cached,
      )
      queryClient.setQueryData<AttentionCache>(queryKeys.attention, (cached) =>
        cached ? { items: cached.items.filter((item) => item.task.id !== task.id) } : cached,
      )
      queryClient.removeQueries({ queryKey: queryKeys.task(task.id) })
      setOpen(false)
    },
  })

  function close(): void {
    if (deletion.isPending) return

    setOpen(false)
    setConfirming(false)
    setConfirmation('')
    deletion.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (confirmation !== task.title || deletion.isPending) return

    deletion.mutate()
  }

  return (
    <Popover
      open={open}
      onDismiss={close}
      side="bottom"
      width={confirming ? '23rem' : '15rem'}
      padding={confirming ? 'content' : 'menu'}
      role={confirming ? 'dialog' : 'menu'}
      label={confirming ? `Delete ${task.title} permanently` : `Actions for ${task.title}`}
      trigger={
        <IconButton
          label={`More actions for ${task.title}`}
          size="icon"
          aria-expanded={open}
          disabled={deletion.isPending}
          className={cn(
            'size-8 opacity-0 transition-opacity',
            'group-hover:opacity-100 group-focus-within:opacity-100',
            '[@media(hover:none)]:opacity-100',
            current && 'opacity-100',
          )}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Icon name="more" />
        </IconButton>
      }
    >
      {confirming ? (
        <form onSubmit={submit}>
          <MicroLabel tone="destructive">Permanent deletion</MicroLabel>
          <h3 className="mt-2 break-words text-sm font-semibold">Delete {task.title}?</h3>
          <Note size="xs" className="mt-2 leading-5">
            This removes the task, thread, documents, decisions, and run history from SpecMate.
            Repository commits, branches, and pull requests are not changed.
          </Note>

          <Field label={`Type “${task.title}” to confirm`} className="mt-4">
            <Input
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>

          <RequestError error={deletion.error} fallback="Task deletion failed" />

          <div className="mt-4 flex items-center justify-end gap-1">
            <Button variant="ghost" disabled={deletion.isPending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmation !== task.title}
              pending={deletion.isPending}
              pendingLabel="Deleting…"
            >
              Delete permanently
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <hr className="mb-1 border-border pt-1" />
          <Button
            role="menuitem"
            variant="ghost-destructive"
            className="w-full justify-start"
            onClick={() => setConfirming(true)}
          >
            Delete task permanently…
          </Button>
        </div>
      )}
    </Popover>
  )
}
