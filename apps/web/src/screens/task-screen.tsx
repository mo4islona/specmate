import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { DecisionOptions } from '../components/decision-options.tsx'
import { FileDiffDrawer } from '../components/file-diff-drawer.tsx'
import { GateVerbs } from '../components/gate-panel.tsx'
import { StopControl } from '../components/run-controls.tsx'
import { StepDocuments } from '../components/step-documents.tsx'
import { StepHeader } from '../components/step-header.tsx'
import { type OpenQuestion, TaskComposer } from '../components/task-composer.tsx'
import { TaskRail } from '../components/task-rail.tsx'
import { ThreadView } from '../components/thread-view.tsx'
import { signalText } from '../components/tone.ts'
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
  listArtifacts,
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
import { consoleDestination, parkedStop } from '../lib/task-console.ts'
import { stepDocuments } from '../lib/task-documents.ts'
import { buildPipelineNodes } from '../lib/task-pipeline.ts'
import { buildStepFeed, countGateRedirects, liveActivity, nodeLabel } from '../lib/task-thread.ts'
import { Button, ConsoleDock, cx, ErrorState, LoadingState } from '../ui/index.ts'

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
    queryFn: ({ signal }) => listConversations(taskId, signal),
  })
  const decisions = useQuery({
    queryKey: queryKeys.decisions(taskId),
    queryFn: ({ signal }) => listDecisions(taskId, signal),
  })
  // Shared with the shell's own list under the same key, so the tab's count and
  // the documents below cost one request between them.
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(taskId),
    queryFn: ({ signal }) => listArtifacts(taskId, signal),
  })
  // Tracks a conversation created by this session the instant its id is
  // known, so the very first message doesn't wait on a list refetch to
  // remount the conversation query on the right key (see converse.onSuccess).
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined)
  const conversationId = activeConversationId ?? conversations.data?.conversations[0]?.id
  const conversation = useQuery({
    queryKey: queryKeys.conversation(taskId, conversationId ?? 'none'),
    queryFn: ({ signal }) => getConversation(taskId, conversationId ?? '', signal),
    enabled: Boolean(conversationId),
  })
  const [comment, setComment] = useState('')
  const [reworkTarget, setReworkTarget] = useState<ReworkInput['target'] | ''>('')
  // The step the thread is reading. Null follows the task: the owner opens a
  // running task on the node it is running, and only a deliberate pick pins it
  // to an older one.
  const [readingNode, setReadingNode] = useState<string | null>(null)
  // The file whose whole diff is open over the surface — REQ-916's layer, opened
  // from a path the record named.
  const [openFile, setOpenFile] = useState<string | null>(null)
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
  const documentsRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottom = useRef(true)
  const lastSeq = timeline.data?.events.at(-1)?.seq ?? 0
  const messageCount = conversation.data?.messages.length ?? 0

  // A thread reads from the bottom: new activity scrolls into view unless the
  // owner has deliberately scrolled up into the history. A step the owner just
  // switched to opens at its end too, which is why the scope is a trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the counts are the trigger, not an input — the effect runs *because* a new event or message arrived.
  useEffect(() => {
    const node = threadRef.current
    if (!node || !pinnedToBottom.current) return

    // A document is read from its first line. Where the step ends in one, the
    // end of the thread is its top rather than the bottom of the container.
    const documents = documentsRef.current
    const opened = documents?.querySelector('[data-document-open]')
    if (documents && opened) {
      node.scrollTop = documents.offsetTop - node.offsetTop

      return
    }

    node.scrollTop = node.scrollHeight
  }, [lastSeq, messageCount, readingNode])

  function markDecisionPending(decisionId: string): void {
    setDecisionActivity((prev) => ({ ...prev, [decisionId]: { pending: true } }))
  }
  function markDecisionSettled(decisionId: string, error?: string): void {
    setDecisionActivity((prev) => ({ ...prev, [decisionId]: { pending: false, error } }))
  }

  // The owner just acted, so everything the act could have moved is refetched:
  // the task prefix carries its timeline, conversations, decisions, documents
  // and diff with it, and the two indexes carry its row.
  async function refreshTask(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
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
    mutationFn: (stageId?: string) =>
      postFeedback(taskId, { comment: comment.trim(), ...(stageId && { stageId }) }),
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
  const runningStage = stageRows.find((stage) => stage.status === 'running')
  const interruptedAttempt = parkedStop(detail.data?.task ?? null, stageRows)
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
  const events = timeline.data.events
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
  const currentNodeKey = pipelineNodes.find((node) => node.current)?.key ?? null
  const firstNodeKey = pipelineNodes[0]?.key ?? null
  // What the thread is reading: the step the owner pinned, or the one the task
  // stands on. Everything below is scoped to it (REQ-919).
  const stepKey = readingNode ?? currentNodeKey ?? firstNodeKey
  const step = pipelineNodes.find((node) => node.key === stepKey) ?? null
  const feed = buildStepFeed({
    events,
    messages,
    stages: stageRows,
    decisionsById,
    nodeKey: stepKey,
    firstNodeKey,
  })
  // A step the owner went back to themselves, with a run to pin words to
  // (REQ-906). Following the task is not reading an older step, so this stays
  // null while the thread is where the task is.
  const wentBack = readingNode !== null && step !== null && step.key !== currentNodeKey
  const pinnedStep = wentBack && step?.latest ? step : null
  const documents = stepDocuments({
    artifacts: artifacts.data?.artifacts ?? [],
    step,
    nodes: pipelineNodes,
  })
  // What the run is doing at this instant, in place of the forty lines of
  // reading it would otherwise have left in the record (REQ-915).
  const live = liveActivity({ events, stages: stageRows, nodeKey: stepKey })

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
    readingStep: pinnedStep ? { nodeKey: pinnedStep.key, label: pinnedStep.label } : null,
    stepKey,
  })
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

  const stepNotice = buildStepNotice()

  /** A stop mid-cleanup is why restart is unavailable — said over the step it happened to. */
  function buildStepNotice(): { text: string; tone: 'muted' | 'danger' } | null {
    if (!interruptedAttempt || interruptedAttempt.nodeKey !== stepKey) return null
    if (interruptedAttempt.interruptionCleanupStatus === 'succeeded') return null

    const failed = interruptedAttempt.interruptionCleanupStatus === 'failed'

    return {
      text: failed
        ? `Cannot restart: ${interruptedAttempt.interruptionFailure ?? 'cleanup failed'}`
        : 'Stopping — uncommitted work is being discarded',
      tone: failed ? 'danger' : 'muted',
    }
  }

  function onThreadScroll(): void {
    const node = threadRef.current
    if (!node) return

    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 240
  }

  /**
   * A click lands on the row that was clicked, always. Toggling off the row
   * already being read sent the selection to whichever node the task happened
   * to stand on, so clicking the highlighted step moved the highlight somewhere
   * else. Reading the node the task stands on is following it — that one clears
   * the pin, which changes nothing about where the selection lands.
   */
  function readStep(key: string): void {
    pinnedToBottom.current = true
    setReadingNode(key === currentNodeKey ? null : key)
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
    if (destination.kind === 'step-note' && pinnedStep?.latest) {
      feedback.mutate(pinnedStep.latest.id)

      return
    }

    feedback.mutate(undefined)
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        {step && (
          <StepHeader
            node={step}
            repoUrl={task.repoUrl}
            current={step.key === currentNodeKey}
            notice={stepNotice}
          />
        )}

        <div
          ref={threadRef}
          onScroll={onThreadScroll}
          data-thread=""
          className="scroll-thin min-h-0 flex-1 xl:overflow-y-auto"
        >
          {/* A thread reads upward from the console. Bottom-aligning the
              content inside a full-height wrapper — rather than justifying
              the scroll container itself — keeps the top of a long thread
              reachable.

              `px-4` is the console's own inset, and the step header above
              carries it too: one left edge down the column, rather than the
              record starting flush while everything framing it sat indented.
              `pb-8` is what the console's fade needs to land on — over empty
              space rather than over the last line of the record. */}
          <div className="flex min-h-full flex-col justify-end px-4 pb-8">
            <ThreadView entries={feed} live={live} taskId={taskId} onOpenFile={setOpenFile} />

            {/* What the step produced, at the end of the step. An approval with
                nothing to read is an approval of nothing. */}
            <div ref={documentsRef}>
              <StepDocuments
                taskId={taskId}
                documents={documents}
                current={step?.key === currentNodeKey}
              />
            </div>
          </div>
        </div>

        {/* The one thing that needs a person, and the one input, are the same
            box: a question with its own fold above a second scrolling column is
            what pass 3 exists to delete. */}
        <ConsoleDock className="shrink-0">
          {destination.kind === 'discussion' && actions.length > 0 && (
            <ul className="mb-2 space-y-1">
              {actions.map((action) => (
                <li
                  key={action.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-text/[0.05] py-1.5 pl-3.5 pr-1.5"
                >
                  <span className={cx('font-mono text-[0.72rem]', signalText('asking'))}>
                    {action.kind}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {action.instruction ?? 'No instruction'}
                  </span>
                  {action.status === 'proposed' ? (
                    <Button
                      variant="ghost"
                      disabled={confirmAction.isPending}
                      onClick={() => confirmAction.mutate(action.id)}
                    >
                      Confirm
                    </Button>
                  ) : (
                    <span className="px-2.5 font-mono text-[0.68rem] text-muted">
                      {action.status}
                    </span>
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
            stop={
              runningStage ? (
                <StopControl
                  nodeKey={runningStage.nodeKey}
                  attempt={runningStage.attempt}
                  onStop={() => stop.mutate()}
                  stopping={stop.isPending}
                  error={stop.error?.message}
                />
              ) : null
            }
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
                  <Button variant="ghost" onClick={() => setActiveConversationId(undefined)}>
                    Back to answering
                  </Button>
                )}

                {destination.kind === 'question' && (
                  <Button
                    variant="ghost"
                    disabled={!comment.trim() || feedback.isPending}
                    onClick={() => feedback.mutate(undefined)}
                    title="Record this as a comment rather than as the answer"
                  >
                    Just comment instead
                  </Button>
                )}

                {destination.kind === 'restart' && (
                  <Button
                    variant="ghost"
                    disabled={restart.isPending}
                    onClick={() => restart.mutate('')}
                  >
                    Restart without guidance
                  </Button>
                )}
              </>
            }
          />
        </ConsoleDock>
      </div>

      <aside className="scroll-thin order-first min-h-0 xl:order-none xl:overflow-y-auto xl:border-l xl:border-border xl:pl-6">
        <details className="rounded-xl bg-elevated/55 px-3.5 py-2.5 xl:hidden">
          <summary className="cursor-pointer font-mono text-[0.72rem] text-muted">
            Pipeline · {stepKey ? nodeLabel(stepKey).toLowerCase() : task.status}
          </summary>
          <div className="pt-4">
            <TaskRail
              nodes={pipelineNodes}
              selectedKey={stepKey}
              onSelect={readStep}
              task={task}
              spend={detail.data.spend}
            />
          </div>
        </details>

        <div className="hidden xl:block">
          <TaskRail
            nodes={pipelineNodes}
            selectedKey={stepKey}
            onSelect={readStep}
            task={task}
            spend={detail.data.spend}
          />
        </div>
      </aside>

      <FileDiffDrawer taskId={taskId} path={openFile} onClose={() => setOpenFile(null)} />
    </div>
  )
}
