import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'wouter'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { StatusChip } from '../components/status-chip.tsx'
import { TelemetryChart } from '../components/telemetry-chart.tsx'
import { mergeTimelineEvents, useTaskStream } from '../hooks/use-task-stream.ts'
import {
  approveGate,
  getTask,
  listEvents,
  postFeedback,
  type ReworkInput,
  redirectGate,
  reworkGate,
  type TimelineEvent,
  type TimelineResponse,
} from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'

interface TaskScreenProps {
  taskId: string
}

const EVENT_TITLES: Record<string, string> = {
  'task.created': 'Task launched',
  'task.transitioned': 'Task moved',
  'task.parked': 'Task parked',
  'task.failed': 'Task failed',
  'stage.started': 'Stage started',
  'stage.completed': 'Stage completed',
  'stage.failed': 'Stage failed',
  'gate.approved': 'Gate approved',
  'gate.redirected': 'Task redirected',
  'gate.reworked': 'Rework requested',
  'feedback.comment': 'Owner comment',
}

function payloadValue(event: TimelineEvent, key: string): string | null {
  const value = event.payload[key]

  return typeof value === 'string' && value.length > 0 ? value : null
}

function eventDetail(event: TimelineEvent): string {
  return (
    payloadValue(event, 'comment') ??
    payloadValue(event, 'reason') ??
    payloadValue(event, 'detail') ??
    payloadValue(event, 'title') ??
    payloadValue(event, 'to') ??
    'State recorded in the task ledger.'
  )
}

function connectionClasses(connection: string): string {
  if (connection === 'live') return 'bg-status-active text-status-active'
  if (connection === 'connecting') return 'bg-amber text-amber'

  return 'bg-danger text-danger'
}

function mergeEventResponses(
  previous: TimelineResponse | undefined,
  current: TimelineResponse,
): TimelineResponse {
  let merged = previous?.events ?? []
  for (const event of current.events) {
    merged = mergeTimelineEvents(merged, event)
  }

  return { events: merged }
}

export function TaskScreen({ taskId }: TaskScreenProps) {
  const queryClient = useQueryClient()
  const detail = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: ({ signal }) => getTask(taskId, signal),
  })
  const timeline = useQuery({
    queryKey: queryKeys.events(taskId),
    queryFn: ({ signal }) => listEvents(taskId, signal),
    structuralSharing: (previous, current) =>
      mergeEventResponses(previous as TimelineResponse | undefined, current as TimelineResponse),
  })
  const connection = useTaskStream(taskId)
  const [comment, setComment] = useState('')
  const [stageId, setStageId] = useState('')
  const [gateComment, setGateComment] = useState('')
  const [reworkTarget, setReworkTarget] = useState<ReworkInput['target'] | ''>('')

  async function refreshTask(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
      queryClient.invalidateQueries({ queryKey: queryKeys.events(taskId) }),
    ])
  }

  const approve = useMutation({ mutationFn: () => approveGate(taskId), onSuccess: refreshTask })
  const redirect = useMutation({
    mutationFn: () => redirectGate(taskId, { comment: gateComment.trim() }),
    onSuccess: async () => {
      setGateComment('')
      setReworkTarget('')
      await refreshTask()
    },
  })
  const rework = useMutation({
    mutationFn: () => {
      if (!reworkTarget) throw new Error('Choose a rework target')

      return reworkGate(taskId, { target: reworkTarget, comment: gateComment.trim() })
    },
    onSuccess: async () => {
      setGateComment('')
      await refreshTask()
    },
  })
  const feedback = useMutation({
    mutationFn: () =>
      postFeedback(taskId, {
        comment: comment.trim(),
        ...(stageId ? { stageId } : {}),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData<TimelineResponse>(queryKeys.events(taskId), (current) => ({
        events: mergeTimelineEvents(current?.events ?? [], result.event),
      }))
      setComment('')
      setStageId('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention })
    },
  })

  if (detail.isPending || timeline.isPending) {
    return <LoadingState title="Loading task channel…" />
  }
  if (detail.isError) {
    return <ErrorState title="Task unavailable" detail={detail.error.message} />
  }
  if (timeline.isError) {
    return <ErrorState title="Timeline unavailable" detail={timeline.error.message} />
  }

  const currentGate = detail.data.graph?.dag.nodes.find(
    (node) => node.kind === 'gate' && node.key === detail.data.task.status,
  )
  const reworkTargets = currentGate?.kind === 'gate' ? (currentGate.rework ?? []) : []
  const gateError = approve.error ?? redirect.error ?? rework.error
  const gateBusy = approve.isPending || redirect.isPending || rework.isPending

  function submitComment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!comment.trim()) return
    feedback.mutate()
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip status={detail.data.task.status} />
              <span className="font-mono text-xs text-muted">{detail.data.task.slug}</span>
            </div>
            <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
              {detail.data.task.title}
            </h1>
            <p className="mt-3 break-all font-mono text-xs leading-6 text-muted">
              {detail.data.task.repoUrl} · {detail.data.task.baseBranch}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/tasks/${taskId}/artifacts`} className="button-secondary">
              Read artifacts
            </Link>
            <span className="flex items-center gap-2 border border-border px-3 py-2 font-mono text-xs text-muted">
              <span
                className={`h-2 w-2 rounded-full ${connectionClasses(connection)}`}
                aria-hidden="true"
              />
              stream {connection}
            </span>
          </div>
        </div>
      </header>

      {currentGate?.kind === 'gate' && (
        <section className="panel attention-pulse border-amber/45 p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <p className="micro-label text-amber">Human gate</p>
              <h2 className="mt-2 text-lg font-semibold">{currentGate.key.replaceAll('_', ' ')}</h2>
            </div>
            <button
              type="button"
              className="button-primary"
              onClick={() => approve.mutate()}
              disabled={gateBusy}
            >
              Approve → {currentGate.approve.replaceAll('_', ' ')}
            </button>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              className="control min-h-24 w-full resize-y"
              value={gateComment}
              onChange={(event) => setGateComment(event.currentTarget.value)}
              placeholder="Required context for redirect or rework…"
              aria-label="Gate comment"
            />
            <div className="flex min-w-48 flex-col gap-2">
              {currentGate.redirect && (
                <button
                  type="button"
                  className="button-secondary border-amber/45 text-amber"
                  disabled={!gateComment.trim() || gateBusy}
                  onClick={() => redirect.mutate()}
                >
                  Redirect
                </button>
              )}
              {reworkTargets.length > 0 && (
                <>
                  <select
                    className="control w-full"
                    value={reworkTarget}
                    onChange={(event) =>
                      setReworkTarget(event.currentTarget.value as ReworkInput['target'])
                    }
                    aria-label="Rework target"
                  >
                    <option value="">Rework target…</option>
                    {reworkTargets.map((target) => (
                      <option key={target} value={target}>
                        {target.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button-danger"
                    disabled={!gateComment.trim() || !reworkTarget || gateBusy}
                    onClick={() => rework.mutate()}
                  >
                    Request rework
                  </button>
                </>
              )}
            </div>
          </div>
          {gateError && <p className="field-error mt-3">{gateError.message}</p>}
        </section>
      )}

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
        <section className="panel min-w-0 p-4 sm:p-5">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
            <div>
              <p className="micro-label text-phosphor">Live ledger</p>
              <h2 className="mt-2 text-lg font-semibold">Timeline</h2>
            </div>
            <span className="font-mono text-xs text-muted">
              {timeline.data.events.length} events
            </span>
          </div>

          {connection === 'stale' && (
            <p className="mt-4 border border-danger/35 bg-danger/10 p-3 text-sm text-danger">
              Live connection is stale. Reconnecting from the last event cursor.
            </p>
          )}

          <ol className="mt-2 divide-y divide-border">
            {timeline.data.events.map((event) => {
              const stage = payloadValue(event, 'nodeKey') ?? payloadValue(event, 'stage')

              return (
                <li key={event.seq} className="grid gap-2 py-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <div className="font-mono text-[0.68rem] leading-5 text-muted">
                    <p>#{event.seq}</p>
                    <time dateTime={String(event.createdAt)}>
                      {formatTimestamp(event.createdAt)}
                    </time>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{EVENT_TITLES[event.type] ?? event.type}</h3>
                      {stage && (
                        <span className="border border-cyan/30 px-1.5 py-0.5 font-mono text-[0.64rem] text-cyan">
                          {stage}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                      {eventDetail(event)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {timeline.data.events.length === 0 && (
            <p className="py-12 text-center text-sm text-muted">No events recorded yet.</p>
          )}
        </section>

        <TelemetryChart stages={detail.data.stages} />
      </div>

      <form className="panel sticky bottom-3 z-10 p-4 sm:p-5" onSubmit={submitComment}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <textarea
            className="control min-h-24 min-w-0 flex-1 resize-y"
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            placeholder="Comment on the task while it runs…"
            aria-label="Task comment"
          />
          <div className="flex flex-col gap-2 sm:w-56">
            <select
              className="control w-full"
              value={stageId}
              onChange={(event) => setStageId(event.currentTarget.value)}
              aria-label="Pin comment to stage"
            >
              <option value="">Whole task</option>
              {detail.data.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.nodeKey} #{stage.attempt}
                </option>
              ))}
            </select>
            <button
              className="button-primary w-full"
              type="submit"
              disabled={!comment.trim() || feedback.isPending}
            >
              {feedback.isPending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
        {feedback.error && <p className="field-error mt-3">{feedback.error.message}</p>}
      </form>
    </div>
  )
}
