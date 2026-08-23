import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { DecisionOptions } from '../components/decision-options.tsx'
import { GateVerbs } from '../components/gate-panel.tsx'
import type { RailSub } from '../components/pipeline-rail.tsx'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { StopControl } from '../components/run-controls.tsx'
import { RunLog } from '../components/run-log.tsx'
import { type OpenQuestion, TaskComposer } from '../components/task-composer.tsx'
import { TaskRail } from '../components/task-rail.tsx'
import { ThreadView } from '../components/thread-view.tsx'
import { mergeTimelineEvents } from '../hooks/use-task-stream.ts'
import {
  answerDecision,
  approveGate,
  type ConversationResponse,
  confirmConversationAction,
  createConversation,
  type DecisionItem,
  dismissDecision,
  getConversation,
  getTask,
  listConversations,
  listDecisions,
  listEvents,
  postConversationMessage,
  postFeedback,
  type ReworkInput,
  redirectGate,
  restartStage,
  reworkGate,
  type StopStageInput,
  stopStage,
  type TimelineResponse,
} from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { consoleDestination } from '../lib/task-console.ts'
import { bindingBaseline, buildPipelineNodes } from '../lib/task-pipeline.ts'
import {
  buildFeed,
  countGateRedirects,
  nodeLabel,
  payloadValue,
  stageActivityLabel,
  visibleTimelineEvents,
} from '../lib/task-thread.ts'

interface TaskScreenProps {
  taskId: string
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
  const conversations = useQuery({
    queryKey: queryKeys.conversations(taskId),
    queryFn: () => listConversations(taskId),
  })
  const decisions = useQuery({
    queryKey: queryKeys.decisions(taskId),
    queryFn: () => listDecisions(taskId),
  })
  // Tracks a conversation created by this session the instant its id is
  // known, so the very first message doesn't wait on a list refetch to
  // remount the conversation query on the right key (see converse.onSuccess).
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined)
  const conversationId = activeConversationId ?? conversations.data?.conversations[0]?.id
  const conversation = useQuery({
    queryKey: queryKeys.conversation(taskId, conversationId ?? 'none'),
    queryFn: () => getConversation(taskId, conversationId ?? ''),
    enabled: Boolean(conversationId),
  })
  const [comment, setComment] = useState('')
  const [reworkTarget, setReworkTarget] = useState<ReworkInput['target'] | ''>('')
  // The node whose run log is open over the thread — null while the thread is
  // what the owner is reading, which is most of the time.
  const [openNode, setOpenNode] = useState<string | null>(null)
  // Which of the open questions the console is showing. Reset by its own pager,
  // and clamped below in case the one being answered resolves out from under it.
  const [questionIndex, setQuestionIndex] = useState(0)
  // answerOption, answerText, and dismiss are one mutation instance each,
  // shared by every open decision on this task — react-query's own
  // isPending/variables/error reflect only the most recently dispatched
  // call, so per-decision busy/error state is tracked here instead, fed by
  // each mutation's per-invocation onMutate/onSuccess/onError callbacks.
  const [decisionActivity, setDecisionActivity] = useState<
    Record<string, { pending: boolean; error?: string }>
  >({})

  const threadRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottom = useRef(true)
  const lastSeq = timeline.data?.events.at(-1)?.seq ?? 0
  const messageCount = conversation.data?.messages.length ?? 0

  // A thread reads from the bottom: new activity scrolls into view unless the
  // owner has deliberately scrolled up into the history.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the counts are the trigger, not an input — the effect runs *because* a new event or message arrived.
  useEffect(() => {
    const node = threadRef.current
    if (!node || !pinnedToBottom.current) return

    node.scrollTop = node.scrollHeight
  }, [lastSeq, messageCount])

  function markDecisionPending(decisionId: string): void {
    setDecisionActivity((prev) => ({ ...prev, [decisionId]: { pending: true } }))
  }
  function markDecisionSettled(decisionId: string, error?: string): void {
    setDecisionActivity((prev) => ({ ...prev, [decisionId]: { pending: false, error } }))
  }

  async function refreshTask(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
      queryClient.invalidateQueries({ queryKey: queryKeys.events(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.decisions(taskId) }),
    ])
  }

  // The approve endpoint takes no comment, so the words the console collected are
  // recorded against the task before the gate moves — otherwise "say why, if it
  // needs saying" is an invitation to type into nothing.
  const approve = useMutation({
    mutationFn: async () => {
      const note = comment.trim()
      if (note) await postFeedback(taskId, { comment: note })

      return approveGate(taskId)
    },
    onSuccess: async () => {
      setComment('')
      await refreshTask()
    },
  })
  const redirect = useMutation({
    mutationFn: () => redirectGate(taskId, { comment: comment.trim() }),
    onSuccess: async () => {
      setComment('')
      setReworkTarget('')
      await refreshTask()
    },
  })
  const rework = useMutation({
    mutationFn: () => {
      if (!reworkTarget) throw new Error('Choose a rework target')

      return reworkGate(taskId, { target: reworkTarget, comment: comment.trim() })
    },
    onSuccess: async () => {
      setComment('')
      await refreshTask()
    },
  })
  // No stage is passed: the destination is derived from the task's state on the
  // server too, so a comment sent from the foot of the thread reaches the node
  // the line named rather than the one this client happened to compute.
  const feedback = useMutation({
    mutationFn: () => postFeedback(taskId, { comment: comment.trim() }),
    onSuccess: (result) => {
      queryClient.setQueryData<TimelineResponse>(queryKeys.events(taskId), (current) => ({
        events: mergeTimelineEvents(current?.events ?? [], result.event),
      }))
      setComment('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention })
    },
  })
  const converse = useMutation({
    mutationFn: async () => {
      const activeId = conversationId ?? (await createConversation(taskId)).conversation.id

      return {
        conversationId: activeId,
        result: await postConversationMessage(taskId, activeId, { message: comment.trim() }),
      }
    },
    onSuccess: ({ conversationId: activeId, result }) => {
      setActiveConversationId(activeId)
      queryClient.setQueryData<ConversationResponse>(
        queryKeys.conversation(taskId, activeId),
        (current) => ({
          conversation: current?.conversation ?? {
            id: activeId,
            taskId,
            subjectKind: null,
            subjectId: null,
            status: 'open',
            lastSequence: result.response.sequence,
            contextCommit: null,
            contextTaskState: null,
            summaryMd: null,
            summaryThrough: 0,
            providerSession: null,
            createdAt: result.message.createdAt,
            updatedAt: result.message.createdAt,
          },
          messages: [...(current?.messages ?? []), result.message, result.response],
          actions: current?.actions ?? [],
        }),
      )
      setComment('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(taskId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention })
    },
  })
  const confirmAction = useMutation({
    mutationFn: (actionId: string) =>
      confirmConversationAction(taskId, conversationId ?? '', actionId),
    onSuccess: refreshTask,
  })
  const answerOption = useMutation({
    mutationFn: ({
      decisionId,
      optionId,
      value,
    }: {
      decisionId: string
      optionId: string
      value?: string
    }) => answerDecision(decisionId, value ? { optionId, text: value } : { optionId }),
    onMutate: ({ decisionId }) => markDecisionPending(decisionId),
    onSuccess: async (_data, { decisionId }) => {
      markDecisionSettled(decisionId)
      await refreshTask()
    },
    onError: (error, { decisionId }) => markDecisionSettled(decisionId, error.message),
  })
  const answerText = useMutation({
    mutationFn: ({ decisionId, text }: { decisionId: string; text: string }) =>
      answerDecision(decisionId, { text }),
    onMutate: ({ decisionId }) => markDecisionPending(decisionId),
    onSuccess: async (_data, { decisionId }) => {
      markDecisionSettled(decisionId)
      await refreshTask()
    },
    onError: (error, { decisionId }) => markDecisionSettled(decisionId, error.message),
  })
  const dismiss = useMutation({
    mutationFn: (decisionId: string) => dismissDecision(decisionId, {}),
    onMutate: (decisionId) => markDecisionPending(decisionId),
    onSuccess: async (_data, decisionId) => {
      markDecisionSettled(decisionId)
      await refreshTask()
    },
    onError: (error, decisionId) => markDecisionSettled(decisionId, error.message),
  })
  const stageRows = detail.data?.stages ?? []
  // The API orders stages by (nodeKey, attempt), not chronologically, so a
  // task that was interrupted at more than one node over its lifetime needs
  // an explicit recency sort here — reversing the API order would pick
  // whichever nodeKey sorts alphabetically last, not the most recent attempt.
  const stagesByRecency = [...stageRows].sort((a, b) => {
    const aStart = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const bStart = b.startedAt ? new Date(b.startedAt).getTime() : 0

    return bStart - aStart
  })
  const runningStage = stagesByRecency.find((stage) => stage.status === 'running')
  const interruptedAttempt = stagesByRecency.find((stage) => stage.status === 'interrupted')
  const interruptedStage =
    interruptedAttempt?.interruptionCleanupStatus === 'succeeded' ? interruptedAttempt : undefined
  const stop = useMutation({
    mutationFn: () => {
      if (!runningStage) throw new Error('No running stage')

      return stopStage(taskId, {
        stageId: runningStage.id,
        graphId: runningStage.graphId,
        nodeKey: runningStage.nodeKey as StopStageInput['nodeKey'],
        attempt: runningStage.attempt,
      })
    },
    onSuccess: refreshTask,
  })
  // Guidance travels as the mutation's own input: `restart without guidance` has
  // to mean the empty string, and clearing the field first would not reach a
  // closure this render already captured.
  const restart = useMutation({
    mutationFn: (guidance: string) => {
      if (!interruptedStage) throw new Error('No safely cleaned interrupted stage')

      return restartStage(taskId, {
        stageId: interruptedStage.id,
        guidance: guidance || undefined,
        idempotencyKey: `restart:${interruptedStage.id}:${guidance}`,
      })
    },
    onSuccess: async () => {
      setComment('')
      await refreshTask()
    },
  })

  if (detail.isPending || timeline.isPending || conversations.isPending || decisions.isPending) {
    return <LoadingState title="Loading task channel…" />
  }
  if (detail.isError) {
    return <ErrorState title="Task unavailable" detail={detail.error.message} />
  }
  if (timeline.isError) {
    return <ErrorState title="Timeline unavailable" detail={timeline.error.message} />
  }
  if (decisions.isError) {
    return <ErrorState title="Decisions unavailable" detail={decisions.error.message} />
  }
  if (conversations.isError || conversation.isError) {
    return (
      <ErrorState
        title="Conversation unavailable"
        detail={(conversations.error ?? conversation.error)?.message ?? 'Unknown error'}
      />
    )
  }

  const task = detail.data.task
  const graph = detail.data.graph
  const currentGate = graph?.dag.nodes.find(
    (node) => node.kind === 'gate' && node.key === task.status,
  )
  const reworkTargets = currentGate?.kind === 'gate' ? (currentGate.rework ?? []) : []
  const gateError = approve.error ?? redirect.error ?? rework.error
  const gateBusy = approve.isPending || redirect.isPending || rework.isPending
  // REQ-1305: computed the same way the server counts it, so the redirect
  // control reads as unavailable before a redirect attempt ever round-trips.
  const redirectCap =
    currentGate?.kind === 'gate' && currentGate.redirect
      ? { key: currentGate.redirect.cap, limit: task.caps[currentGate.redirect.cap] }
      : undefined
  const redirectsUsed =
    currentGate?.kind === 'gate' ? countGateRedirects(timeline.data.events, currentGate.key) : 0
  const events = visibleTimelineEvents(timeline.data.events, stageRows)
  const messages = conversation.data?.messages ?? []
  const actions = conversation.data?.actions ?? []
  const decisionRows = decisions.data.decisions
  const decisionsById = new Map(decisionRows.map((decision) => [decision.id, decision]))
  // `blocked` is what the engine parks a task in when a blocking decision is
  // open — leaving it out here is what let three stopping questions render as
  // if the task were merely running.
  const parked =
    task.status === 'waiting_human' || task.status === 'paused' || task.status === 'blocked'
  // What stops the task outranks what is merely open: a blocking question is
  // paged ahead of one that is only open.
  const openDecisions = decisionRows.filter((decision) => decision.status === 'open')
  const blocks = (decision: DecisionItem) => decision.blocking && parked
  const queued = [
    ...openDecisions.filter(blocks),
    ...openDecisions.filter((decision) => !blocks(decision)),
  ]

  const pipelineNodes = buildPipelineNodes({
    nodes: graph?.dag.nodes ?? [],
    stages: stageRows,
    status: task.status,
    resumeStatus: task.resumeStatus,
    modelBindings: task.modelBindings,
  })
  const baseline = bindingBaseline(pipelineNodes)
  const currentNodeKey = pipelineNodes.find((node) => node.current)?.key ?? null
  const feed = buildFeed({ events, messages, stages: stageRows, decisionsById })
  const lastActivity = [...events]
    .reverse()
    .find((event) => event.type === 'stage.activity' && event.stageId === runningStage?.id)

  const answeringIndex = Math.min(questionIndex, Math.max(0, queued.length - 1))
  const answering = queued[answeringIndex] ?? null
  // The destination describes the question the pager is showing, so the one the
  // owner paged to is the one the console's line is about.
  const paged = answering
    ? [answering, ...queued.filter((decision) => decision.id !== answering.id)]
    : queued
  const discussing = activeConversationId
    ? (decisionRows.find((row) => row.conversationId === activeConversationId) ?? null)
    : null
  const destination = consoleDestination({
    task,
    stages: stageRows,
    nodes: pipelineNodes,
    openDecisions: paged,
    gateKey: currentGate?.kind === 'gate' ? currentGate.key : null,
    redirect: redirectCap ? { used: redirectsUsed, limit: redirectCap.limit } : null,
    interruptedStage: interruptedStage ?? null,
    spend: detail.data.spend,
    discussingDecision: discussing,
  })
  const openNodeView = openNode
    ? (pipelineNodes.find((node) => node.key === openNode) ?? null)
    : null

  const question: OpenQuestion | null =
    destination.kind === 'question' && answering
      ? {
          label: answering.nodeKey ? nodeLabel(answering.nodeKey) : 'The task',
          index: answeringIndex,
          total: queued.length,
          promptMd: answering.promptMd,
          stopped: answering.blocking && parked,
          options: (
            <DecisionOptions
              options={answering.options}
              busy={decisionActivity[answering.id]?.pending ?? false}
              onAnswer={(optionId, value) =>
                answerOption.mutate({ decisionId: answering.id, optionId, value })
              }
            />
          ),
          onPage: setQuestionIndex,
          onDismiss: () => dismiss.mutate(answering.id),
          onDiscuss: answering.conversationId
            ? () => setActiveConversationId(answering.conversationId ?? undefined)
            : undefined,
          busy: decisionActivity[answering.id]?.pending ?? false,
          error: decisionActivity[answering.id]?.error,
        }
      : null

  const railSub = buildRailSub()

  function buildRailSub(): RailSub | null {
    if (runningStage) {
      return {
        nodeKey: runningStage.nodeKey,
        detail: lastActivity ? stageActivityLabel(lastActivity) : null,
        action: (
          <StopControl
            nodeKey={runningStage.nodeKey}
            attempt={runningStage.attempt}
            onStop={() => stop.mutate()}
            stopping={stop.isPending}
            error={stop.error?.message}
          />
        ),
      }
    }

    // A stop that has not finished cleaning up is why restart is unavailable —
    // said under the node it happened to, not in a strip of its own.
    if (interruptedAttempt && interruptedAttempt.interruptionCleanupStatus !== 'succeeded') {
      const failed = interruptedAttempt.interruptionCleanupStatus === 'failed'

      return {
        nodeKey: interruptedAttempt.nodeKey,
        tone: failed ? 'danger' : 'muted',
        detail: failed
          ? `Cannot restart: ${interruptedAttempt.interruptionFailure ?? 'cleanup failed'}`
          : 'Stopping — uncommitted work is being discarded',
      }
    }

    return null
  }

  function onThreadScroll(): void {
    const node = threadRef.current
    if (!node) return

    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 240
  }

  /**
   * The input is the answer while a question is open, guidance for a restart
   * while a node stands stopped, and a comment otherwise — the same field,
   * routed by the state the destination already read.
   */
  function submitInput(): void {
    const text = comment.trim()
    if (!text) return

    if (destination.kind === 'discussion') {
      converse.mutate()

      return
    }
    if (destination.kind === 'question' && answering) {
      answerText.mutate({ decisionId: answering.id, text })
      setComment('')

      return
    }
    if (destination.kind === 'gate') {
      approve.mutate()

      return
    }
    if (destination.kind === 'restart') {
      restart.mutate(text)

      return
    }

    feedback.mutate()
  }

  const failure = [...events].reverse().find((event) => event.type === 'task.failed')
  const failureDetail = failure
    ? (payloadValue(failure, 'reason') ??
      payloadValue(failure, 'detail') ??
      payloadValue(failure, 'cause'))
    : null

  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        {openNodeView ? (
          <RunLog
            node={openNodeView}
            events={timeline.data.events}
            repoUrl={task.repoUrl}
            onClose={() => setOpenNode(null)}
            onComment={() => {
              setOpenNode(null)
              threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
            }}
          />
        ) : (
          <div
            ref={threadRef}
            onScroll={onThreadScroll}
            data-thread=""
            className="scroll-thin min-h-0 flex-1 xl:overflow-y-auto"
          >
            {/* A thread reads upward from the console. Bottom-aligning the
                content inside a full-height wrapper — rather than justifying
                the scroll container itself — keeps the top of a long thread
                reachable. */}
            <div className="flex min-h-full flex-col justify-end">
              <ThreadView entries={feed} onOpenNode={setOpenNode} />

              {task.status === 'failed' && (
                <section className="mt-3 border-l-2 border-l-danger pl-3">
                  <p className="text-sm leading-6 text-muted">
                    {failureDetail ?? 'The run stopped without recording a reason.'}
                    {task.resumeStatus &&
                      ` Last node: ${nodeLabel(task.resumeStatus).toLowerCase()}.`}
                  </p>
                </section>
              )}
            </div>
          </div>
        )}

        {/* The one thing that needs a person, and the one input, are the same
            box: a question with its own fold above a second scrolling column is
            what pass 3 exists to delete. */}
        <div className="shrink-0">
          {destination.kind === 'discussion' && actions.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {actions.map((action) => (
                <li
                  key={action.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-l-amber/40 pl-3"
                >
                  <span className="micro-label text-amber">{action.kind}</span>
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {action.instruction ?? 'No instruction'}
                  </span>
                  {action.status === 'proposed' ? (
                    <button
                      type="button"
                      className="button-ghost"
                      disabled={confirmAction.isPending}
                      onClick={() => confirmAction.mutate(action.id)}
                    >
                      Confirm
                    </button>
                  ) : (
                    <span className="font-mono text-[0.62rem] text-muted">{action.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <TaskComposer
            destination={destination}
            question={question}
            value={comment}
            onChange={setComment}
            onSubmit={submitInput}
            busy={
              feedback.isPending ||
              answerText.isPending ||
              converse.isPending ||
              approve.isPending ||
              restart.isPending
            }
            error={
              (feedback.error ?? answerText.error ?? converse.error ?? confirmAction.error)?.message
            }
            actions={
              destination.kind === 'gate' && currentGate?.kind === 'gate' ? (
                <GateVerbs
                  gateKey={currentGate.key}
                  reworkTargets={reworkTargets}
                  redirect={
                    redirectCap
                      ? {
                          spent: redirectsUsed >= redirectCap.limit,
                          used: redirectsUsed,
                          limit: redirectCap.limit,
                          cap: redirectCap.key,
                        }
                      : null
                  }
                  comment={comment}
                  reworkTarget={reworkTarget}
                  onReworkTargetChange={(value) =>
                    setReworkTarget(value as ReworkInput['target'] | '')
                  }
                  busy={gateBusy}
                  error={gateError?.message}
                  onRedirect={() => redirect.mutate()}
                  onRework={() => rework.mutate()}
                />
              ) : null
            }
            escapes={
              <>
                {destination.kind === 'discussion' && (
                  <button
                    type="button"
                    className="link-quiet"
                    onClick={() => setActiveConversationId(undefined)}
                  >
                    back to answering
                  </button>
                )}

                {destination.kind === 'question' && (
                  <button
                    type="button"
                    className="link-quiet"
                    disabled={!comment.trim() || feedback.isPending}
                    onClick={() => feedback.mutate()}
                    title="Record this as a comment rather than as the answer"
                  >
                    just comment instead
                  </button>
                )}

                {destination.kind === 'restart' && (
                  <button
                    type="button"
                    className="link-quiet"
                    disabled={restart.isPending}
                    onClick={() => restart.mutate('')}
                  >
                    restart without guidance
                  </button>
                )}
              </>
            }
          />
        </div>
      </div>

      <aside className="scroll-thin order-first min-h-0 xl:order-none xl:overflow-y-auto xl:border-l xl:border-border xl:pl-6">
        <details className="border border-border px-3 py-2 xl:hidden">
          <summary className="cursor-pointer font-mono text-[0.68rem] uppercase tracking-widest text-muted">
            Pipeline · {currentNodeKey ? nodeLabel(currentNodeKey).toLowerCase() : task.status}
          </summary>
          <div className="pt-4">
            <TaskRail
              nodes={pipelineNodes}
              baseline={baseline}
              selectedKey={openNode ?? currentNodeKey}
              onSelect={(key) => setOpenNode(key === openNode ? null : key)}
              task={task}
              spend={detail.data.spend}
              sub={railSub}
            />
          </div>
        </details>

        <div className="hidden xl:block">
          <TaskRail
            nodes={pipelineNodes}
            baseline={baseline}
            selectedKey={openNode ?? currentNodeKey}
            onSelect={(key) => setOpenNode(key === openNode ? null : key)}
            task={task}
            spend={detail.data.spend}
            sub={railSub}
          />
        </div>
      </aside>
    </div>
  )
}
