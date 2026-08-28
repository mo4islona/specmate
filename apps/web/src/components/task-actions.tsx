import { isTerminal } from '@specmate/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useLocation } from 'wouter'
import {
  deleteTask,
  type listAttention,
  type listTasks,
  renameTask,
  type TaskDetail,
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
  MenuItem,
  MenuSeparator,
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

/** What the popover is showing: the verbs, or the one being answered. */
type Mode = 'menu' | 'rename' | 'delete'

const WIDTH: Record<Mode, string> = {
  menu: '15rem',
  rename: '21rem',
  delete: '23rem',
}

/**
 * A word, not the task's title: a title runs to a full sentence, and copying one
 * out is a transcription exercise rather than the moment of thought the typing is
 * there to buy. Which task is going is the dialog's heading; this is only the
 * deliberate hand.
 */
const CONFIRMATION = 'delete'

function confirms(typed: string): boolean {
  return typed.trim().toLowerCase() === CONFIRMATION
}

/** The task-row verbs rare enough to stay behind the overflow trigger. */
export function TaskActions({ task, current }: TaskActionsProps) {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  const live = !isTerminal(task.status)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('menu')
  const [title, setTitle] = useState(task.title)
  const [confirmation, setConfirmation] = useState('')

  const rename = useMutation({
    mutationFn: (next: string) => renameTask(task.id, next),
    onSuccess: ({ task: renamed }) => {
      // Written into the caches rather than invalidated: the rail, the inbox and
      // the header the owner is reading all carry the title, and a refetch would
      // leave the old one on screen for as long as the round trip takes.
      queryClient.setQueryData<TasksCache>(queryKeys.tasks, (cached) =>
        cached
          ? { tasks: cached.tasks.map((row) => (row.id === task.id ? renamed : row)) }
          : cached,
      )
      queryClient.setQueryData<AttentionCache>(queryKeys.attention, (cached) =>
        cached
          ? {
              items: cached.items.map((item) =>
                item.task.id === task.id ? { ...item, task: renamed } : item,
              ),
            }
          : cached,
      )
      queryClient.setQueryData<TaskDetail>(queryKeys.task(task.id), (cached) =>
        cached ? { ...cached, task: renamed } : cached,
      )
      reset()
    },
  })

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
      reset()
    },
  })

  const working = rename.isPending || deletion.isPending

  function reset(): void {
    setOpen(false)
    setMode('menu')
    setConfirmation('')
    rename.reset()
    deletion.reset()
  }

  /**
   * The way out the owner takes. `reset` is the one a settled request takes, and
   * it does not ask: inside `onSuccess` the mutation still reads as pending, so a
   * guarded close would leave the popover standing over work that is already done.
   */
  function close(): void {
    if (working) return

    setTitle(task.title)
    reset()
  }

  function submitRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next = title.trim()
    if (next === '' || next === task.title || rename.isPending) return

    rename.mutate(next)
  }

  function submitDeletion(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!confirms(confirmation) || deletion.isPending) return

    deletion.mutate()
  }

  const label = {
    menu: `Actions for ${task.title}`,
    rename: `Rename ${task.title}`,
    delete: `Delete ${task.title} permanently`,
  }[mode]

  return (
    <Popover
      open={open}
      onDismiss={close}
      side="bottom"
      width={WIDTH[mode]}
      padding={mode === 'menu' ? 'menu' : 'content'}
      role={mode === 'menu' ? 'menu' : 'dialog'}
      label={label}
      trigger={
        <IconButton
          label={`More actions for ${task.title}`}
          size="icon"
          aria-expanded={open}
          disabled={working}
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
      {mode === 'menu' && (
        <div>
          <MenuItem
            onClick={() => {
              setTitle(task.title)
              setMode('rename')
            }}
          >
            Rename…
          </MenuItem>

          <MenuSeparator />

          <MenuItem tone="destructive" onClick={() => setMode('delete')}>
            Delete task permanently…
          </MenuItem>
        </div>
      )}

      {mode === 'rename' && (
        <form onSubmit={submitRename}>
          <MicroLabel>Rename task</MicroLabel>
          <Note size="xs" className="mt-2 leading-5">
            The name in the rail and on the task screen. The branch and the pull request keep the
            name they were opened under.
          </Note>

          <Field label="Title" className="mt-4">
            <Input
              autoFocus
              autoComplete="off"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>

          <RequestError error={rename.error} fallback="Rename failed" />

          <div className="mt-4 flex items-center justify-end gap-1">
            <Button variant="ghost" disabled={rename.isPending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={title.trim() === '' || title.trim() === task.title}
              pending={rename.isPending}
              pendingLabel="Saving…"
            >
              Save
            </Button>
          </div>
        </form>
      )}

      {mode === 'delete' && (
        <form onSubmit={submitDeletion}>
          <MicroLabel tone="destructive">Permanent deletion</MicroLabel>
          <h3 className="mt-2 break-words text-sm font-semibold">Delete {task.title}?</h3>
          <Note size="xs" className="mt-2 leading-5">
            {live ? 'This cancels the run, then removes' : 'This removes'} the task, thread,
            documents, decisions, and run history from SpecMate. Repository commits, branches, and
            pull requests are not changed.
          </Note>

          <Field label={`Type “${CONFIRMATION}” to confirm`} className="mt-4">
            <Input
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
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
              disabled={!confirms(confirmation)}
              pending={deletion.isPending}
              pendingLabel="Deleting…"
            >
              Delete permanently
            </Button>
          </div>
        </form>
      )}
    </Popover>
  )
}
