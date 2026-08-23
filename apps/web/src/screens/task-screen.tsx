import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { DecisionStack } from '../components/decision-stack.tsx'
import { GatePanel } from '../components/gate-panel.tsx'
import { KickoffBrief } from '../components/kickoff-brief.tsx'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { CleanupStrip, RestartPanel, RunningStrip } from '../components/run-controls.tsx'
import { RunLog } from '../components/run-log.tsx'
import { TaskComposer } from '../components/task-composer.tsx'
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
  getArtifact,
  getConversation,
  getTask,
  listArtifacts,
  listConversations,
  listDecisions,
  listEvents,
  listTasks,
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
  // Shared with the navigation's own list under the same key: the lineage
  // needs titles for a handful of ids, not a fetch per id.
  const tasks = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: ({ signal }) => listTasks(signal),
  })
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(taskId),
    queryFn: ({ signal }) => listArtifacts(taskId, signal),
  })
  // The brief is read at the kickoff gate only — fetching it elsewhere would
  // be a document no gate is asking the owner to act on.
  const atKickoffGate = detail.data?.task.status === 'human_kickoff_gate'
  const briefArtifactId = artifacts.data?.artifacts.find((a) => a.kind === 'proposal')?.id
  const brief = useQuery({
    queryKey: queryKeys.artifact(taskId, briefArtifactId ?? 'none'),
    queryFn: ({ signal }) => getArtifact(taskId, briefArtifactId ?? '', signal),
    enabled: atKickoffGate && Boolean(briefArtifactId),
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
  const [restartGuidance, setRestartGuidance] = useState('')
  // The node whose run log is open over the thread — null while the thread is
  // what the owner is reading, which is most of the time.
  const [openNode, setOpenNode] = useState<string | null>(null)
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

  const approve = useMutation({ mutationFn: () => approveGate(taskId), onSuccess: refreshTask })
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
  const restart = useMutation({
    mutationFn: () => {
      if (!interruptedStage) throw new Error('No safely cleaned interrupted stage')

      return restartStage(taskId, {
        stageId: interruptedStage.id,
        guidance: restartGuidance.trim() || undefined,
        idempotencyKey: `restart:${interruptedStage.id}:${restartGuidance.trim()}`,
      })
    },
    onSuccess: async () => {
      setRestartGuidance('')
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
  // What stops the task outranks what is merely open: a blocking question sits
  // above the run controls, a passing one below them.
  const openDecisions = decisionRows.filter((decision) => decision.status === 'open')
  const blocks = (decision: DecisionItem) => decision.blocking && parked
  const blockingDecisions = openDecisions.filter(blocks)
  const passingDecisions = openDecisions.filter((decision) => !blocks(decision))

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

  // The one question shown above the input, and the rest counted behind it.
  const answering = blockingDecisions[0] ?? passingDecisions[0] ?? null
  const queued = [...blockingDecisions, ...passingDecisions]
  const discussing = activeConversationId
    ? (decisionRows.find((row) => row.conversationId === activeConversationId) ?? null)
    : null
  const destination = consoleDestination({
    task,
    stages: stageRows,
    nodes: pipelineNodes,
    openDecisions: queued,
    gateKey: currentGate?.kind === 'gate' ? currentGate.key : null,
    interruptedStage: interruptedStage ?? null,
    spend: detail.data.spend,
    discussingDecision: discussing,
  })
  const openNodeView = openNode
    ? (pipelineNodes.find((node) => node.key === openNode) ?? null)
    : null
  const railProps = {
    nodes: pipelineNodes,
    baseline,
    repoUrl: task.repoUrl,
    selectedKey: openNode ?? currentNodeKey,
    onSelect: (key: string) => setOpenNode(key === openNode ? null : key),
    task,
    tasks: tasks.data?.tasks,
    spend: detail.data.spend,
  }

  function decisionBusy(decisionId: string): boolean {
    return decisionActivity[decisionId]?.pending ?? false
  }

  function decisionError(decisionId: string): string | undefined {
    return decisionActivity[decisionId]?.error
  }

  function decisionHandlers(decision: DecisionItem) {
    return {
      onAnswerOption: (optionId: string, value?: string) =>
        answerOption.mutate({ decisionId: decision.id, optionId, value }),
      onAnswerText: (text: string) => answerText.mutate({ decisionId: decision.id, text }),
      onDismiss: () => dismiss.mutate(decision.id),
      onDiscuss: decision.conversationId
        ? () => setActiveConversationId(decision.conversationId ?? undefined)
        : undefined,
    }
  }

  function onThreadScroll(): void {
    const node = threadRef.current
    if (!node) return

    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 240
  }

  /**
   * The input is the answer while a question is open, and guidance otherwise —
   * the same field, routed by the state the destination already read.
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

    feedback.mutate()
  }

  const failure = [...events].reverse().find((event) => event.type === 'task.failed')
  const failureDetail = failure
    ? (payloadValue(failure, 'reason') ??
      payloadValue(failure, 'detail') ??
      payloadValue(failure, 'cause'))
    : null

  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
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
        )}

        {/* Everything that needs a person sits directly above the one input, in
            the same scroll as the thread — a question with its own fold above a
            second scrolling column is what pass 3 exists to delete. */}
        <div className="shrink-0 space-y-3">
          {runningStage && (
            <RunningStrip
              nodeKey={runningStage.nodeKey}
              attempt={runningStage.attempt}
              startedAt={runningStage.startedAt ? String(runningStage.startedAt) : null}
              activity={lastActivity ? stageActivityLabel(lastActivity) : null}
              onStop={() => stop.mutate()}
              stopping={stop.isPending}
              error={stop.error?.message}
            />
          )}

          {task.status === 'paused' &&
            interruptedAttempt &&
            interruptedAttempt.interruptionCleanupStatus !== 'succeeded' && (
              <CleanupStrip
                nodeKey={interruptedAttempt.nodeKey}
                attempt={interruptedAttempt.attempt}
                failed={interruptedAttempt.interruptionCleanupStatus === 'failed'}
                failure={interruptedAttempt.interruptionFailure}
              />
            )}

          {atKickoffGate && brief.data && (
            <details className="border border-amber/25">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[0.68rem] uppercase tracking-widest text-amber">
                The kickoff brief
              </summary>
              <div className="px-3 pb-3">
                <KickoffBrief content={brief.data.artifact.content ?? ''} />
              </div>
            </details>
          )}

          {answering && (
            <DecisionStack
              decisions={queued}
              label={parked ? 'Blocking questions' : 'Open questions'}
              answerInConsole={destination.kind === 'question'}
              parked={parked}
              busy={decisionBusy}
              error={decisionError}
              handlers={decisionHandlers}
            />
          )}

          {actions.length > 0 && (
            <section className="border border-amber/35 p-3">
              <p className="micro-label text-amber">Proposed actions</p>
              <ul className="mt-2 space-y-2">
                {actions.map((action) => (
                  <li key={action.id} className="border-l-2 border-l-amber/40 pl-3">
                    <p className="font-mono text-xs text-amber">{action.kind}</p>
                    <p className="mt-1 break-words text-sm">
                      {action.instruction ?? 'No instruction'}
                    </p>
                    {action.status === 'proposed' ? (
                      <button
                        type="button"
                        className="button-secondary mt-2"
                        disabled={confirmAction.isPending}
                        onClick={() => confirmAction.mutate(action.id)}
                      >
                        Confirm action
                      </button>
                    ) : (
                      <p className="mt-2 font-mono text-xs text-muted">{action.status}</p>
                    )}
                  </li>
                ))}
              </ul>
              {confirmAction.error && <p className="field-error">{confirmAction.error.message}</p>}
            </section>
          )}

          <TaskComposer
            destination={destination}
            value={comment}
            onChange={setComment}
            busy={feedback.isPending || answerText.isPending}
            error={(feedback.error ?? answerText.error)?.message}
            onSubmit={submitInput}
            actions={
              <>
                {destination.kind === 'discussion' && (
                  <button
                    type="button"
                    onClick={() => setActiveConversationId(undefined)}
                    className="font-mono text-[0.62rem] text-muted underline-offset-4 hover:text-text hover:underline"
                  >
                    back to answering
                  </button>
                )}

                {currentGate?.kind === 'gate' && (
                  <GatePanel
                    gateKey={currentGate.key}
                    approveTo={currentGate.approve}
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
                    onApprove={() => approve.mutate()}
                    onRedirect={() => redirect.mutate()}
                    onRework={() => rework.mutate()}
                  />
                )}

                {destination.kind === 'restart' && interruptedStage && (
                  <RestartPanel
                    nodeKey={interruptedStage.nodeKey}
                    attempt={interruptedStage.attempt}
                    guidance={restartGuidance}
                    onGuidanceChange={setRestartGuidance}
                    onRestart={() => restart.mutate()}
                    busy={restart.isPending}
                    error={restart.error?.message}
                  />
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
            <TaskRail {...railProps} />
          </div>
        </details>

        <div className="hidden xl:block">
          <TaskRail {...railProps} />
        </div>
      </aside>
    </div>
  )
}
